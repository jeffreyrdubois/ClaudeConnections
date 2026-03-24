import { Router } from "express";
import { searchScryfall, getCardByName } from "../scryfall/client.js";
import { searchScryfallCache } from "../db/index.js";

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
