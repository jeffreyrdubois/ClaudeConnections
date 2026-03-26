import { Router } from "express";
import { searchScryfall, getCardByName } from "../scryfall/client.js";
import { searchScryfallCache, getOwnershipForNames } from "../db/index.js";

export const scryfallRouter = Router();

// GET /api/scryfall/search?q=&page=
// First checks local cache, falls back to Scryfall API
scryfallRouter.get("/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  const page = parseInt((req.query.page as string) || "1");

  try {
    // Check local cache first for quick autocomplete
    if (page === 1) {
      const cached = searchScryfallCache(q, 20);
      if (cached.length >= 5) {
        res.json({ cards: cached, total_cards: cached.length, has_more: false, source: "cache" });
        return;
      }
    }

    // Fall back to Scryfall API
    const result = await searchScryfall(q, { unique: "cards", order: "name", page });
    res.json({ ...result, source: "scryfall" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// GET /api/scryfall/shop?q=
// Like /search but also enriches each result with ownership counts from the collection
scryfallRouter.get("/shop", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q || q.length < 2) {
    res.json({ cards: [], total_cards: 0, has_more: false });
    return;
  }

  try {
    // Try local cache first
    const cached = searchScryfallCache(q, 20);
    let cards = cached;
    let meta = { total_cards: cached.length, has_more: false, source: "cache" };

    if (cached.length < 3) {
      const result = await searchScryfall(q, { unique: "cards", order: "name", page: 1 });
      cards = result.cards;
      meta = { total_cards: result.total_cards, has_more: result.has_more, source: "scryfall" };
    }

    const ownership = getOwnershipForNames(cards.map((c) => c.name));
    const enriched = cards.map((card) => {
      const o = ownership.get(card.name.toLowerCase());
      return { ...card, owned_copies: o?.total ?? 0, unassigned_copies: o?.unassigned ?? 0 };
    });

    res.json({ ...meta, cards: enriched });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// GET /api/scryfall/named?name=&set=
scryfallRouter.get("/named", async (req, res) => {
  const name = (req.query.name as string || "").trim();
  const set = (req.query.set as string || "").trim() || undefined;

  if (!name) {
    res.status(400).json({ error: "Card name is required" });
    return;
  }

  try {
    const card = await getCardByName(name, set);
    if (!card) {
      res.status(404).json({ error: `Card "${name}" not found` });
      return;
    }
    res.json(card);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
