import { Router, Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { addCollectionCard, upsertScryfallCard } from "../db/index.js";
import { fetchCardsCollection } from "../scryfall/client.js";

export const importRouter = Router();

const CONDITION_MAP: Record<string, string> = {
  "near mint": "NM",
  "mint": "NM",
  "nm": "NM",
  "lightly played": "LP",
  "light play": "LP",
  "good": "LP",
  "lp": "LP",
  "moderately played": "MP",
  "moderate play": "MP",
  "mp": "MP",
  "played": "MP",
  "heavily played": "HP",
  "heavy play": "HP",
  "hp": "HP",
  "damaged": "DMG",
  "dmg": "DMG",
  "poor": "DMG",
};

function normalizeCondition(raw: string): string {
  return CONDITION_MAP[raw.toLowerCase().trim()] || "NM";
}

interface ImportRow {
  name: string;
  set_code?: string;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  purchase_price?: number;
  folder_id?: number;
}

// POST /api/import/csv
// Body: multipart/form-data with "file" field, OR JSON with "text" field + optional "folder_id"
importRouter.post("/csv", async (req: Request, res: Response) => {
  let csvText: string;
  const folder_id: number | null = req.body?.folder_id ? parseInt(req.body.folder_id) : null;

  // Support both file upload and raw text
  if (req.file) {
    csvText = req.file.buffer.toString("utf-8");
  } else if (req.body?.text) {
    csvText = req.body.text;
  } else {
    res.status(400).json({ error: "Provide CSV as file upload or 'text' field in JSON body" });
    return;
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: `CSV parse error: ${msg}` });
    return;
  }

  if (!rows.length) {
    res.status(400).json({ error: "CSV is empty" });
    return;
  }

  // Detect column names (handle Manabox and common formats)
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
  const col = (aliases: string[]): string | undefined =>
    aliases.find((a) => headers.includes(a));

  const nameCol = col(["name", "card name", "cardname"]);
  const countCol = col(["count", "quantity", "qty", "amount"]);
  const setCol = col(["set code", "set", "edition code", "set_code", "edition"]);
  const conditionCol = col(["condition", "cond"]);
  const foilCol = col(["foil", "is foil", "isfoil"]);
  const langCol = col(["language", "lang"]);
  const priceCol = col(["purchase price", "purchase_price", "price", "cost"]);
  const collectorCol = col(["collector number", "collector_number", "card number", "card_number", "#"]);

  if (!nameCol) {
    res.status(400).json({ error: "CSV must have a 'Name' column" });
    return;
  }

  // Parse rows into normalized import records
  const importRows: ImportRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row[nameCol]?.trim();
    if (!name) continue;

    const quantity = countCol ? Math.max(1, parseInt(row[countCol]) || 1) : 1;
    const condition = conditionCol ? normalizeCondition(row[conditionCol]) : "NM";
    const foilRaw = foilCol ? row[foilCol]?.toLowerCase().trim() : "";
    const foil = ["true", "yes", "1", "foil", "✓", "x"].includes(foilRaw);
    const language = langCol ? (row[langCol]?.trim() || "en").substring(0, 10) : "en";
    const purchase_price = priceCol ? parseFloat(row[priceCol]) || undefined : undefined;

    // Normalize set code (Manabox uses full set names sometimes)
    const setRaw = setCol ? row[setCol]?.trim() : undefined;

    importRows.push({
      name,
      set_code: setRaw ? setRaw.toLowerCase().replace(/\s+/g, "") : undefined,
      quantity,
      foil,
      condition,
      language,
      purchase_price,
      folder_id: folder_id ?? undefined,
    });
  }

  if (!importRows.length) {
    res.status(400).json({ error: "No valid card rows found in CSV" });
    return;
  }

  // Batch fetch from Scryfall (with local cache)
  const identifiers = importRows.map((r) => ({ name: r.name, set: r.set_code }));
  let cardMap: Map<string, Awaited<ReturnType<typeof fetchCardsCollection>> extends Map<string, infer V> ? V : never>;

  try {
    cardMap = await fetchCardsCollection(identifiers) as typeof cardMap;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `Scryfall lookup failed: ${msg}` });
    return;
  }

  // Insert cards into collection
  let imported = 0;
  let skipped = 0;

  for (const importRow of importRows) {
    const card = cardMap.get(importRow.name.toLowerCase());
    if (!card) {
      errors.push(`Card not found: "${importRow.name}"`);
      skipped++;
      continue;
    }

    try {
      upsertScryfallCard(card);
      addCollectionCard({
        scryfall_id: card.id,
        folder_id: importRow.folder_id ?? null,
        quantity: importRow.quantity,
        foil: importRow.foil,
        condition: importRow.condition,
        language: importRow.language,
        purchase_price: importRow.purchase_price,
      });
      imported++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Failed to import "${importRow.name}": ${msg}`);
      skipped++;
    }
  }

  res.json({
    total: importRows.length,
    imported,
    skipped,
    errors: errors.slice(0, 50), // Cap error list
  });
});

// POST /api/import/text
// Body: { text: "4x Lightning Bolt\n1x Sol Ring\n...", folder_id? }
// Supports simple text format: "NxCard Name" or "N Card Name" or just "Card Name"
importRouter.post("/text", async (req: Request, res: Response) => {
  const { text, folder_id } = req.body as { text?: string; folder_id?: number };

  if (!text?.trim()) {
    res.status(400).json({ error: "Text content is required" });
    return;
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const importRows: Array<{ name: string; quantity: number }> = [];

  for (const line of lines) {
    // Match: "4x Card Name", "4 Card Name", "4X Card Name", or just "Card Name"
    const match = line.match(/^(\d+)[xX]?\s+(.+)$/) || line.match(/^(.+)$/);
    if (!match) continue;

    if (match.length === 3) {
      importRows.push({ quantity: parseInt(match[1]), name: match[2].trim() });
    } else {
      importRows.push({ quantity: 1, name: match[1].trim() });
    }
  }

  if (!importRows.length) {
    res.status(400).json({ error: "No valid card entries found" });
    return;
  }

  const cardMap = await fetchCardsCollection(importRows.map((r) => ({ name: r.name })));
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of importRows) {
    const card = cardMap.get(row.name.toLowerCase());
    if (!card) {
      errors.push(`Not found: "${row.name}"`);
      skipped++;
      continue;
    }
    try {
      upsertScryfallCard(card);
      addCollectionCard({
        scryfall_id: card.id,
        folder_id: folder_id ?? null,
        quantity: row.quantity,
        foil: false,
        condition: "NM",
        language: "en",
      });
      imported++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Failed: "${row.name}": ${msg}`);
      skipped++;
    }
  }

  res.json({ total: importRows.length, imported, skipped, errors: errors.slice(0, 50) });
});
