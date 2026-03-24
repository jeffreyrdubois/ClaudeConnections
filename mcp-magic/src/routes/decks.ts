import { Router } from "express";
import {
  getDecks, getDeckById, createDeck, updateDeck, deleteDeck,
  addCardToDeck, removeCardFromDeck, getDeckStats, checkCommanderLegality,
} from "../db/index.js";
import { getCardByName } from "../scryfall/client.js";

export const decksRouter = Router();

// GET /api/decks
decksRouter.get("/", (_req, res) => {
  res.json(getDecks());
});

// POST /api/decks
decksRouter.post("/", async (req, res) => {
  const body = req.body as {
    name?: string;
    commander_name?: string;
    commander_scryfall_id?: string;
    partner_name?: string;
    partner_scryfall_id?: string;
    description?: string;
  };

  if (!body.name?.trim()) {
    res.status(400).json({ error: "Deck name is required" });
    return;
  }

  let commanderScryfallId = body.commander_scryfall_id;
  let partnerScryfallId = body.partner_scryfall_id;

  try {
    // Resolve commander by name if needed
    if (!commanderScryfallId && body.commander_name) {
      const card = await getCardByName(body.commander_name);
      if (!card) {
        res.status(404).json({ error: `Commander "${body.commander_name}" not found on Scryfall` });
        return;
      }
      if (card.legalities?.commander !== "legal") {
        res.status(400).json({ error: `${card.name} is not legal as a commander` });
        return;
      }
      commanderScryfallId = card.id;
    }

    if (!partnerScryfallId && body.partner_name) {
      const card = await getCardByName(body.partner_name);
      if (!card) {
        res.status(404).json({ error: `Partner "${body.partner_name}" not found on Scryfall` });
        return;
      }
      partnerScryfallId = card.id;
    }

    const deck = createDeck({
      name: body.name.trim(),
      commander_scryfall_id: commanderScryfallId,
      partner_scryfall_id: partnerScryfallId,
      description: body.description?.trim(),
    });

    // Add commander to deck_cards if provided
    if (commanderScryfallId) {
      addCardToDeck({
        deck_id: deck.id,
        scryfall_id: commanderScryfallId,
        quantity: 1,
        is_commander: true,
        category: "Commander",
      });
    }
    if (partnerScryfallId) {
      addCardToDeck({
        deck_id: deck.id,
        scryfall_id: partnerScryfallId,
        quantity: 1,
        is_commander: true,
        category: "Commander",
      });
    }

    res.status(201).json(getDeckById(deck.id));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// GET /api/decks/:id
decksRouter.get("/:id", (req, res) => {
  const deck = getDeckById(parseInt(req.params.id));
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(deck);
});

// GET /api/decks/:id/stats
decksRouter.get("/:id/stats", (req, res) => {
  const stats = getDeckStats(parseInt(req.params.id));
  if (!stats) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(stats);
});

// GET /api/decks/:id/legality
decksRouter.get("/:id/legality", (req, res) => {
  const deck = getDeckById(parseInt(req.params.id));
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(checkCommanderLegality(deck));
});

// PATCH /api/decks/:id
decksRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!getDeckById(id)) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  const body = req.body as {
    name?: string;
    commander_name?: string;
    commander_scryfall_id?: string | null;
    partner_name?: string;
    partner_scryfall_id?: string | null;
    description?: string;
  };

  try {
    let commanderScryfallId = body.commander_scryfall_id;
    if (body.commander_name && !commanderScryfallId) {
      const card = await getCardByName(body.commander_name);
      if (!card) {
        res.status(404).json({ error: `Commander "${body.commander_name}" not found` });
        return;
      }
      commanderScryfallId = card.id;
    }

    const updated = updateDeck(id, {
      name: body.name?.trim(),
      commander_scryfall_id: commanderScryfallId,
      partner_scryfall_id: body.partner_scryfall_id,
      description: body.description?.trim(),
    });
    res.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/decks/:id
decksRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!getDeckById(id)) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  deleteDeck(id);
  res.status(204).send();
});

// POST /api/decks/:id/cards
decksRouter.post("/:id/cards", async (req, res) => {
  const deck_id = parseInt(req.params.id);
  const deck = getDeckById(deck_id);
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  const body = req.body as {
    name?: string;
    scryfall_id?: string;
    quantity?: number;
    is_commander?: boolean;
    category?: string;
  };

  let scryfallId = body.scryfall_id;
  if (!scryfallId) {
    if (!body.name) {
      res.status(400).json({ error: "Card name or scryfall_id required" });
      return;
    }
    try {
      const card = await getCardByName(body.name);
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

  try {
    const dc = addCardToDeck({
      deck_id,
      scryfall_id: scryfallId,
      quantity: Math.max(1, body.quantity || 1),
      is_commander: body.is_commander ?? false,
      category: body.category,
    });
    res.status(201).json(dc);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/decks/:id/cards/:scryfallId
decksRouter.delete("/:id/cards/:scryfallId", (req, res) => {
  const deck_id = parseInt(req.params.id);
  if (!getDeckById(deck_id)) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  removeCardFromDeck(deck_id, req.params.scryfallId);
  res.status(204).send();
});
