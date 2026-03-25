import { Router } from "express";
import {
  getCollection, getCollectionCardById, addCollectionCard,
  updateCollectionCard, deleteCollectionCard, getCollectionStats,
  getTotalCollectionValue, getCardQuantityInCollection, searchCollectionForDeck,
  type StatsFilter,
} from "../db/index.js";
import { getCardByName } from "../scryfall/client.js";

export const collectionRouter = Router();

// GET /api/collection
// Query: folder_id, search, colors (comma separated), type, foil, condition, owner, legal
collectionRouter.get("/", (req, res) => {
  const { folder_id, search, colors, type, foil, condition, owner, legal } = req.query as Record<string, string>;
  const cards = getCollection({
    folder_id: folder_id === "null" ? null : folder_id ? parseInt(folder_id) : undefined,
    search: search || undefined,
    colors: colors ? colors.split(",").map((c) => c.trim().toUpperCase()) : undefined,
    type: type || undefined,
    foil: foil === "true" ? true : foil === "false" ? false : undefined,
    condition: condition || undefined,
    owner: owner || undefined,
    legal: legal || undefined,
  });
  res.json(cards);
});

// GET /api/collection/stats?owner=&folder_id=&condition=&set_code=&type=&deck_id=
collectionRouter.get("/stats", (req, res) => {
  const { owner, folder_id, condition, set_code, type, deck_id } = req.query as Record<string, string>;
  const filter: StatsFilter = {
    owner: owner || undefined,
    folder_id: folder_id === "null" ? null : folder_id ? parseInt(folder_id) : undefined,
    condition: condition || undefined,
    set_code: set_code || undefined,
    type: type || undefined,
    deck_id: deck_id ? parseInt(deck_id) : undefined,
  };
  const stats = getCollectionStats(filter);
  const totalValue = getTotalCollectionValue(filter);
  res.json({ ...stats, total_value: totalValue });
});

// GET /api/collection/value?folder_id=
collectionRouter.get("/value", (req, res) => {
  const { folder_id } = req.query as Record<string, string>;
  const folderId = folder_id === "null" ? null : folder_id ? parseInt(folder_id) : undefined;
  const value = getTotalCollectionValue(folderId);
  res.json({ value, formatted: `$${value.toFixed(2)}` });
});

// GET /api/collection/quantity?name=
collectionRouter.get("/quantity", (req, res) => {
  const name = (req.query.name as string || "").trim();
  if (!name) {
    res.status(400).json({ error: "Card name required" });
    return;
  }
  const result = getCardQuantityInCollection(name);
  res.json(result);
});

// GET /api/collection/deck-search?q=
// Returns collection cards not already assigned to any deck
collectionRouter.get("/deck-search", (req, res) => {
  const q = (req.query.q as string || "").trim();
  const cards = searchCollectionForDeck(q);
  res.json(cards);
});

// POST /api/collection
// Body: { name, set_code?, scryfall_id?, quantity, foil, condition, language, folder_id?, notes?, purchase_price?, owner?, legal? }
collectionRouter.post("/", async (req, res) => {
  const body = req.body as {
    name?: string;
    scryfall_id?: string;
    set_code?: string;
    quantity?: number;
    foil?: boolean;
    condition?: string;
    language?: string;
    folder_id?: number | null;
    notes?: string;
    purchase_price?: number;
    owner?: string | null;
    legal?: string;
  };

  let scryfallId = body.scryfall_id;

  if (!scryfallId) {
    if (!body.name) {
      res.status(400).json({ error: "Either scryfall_id or card name is required" });
      return;
    }
    try {
      const card = await getCardByName(body.name, body.set_code);
      if (!card) {
        res.status(404).json({ error: `Card "${body.name}" not found on Scryfall` });
        return;
      }
      scryfallId = card.id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
      return;
    }
  }

  const validConditions = ["NM", "LP", "MP", "HP", "DMG"];
  const condition = (body.condition || "NM").toUpperCase();
  if (!validConditions.includes(condition)) {
    res.status(400).json({ error: `Invalid condition. Must be one of: ${validConditions.join(", ")}` });
    return;
  }

  try {
    const entry = addCollectionCard({
      scryfall_id: scryfallId,
      folder_id: body.folder_id ?? null,
      quantity: Math.max(1, body.quantity || 1),
      foil: body.foil ?? false,
      condition,
      language: body.language || "en",
      notes: body.notes,
      purchase_price: body.purchase_price,
      owner: body.owner ?? null,
      legal: body.legal ?? "Y",
    });
    res.status(201).json(entry);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// PATCH /api/collection/:id
collectionRouter.patch("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!getCollectionCardById(id)) {
    res.status(404).json({ error: "Collection entry not found" });
    return;
  }
  const body = req.body as Partial<{
    folder_id: number | null;
    quantity: number;
    foil: boolean;
    condition: string;
    language: string;
    notes: string;
    purchase_price: number;
    owner: string | null;
    legal: string;
  }>;
  try {
    const updated = updateCollectionCard(id, body);
    res.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/collection/:id
collectionRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!getCollectionCardById(id)) {
    res.status(404).json({ error: "Collection entry not found" });
    return;
  }
  deleteCollectionCard(id);
  res.status(204).send();
});
