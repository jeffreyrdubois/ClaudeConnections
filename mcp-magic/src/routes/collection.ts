import { Router } from "express";
import {
  getCollection, getCollectionCardById, addCollectionCard,
  updateCollectionCard, deleteCollectionCard, getCollectionStats,
  getTotalCollectionValue, getCardQuantityInCollection, searchCollectionForDeck,
  bulkUpdateCollectionCards, db,
  type StatsFilter,
} from "../db/index.js";
import { getCardByName } from "../scryfall/client.js";

export const collectionRouter = Router();

// GET /api/collection
// Query: folder_id, search, colors (comma separated), type, foil, condition, owner, legal
collectionRouter.get("/", (req, res) => {
  const { folder_id, search, colors, type, foil, condition, owner, legal, set_code, deck_id, rarity } = req.query as Record<string, string>;
  const cards = getCollection({
    folder_id: folder_id === "null" ? null : folder_id ? parseInt(folder_id) : undefined,
    search: search || undefined,
    colors: colors ? colors.split(",").map((c) => c.trim().toUpperCase()) : undefined,
    type: type || undefined,
    foil: foil === "true" ? true : foil === "false" ? false : undefined,
    condition: condition || undefined,
    owner: owner || undefined,
    legal: legal || undefined,
    set_code: set_code || undefined,
    deck_id: deck_id === "none" ? "none" : deck_id ? parseInt(deck_id) : undefined,
    rarity: rarity || undefined,
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

// PATCH /api/collection/bulk  ← must be registered before /:id
// Body: { ids: number[], updates: { folder_id?, owner?, deck_id? } }
collectionRouter.patch("/bulk", (req, res) => {
  const { ids, updates } = req.body as {
    ids?: number[];
    updates?: {
      folder_id?: number | null;
      owner?: string | null;
      deck_id?: number;
    };
  };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" });
    return;
  }
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "updates object required" });
    return;
  }
  try {
    const result = bulkUpdateCollectionCards(ids, updates);
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// POST /api/collection/:id/replace
// Swaps the scryfall card in place: keeps all metadata (folder, owner, condition, quantity)
// and migrates all deck assignments to the new card.
collectionRouter.post("/:id/replace", (req, res) => {
  const id = parseInt(req.params.id);
  const { scryfall_id } = req.body as { scryfall_id: string };

  if (!scryfall_id) {
    res.status(400).json({ error: "scryfall_id is required" });
    return;
  }

  const existing = getCollectionCardById(id);
  if (!existing) {
    res.status(404).json({ error: "Collection entry not found" });
    return;
  }

  if (existing.scryfall_id === scryfall_id) {
    res.status(400).json({ error: "New card is the same as the current card" });
    return;
  }

  const newCardInCache = db.prepare("SELECT id FROM scryfall_cards WHERE id = ?").get(scryfall_id) as { id: string } | undefined;
  if (!newCardInCache) {
    res.status(400).json({ error: "Card not found in local cache — search for it first to cache it." });
    return;
  }

  try {
    db.transaction(() => {
      const oldId = existing.scryfall_id;

      // Migrate every deck_cards row that uses the old scryfall_id.
      // This covers both explicitly linked rows (collection_card_id = id) and legacy unlinked rows.
      const affectedRows = db.prepare(
        "SELECT id, deck_id, quantity FROM deck_cards WHERE scryfall_id = ?"
      ).all(oldId) as { id: number; deck_id: number; quantity: number }[];

      for (const dc of affectedRows) {
        const conflict = db.prepare(
          "SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND scryfall_id = ? AND id != ?"
        ).get(dc.deck_id, scryfall_id, dc.id) as { id: number; quantity: number } | undefined;

        if (conflict) {
          // A row for (deck_id, new_scryfall_id) already exists — merge and remove the old row
          db.prepare("UPDATE deck_cards SET quantity = quantity + ? WHERE id = ?").run(dc.quantity, conflict.id);
          db.prepare("DELETE FROM deck_cards WHERE id = ?").run(dc.id);
        } else {
          // Simple swap
          db.prepare("UPDATE deck_cards SET scryfall_id = ?, collection_card_id = NULL WHERE id = ?").run(scryfall_id, dc.id);
        }
      }

      // Swap the scryfall_id on the collection entry itself
      db.prepare("UPDATE collection_cards SET scryfall_id = ? WHERE id = ?").run(scryfall_id, id);
    })();

    res.json(getCollectionCardById(id));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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

// Helper: check whether removing `removingQty` copies of a collection entry would orphan deck assignments.
function wouldOrphanDeckCards(collectionCardId: number, scryfallId: string, removingQty: number): boolean {
  // If any deck_cards row directly references this collection entry, removing it orphans that assignment.
  const { linked } = db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) as linked FROM deck_cards WHERE collection_card_id = ?"
  ).get(collectionCardId) as { linked: number };
  if (linked > 0) return true;

  // For legacy deck_cards without collection_card_id, check by total owned vs total unlinked assigned.
  const { total: owned } = db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) as total FROM collection_cards WHERE scryfall_id = ?"
  ).get(scryfallId) as { total: number };
  const { total: unlinked } = db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) as total FROM deck_cards WHERE scryfall_id = ? AND collection_card_id IS NULL"
  ).get(scryfallId) as { total: number };
  return (owned - removingQty) < unlinked;
}

// DELETE /api/collection/bulk  ← must be before /:id
collectionRouter.delete("/bulk", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" });
    return;
  }
  for (const id of ids) {
    const card = getCollectionCardById(id);
    if (!card) continue;
    if (wouldOrphanDeckCards(card.id, card.scryfall_id, card.quantity)) {
      res.status(400).json({ error: `"${card.name}" is needed by a deck. Remove it from the deck first.` });
      return;
    }
  }
  let deleted = 0;
  for (const id of ids) {
    try { deleteCollectionCard(id); deleted++; } catch { /* skip */ }
  }
  res.json({ deleted });
});

// DELETE /api/collection/:id
collectionRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const card = getCollectionCardById(id);
  if (!card) {
    res.status(404).json({ error: "Collection entry not found" });
    return;
  }
  if (wouldOrphanDeckCards(card.id, card.scryfall_id, card.quantity)) {
    res.status(400).json({ error: `"${card.name}" is needed by a deck. Remove it from the deck first.` });
    return;
  }
  deleteCollectionCard(id);
  res.status(204).send();
});
