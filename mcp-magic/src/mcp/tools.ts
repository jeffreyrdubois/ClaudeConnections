import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getCollection, getCollectionStats, getTotalCollectionValue,
  getCardQuantityInCollection, addCollectionCard, deleteCollectionCard,
  getFolders, getFolderById, createFolder, deleteFolder,
  getDecks, getDeckById, createDeck, deleteDeck,
  addCardToDeck, removeCardFromDeck, getDeckStats, checkCommanderLegality,
  getUnassignedCards, upsertScryfallCard, db,
} from "../db/index.js";
import { getCardByName, searchScryfall, getCardPrice } from "../scryfall/client.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}
function fmt(value: number) {
  return `$${value.toFixed(2)}`;
}

// ── MCP Server Factory ─────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "mcp-magic", version: "1.0.0" });

  // ── COLLECTION TOOLS ────────────────────────────────────────────────────────

  server.tool(
    "search_collection",
    "Search cards in the Magic collection. Filter by name, owner, colors (W/U/B/R/G), card type, folder, foil status, condition, or rarity. Use owner='Jeffrey' or owner='Abby' to scope results to one person's cards.",
    {
      query: z.string().optional().describe("Partial card name to search for"),
      owner: z.string().optional().describe("Filter by card owner ('Jeffrey' or 'Abby'). Omit to see all cards."),
      colors: z.array(z.enum(["W", "U", "B", "R", "G", "C"])).optional().describe("Filter by color identity (W=White, U=Blue, B=Black, R=Red, G=Green, C=Colorless)"),
      type: z.string().optional().describe("Filter by card type (e.g., 'Creature', 'Instant', 'Land')"),
      rarity: z.enum(["common", "uncommon", "rare", "mythic"]).optional().describe("Filter by rarity"),
      folder: z.string().optional().describe("Folder name to filter by"),
      foil: z.boolean().optional().describe("Filter for foil or non-foil only"),
      condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).optional().describe("Filter by card condition"),
      deck_id: z.enum(["none"]).optional().describe("Pass 'none' to only show cards not assigned to any deck"),
    },
    async ({ query, owner, colors, type, rarity, folder, foil, condition, deck_id }) => {
      try {
        let folder_id: number | null | undefined = undefined;
        if (folder) {
          const folders = getFolders();
          const f = folders.find((f) => f.name.toLowerCase().includes(folder.toLowerCase()));
          if (!f) return err(`Folder "${folder}" not found`);
          folder_id = f.id;
        }

        const cards = getCollection({ search: query, owner, colors, type, rarity, foil, condition, folder_id, deck_id });
        const summary = cards.map((c) => ({
          id: c.id,
          name: c.name,
          set: `${c.set_code.toUpperCase()} #${c.collector_number}`,
          quantity: c.quantity,
          foil: c.foil,
          condition: c.condition,
          owner: c.owner,
          folder: c.folder_name,
          deck: c.deck_name,
          mana_cost: c.mana_cost,
          type_line: c.type_line,
          rarity: c.rarity,
          price_usd: c.foil ? (c.prices?.usd_foil || c.prices?.usd || "N/A") : (c.prices?.usd || "N/A"),
          color_identity: c.color_identity,
        }));
        return ok({ total_results: summary.length, cards: summary });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_collection_value",
    "Get the total estimated market value of the collection, optionally scoped to one owner or a specific folder.",
    {
      owner: z.string().optional().describe("Owner to scope the value to ('Jeffrey' or 'Abby'). Omit for combined total."),
      folder: z.string().optional().describe("Folder name to get value for (omit for full collection)"),
    },
    async ({ owner, folder }) => {
      try {
        let folder_id: number | null | undefined = undefined;
        let folderName = owner ? `${owner}'s collection` : "entire collection";

        if (folder) {
          const folders = getFolders();
          const f = folders.find((fol) => fol.name.toLowerCase().includes(folder.toLowerCase()));
          if (!f) return err(`Folder "${folder}" not found`);
          folder_id = f.id;
          folderName = f.name;
        }

        const stats = getCollectionStats({ owner, folder_id: folder_id });
        const totalValue = owner || folder_id !== undefined
          ? stats.topByValue.reduce((s, c) => s + parseFloat(c.prices?.usd || "0") * c.qty, 0)
          : getTotalCollectionValue(folder_id);

        return ok({
          scope: folderName,
          total_value: fmt(totalValue),
          total_cards: stats.totals.total_quantity,
          unique_cards: stats.totals.unique_cards,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_card_quantity",
    "Check how many copies of a specific card are in the collection, including condition and foil breakdown.",
    {
      card_name: z.string().describe("Card name to look up"),
    },
    async ({ card_name }) => {
      try {
        const { total, entries } = getCardQuantityInCollection(card_name);
        if (total === 0) {
          return ok({ card_name, owned: false, total: 0, message: `No copies of "${card_name}" in collection` });
        }
        return ok({
          card_name: entries[0]?.name || card_name,
          owned: true,
          total,
          breakdown: entries.map((e) => ({
            quantity: e.quantity,
            condition: e.condition,
            foil: e.foil,
            folder: e.folder_name,
            price_usd: e.foil ? (e.prices?.usd_foil || e.prices?.usd || "N/A") : (e.prices?.usd || "N/A"),
          })),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_card_price",
    "Look up the current Scryfall market price for any Magic card.",
    {
      card_name: z.string().describe("Card name to look up"),
      set_code: z.string().optional().describe("Optional set code to get a specific printing (e.g., 'lea', 'm21')"),
    },
    async ({ card_name, set_code }) => {
      try {
        const card = await getCardByName(card_name, set_code);
        if (!card) return err(`Card "${card_name}" not found on Scryfall`);
        return ok({
          name: card.name,
          set: `${card.set_code.toUpperCase()} - ${card.set_name}`,
          rarity: card.rarity,
          price_usd: card.prices?.usd || "N/A",
          price_usd_foil: card.prices?.usd_foil || "N/A",
          price_eur: card.prices?.eur || "N/A",
          price_eur_foil: card.prices?.eur_foil || "N/A",
          mana_cost: card.mana_cost,
          type_line: card.type_line,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "add_card_to_collection",
    "Add one or more copies of a card to the collection. Fetches card data from Scryfall automatically.",
    {
      card_name: z.string().describe("Card name to add"),
      owner: z.string().optional().describe("Owner of the card ('Jeffrey' or 'Abby')"),
      quantity: z.number().int().min(1).default(1).describe("Number of copies to add"),
      foil: z.boolean().default(false).describe("Whether the card is foil"),
      condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).default("NM").describe("Card condition"),
      set_code: z.string().optional().describe("Optional set code for a specific printing"),
      folder: z.string().optional().describe("Folder name to place the card in"),
      language: z.string().default("en").describe("Card language (e.g., 'en', 'jp', 'de')"),
      purchase_price: z.number().optional().describe("Price you paid (optional)"),
    },
    async ({ card_name, owner, quantity, foil, condition, set_code, folder, language, purchase_price }) => {
      try {
        const card = await getCardByName(card_name, set_code);
        if (!card) return err(`Card "${card_name}" not found on Scryfall`);

        let folder_id: number | null = null;
        if (folder) {
          const folders = getFolders();
          const f = folders.find((fol) => fol.name.toLowerCase().includes(folder.toLowerCase()));
          if (!f) return err(`Folder "${folder}" not found. Create it first.`);
          folder_id = f.id;
        }

        upsertScryfallCard(card);
        const entry = addCollectionCard({
          scryfall_id: card.id,
          folder_id,
          quantity,
          foil,
          condition,
          language,
          purchase_price,
          owner: owner ?? null,
        });

        return ok({
          success: true,
          message: `Added ${quantity}x ${card.name} (${condition}${foil ? ", Foil" : ""}) to collection`,
          card: { name: card.name, set: card.set_code.toUpperCase(), mana_cost: card.mana_cost, type_line: card.type_line },
          entry_id: entry.id,
          current_price: fmt(getCardPrice(card, foil)),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "remove_card_from_collection",
    "Remove a card entry from the collection by its collection entry ID.",
    {
      entry_id: z.number().int().describe("Collection entry ID (from search_collection results)"),
    },
    async ({ entry_id }) => {
      try {
        const entry = db.prepare("SELECT cc.id, sc.name FROM collection_cards cc JOIN scryfall_cards sc ON sc.id = cc.scryfall_id WHERE cc.id = ?").get(entry_id) as { id: number; name: string } | undefined;
        if (!entry) return err(`Collection entry ${entry_id} not found`);
        deleteCollectionCard(entry_id);
        return ok({ success: true, message: `Removed collection entry for "${entry.name}"` });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_collection_stats",
    "Get comprehensive statistics for the collection: value, card counts, rarity breakdown, color distribution, top valuable cards. Can be scoped to one owner.",
    {
      owner: z.string().optional().describe("Owner to scope stats to ('Jeffrey' or 'Abby'). Omit for combined stats."),
    },
    async ({ owner }) => {
      try {
        const stats = getCollectionStats({ owner });
        const totalValue = getTotalCollectionValue();

        const colorNames: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
        const colorDist: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        for (const row of stats.byColor) {
          for (const c of row.color_identity) {
            colorDist[c] = (colorDist[c] || 0) + row.count;
          }
          if (row.color_identity.length === 0) colorDist["C"] = (colorDist["C"] || 0) + row.count;
        }

        const typeMap: Record<string, number> = {};
        for (const row of stats.byType) {
          const main = getMainType(row.type_line || "");
          typeMap[main] = (typeMap[main] || 0) + row.count;
        }

        return ok({
          total_value: fmt(totalValue),
          unique_cards: stats.totals.unique_cards,
          total_copies: stats.totals.total_quantity,
          collection_entries: stats.totals.unique_entries,
          rarity_breakdown: stats.byRarity.reduce((acc, r) => {
            acc[r.rarity || "unknown"] = { unique: r.unique_cards, copies: r.total_copies };
            return acc;
          }, {} as Record<string, { unique: number; copies: number }>),
          color_distribution: Object.entries(colorDist).reduce((acc, [k, v]) => {
            acc[colorNames[k] || k] = v;
            return acc;
          }, {} as Record<string, number>),
          type_breakdown: typeMap,
          top_10_by_value: stats.topByValue.slice(0, 10).map((c) => ({
            name: c.name,
            price: fmt(parseFloat(c.prices?.usd || "0")),
            quantity: c.qty,
            total_value: fmt(parseFloat(c.prices?.usd || "0") * c.qty),
          })),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── FOLDER TOOLS ─────────────────────────────────────────────────────────────

  server.tool(
    "list_folders",
    "List all collection folders with card counts and estimated values.",
    {},
    async () => {
      try {
        const folders = getFolders();
        const result = folders.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          card_count: f.card_count,
          value: fmt(getTotalCollectionValue(f.id)),
        }));
        return ok({ folders: result, total_folders: result.length });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "create_folder",
    "Create a new collection folder.",
    {
      name: z.string().describe("Folder name"),
      description: z.string().optional().describe("Optional description"),
    },
    async ({ name, description }) => {
      try {
        const folder = createFolder(name.trim(), description?.trim());
        return ok({ success: true, folder });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "delete_folder",
    "Delete a collection folder (cards in it will be unassigned, not deleted).",
    {
      folder: z.string().describe("Folder name to delete"),
    },
    async ({ folder }) => {
      try {
        const folders = getFolders();
        const f = folders.find((fol) => fol.name.toLowerCase().includes(folder.toLowerCase()));
        if (!f) return err(`Folder "${folder}" not found`);
        deleteFolder(f.id);
        return ok({ success: true, message: `Folder "${f.name}" deleted. ${f.card_count} cards were unassigned.` });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── DECK TOOLS ───────────────────────────────────────────────────────────────

  server.tool(
    "list_decks",
    "List all Commander decks with card counts, owners, and commanders. Use owner filter to see only one person's decks.",
    {
      owner: z.string().optional().describe("Filter decks by owner ('Jeffrey' or 'Abby')"),
    },
    async ({ owner }) => {
      try {
        let decks = getDecks();
        if (owner) {
          decks = decks.filter((d) => d.owner?.toLowerCase() === owner.toLowerCase());
        }
        return ok({
          decks: decks.map((d) => ({
            id: d.id,
            name: d.name,
            owner: d.owner,
            commander: d.commander_name,
            partner: d.partner_name,
            color_identity: d.commander_colors,
            card_count: d.card_count,
          })),
          total_decks: decks.length,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_deck",
    "Get full details for a deck including all cards, statistics, and commander legality.",
    {
      deck_name: z.string().describe("Deck name (partial match accepted)"),
    },
    async ({ deck_name }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);

        const deck = getDeckById(found.id)!;
        const stats = getDeckStats(found.id)!;
        const legality = checkCommanderLegality(deck);

        return ok({
          name: deck.name,
          commander: deck.commander_name,
          partner: deck.partner_name,
          description: deck.description,
          card_count: stats.card_count,
          land_count: stats.land_count,
          mana_producers: stats.mana_producer_count,
          total_value: fmt(stats.total_value),
          legal: legality.legal,
          legality_issues: legality.issues,
          mana_curve: stats.mana_curve,
          color_distribution: stats.color_distribution,
          type_breakdown: stats.type_breakdown,
          cards: deck.cards.map((c) => ({
            name: c.card.name,
            quantity: c.quantity,
            category: c.category,
            is_commander: c.is_commander,
            mana_cost: c.card.mana_cost,
            type_line: c.card.type_line,
            price: fmt(parseFloat(c.card.prices?.usd || "0")),
            color_identity: c.card.color_identity,
          })),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "create_deck",
    "Create a new Commander deck. Provide a commander name to look it up on Scryfall.",
    {
      name: z.string().describe("Deck name"),
      owner: z.string().optional().describe("Deck owner ('Jeffrey' or 'Abby')"),
      commander_name: z.string().describe("Commander card name"),
      partner_name: z.string().optional().describe("Partner commander name (if applicable)"),
      description: z.string().optional().describe("Deck description or strategy notes"),
    },
    async ({ name, owner, commander_name, partner_name, description }) => {
      try {
        const commander = await getCardByName(commander_name);
        if (!commander) return err(`Commander "${commander_name}" not found on Scryfall`);
        if (commander.legalities?.commander !== "legal") {
          return err(`${commander.name} is not legal as a commander`);
        }

        let partnerCard = null;
        if (partner_name) {
          partnerCard = await getCardByName(partner_name);
          if (!partnerCard) return err(`Partner "${partner_name}" not found on Scryfall`);
        }

        upsertScryfallCard(commander);
        if (partnerCard) upsertScryfallCard(partnerCard);

        const deck = createDeck({
          name: name.trim(),
          commander_scryfall_id: commander.id,
          partner_scryfall_id: partnerCard?.id,
          description: description?.trim(),
          owner: owner?.trim(),
        });

        addCardToDeck({ deck_id: deck.id, scryfall_id: commander.id, quantity: 1, is_commander: true, category: "Commander" });
        if (partnerCard) {
          addCardToDeck({ deck_id: deck.id, scryfall_id: partnerCard.id, quantity: 1, is_commander: true, category: "Commander" });
        }

        return ok({
          success: true,
          message: `Created deck "${name}" with ${commander.name} as commander`,
          deck_id: deck.id,
          commander_color_identity: commander.color_identity,
          commander_oracle_text: commander.oracle_text,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "delete_deck",
    "Delete a Commander deck.",
    {
      deck_name: z.string().describe("Deck name to delete"),
    },
    async ({ deck_name }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);
        deleteDeck(found.id);
        return ok({ success: true, message: `Deck "${found.name}" deleted` });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "add_card_to_deck",
    "Add a card to a Commander deck. Fetches card data from Scryfall if needed.",
    {
      deck_name: z.string().describe("Deck name (partial match)"),
      card_name: z.string().describe("Card name to add"),
      quantity: z.number().int().min(1).default(1).describe("Quantity (usually 1 for Commander)"),
      category: z.string().optional().describe("Card category (e.g., 'Ramp', 'Card Draw', 'Removal', 'Wincon', 'Lands', 'Creatures')"),
    },
    async ({ deck_name, card_name, quantity, category }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);

        const card = await getCardByName(card_name);
        if (!card) return err(`Card "${card_name}" not found on Scryfall`);
        if (card.legalities?.commander === "banned") {
          return err(`${card.name} is banned in Commander`);
        }

        upsertScryfallCard(card);
        addCardToDeck({ deck_id: found.id, scryfall_id: card.id, quantity, is_commander: false, category });

        const deck = getDeckById(found.id)!;
        const total = deck.cards.reduce((s, c) => s + c.quantity, 0);

        return ok({
          success: true,
          message: `Added ${card.name} to "${found.name}"`,
          card_count_now: total,
          note: total === 100 ? "Deck is now at 100 cards!" : `${100 - total} cards remaining to reach 100`,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "remove_card_from_deck",
    "Remove a card from a Commander deck.",
    {
      deck_name: z.string().describe("Deck name (partial match)"),
      card_name: z.string().describe("Card name to remove"),
    },
    async ({ deck_name, card_name }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);

        const deck = getDeckById(found.id)!;
        const dc = deck.cards.find((c) => c.card.name.toLowerCase().includes(card_name.toLowerCase()));
        if (!dc) return err(`Card "${card_name}" not found in deck "${found.name}"`);

        removeCardFromDeck(found.id, dc.scryfall_id);
        return ok({ success: true, message: `Removed "${dc.card.name}" from deck "${found.name}"` });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "check_deck_legality",
    "Check Commander format legality for a deck. Returns any issues found.",
    {
      deck_name: z.string().describe("Deck name to check"),
    },
    async ({ deck_name }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);

        const deck = getDeckById(found.id)!;
        const result = checkCommanderLegality(deck);
        return ok({
          deck: found.name,
          commander: found.commander_name,
          ...result,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "analyze_deck",
    "Get detailed statistics and analysis for a deck: mana curve, color distribution, type breakdown, mana production, and total value.",
    {
      deck_name: z.string().describe("Deck name to analyze"),
    },
    async ({ deck_name }) => {
      try {
        const decks = getDecks();
        const found = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!found) return err(`Deck "${deck_name}" not found`);

        const stats = getDeckStats(found.id)!;
        const deck = getDeckById(found.id)!;

        // Categorize mana producers
        const manaProducers = deck.cards
          .filter((c) => c.card.produced_mana && c.card.produced_mana.length > 0)
          .map((c) => ({ name: c.card.name, produces: c.card.produced_mana, type: c.card.type_line }));

        // Avg CMC (non-land)
        const nonLandCards = deck.cards.filter((c) => !c.is_commander && !c.card.type_line?.toLowerCase().includes("land"));
        const totalCmc = nonLandCards.reduce((s, c) => s + c.card.cmc * c.quantity, 0);
        const totalNonLandQty = nonLandCards.reduce((s, c) => s + c.quantity, 0);
        const avgCmc = totalNonLandQty ? (totalCmc / totalNonLandQty).toFixed(2) : "0";

        return ok({
          deck: found.name,
          commander: found.commander_name,
          card_count: stats.card_count,
          land_count: stats.land_count,
          mana_producer_count: stats.mana_producer_count,
          avg_cmc: avgCmc,
          total_value: fmt(stats.total_value),
          legal: stats.legality.legal,
          legality_issues: stats.legality.issues,
          mana_curve: Object.entries(stats.mana_curve).map(([cmc, count]) => ({
            cmc: cmc === "7" ? "7+" : cmc,
            count,
          })),
          color_distribution: stats.color_distribution,
          type_breakdown: stats.type_breakdown,
          mana_producers: manaProducers.slice(0, 20),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "compare_decks",
    "Compare two decks to identify strategic differences, shared cards, and relative strengths/weaknesses.",
    {
      deck1: z.string().describe("First deck name"),
      deck2: z.string().describe("Second deck name"),
    },
    async ({ deck1, deck2 }) => {
      try {
        const decks = getDecks();
        const d1 = decks.find((d) => d.name.toLowerCase().includes(deck1.toLowerCase()));
        const d2 = decks.find((d) => d.name.toLowerCase().includes(deck2.toLowerCase()));
        if (!d1) return err(`Deck "${deck1}" not found`);
        if (!d2) return err(`Deck "${deck2}" not found`);

        const detail1 = getDeckById(d1.id)!;
        const detail2 = getDeckById(d2.id)!;
        const stats1 = getDeckStats(d1.id)!;
        const stats2 = getDeckStats(d2.id)!;

        const names1 = new Set(detail1.cards.map((c) => c.card.name));
        const names2 = new Set(detail2.cards.map((c) => c.card.name));
        const shared = [...names1].filter((n) => names2.has(n));
        const only1 = [...names1].filter((n) => !names2.has(n));
        const only2 = [...names2].filter((n) => !names1.has(n));

        return ok({
          deck1: {
            name: d1.name,
            commander: d1.commander_name,
            colors: d1.commander_colors,
            card_count: stats1.card_count,
            land_count: stats1.land_count,
            avg_cmc: (() => {
              const nl = detail1.cards.filter((c) => !c.is_commander && !c.card.type_line?.toLowerCase().includes("land"));
              const tot = nl.reduce((s, c) => s + c.card.cmc * c.quantity, 0);
              const qty = nl.reduce((s, c) => s + c.quantity, 0);
              return qty ? (tot / qty).toFixed(2) : "0";
            })(),
            type_breakdown: stats1.type_breakdown,
            total_value: fmt(stats1.total_value),
          },
          deck2: {
            name: d2.name,
            commander: d2.commander_name,
            colors: d2.commander_colors,
            card_count: stats2.card_count,
            land_count: stats2.land_count,
            avg_cmc: (() => {
              const nl = detail2.cards.filter((c) => !c.is_commander && !c.card.type_line?.toLowerCase().includes("land"));
              const tot = nl.reduce((s, c) => s + c.card.cmc * c.quantity, 0);
              const qty = nl.reduce((s, c) => s + c.quantity, 0);
              return qty ? (tot / qty).toFixed(2) : "0";
            })(),
            type_breakdown: stats2.type_breakdown,
            total_value: fmt(stats2.total_value),
          },
          comparison: {
            shared_cards: shared,
            only_in_deck1: only1,
            only_in_deck2: only2,
            shared_card_count: shared.length,
          },
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_unassigned_cards",
    "Get all cards not assigned to any deck. Filter by owner to see only one person's available cards. Useful for finding cards to add to an existing deck.",
    {
      owner: z.string().optional().describe("Owner to filter by ('Jeffrey' or 'Abby'). Omit to see all unassigned cards regardless of owner."),
      color_identity: z.array(z.enum(["W", "U", "B", "R", "G", "C"])).optional().describe("Filter to cards that fit within a specific color identity"),
      type: z.string().optional().describe("Filter by card type"),
    },
    async ({ owner, color_identity, type }) => {
      try {
        let cards = getUnassignedCards(color_identity);
        if (owner) {
          cards = cards.filter((c) => c.owner?.toLowerCase() === owner.toLowerCase());
        }
        if (type) {
          cards = cards.filter((c) => c.type_line?.toLowerCase().includes(type.toLowerCase()));
        }
        return ok({
          total_unassigned: cards.length,
          total_quantity: cards.reduce((s, c) => s + c.quantity, 0),
          cards: cards.map((c) => ({
            name: c.name,
            type_line: c.type_line,
            mana_cost: c.mana_cost,
            color_identity: c.color_identity,
            quantity: c.quantity,
            owner: c.owner,
            folder: c.folder_name,
            price_usd: c.prices?.usd || "N/A",
          })),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "build_deck_from_collection",
    "Suggest a Commander deck built from one owner's unassigned cards. Returns available cards that fit within the commander's color identity, organized by type.",
    {
      commander_name: z.string().describe("Proposed commander name"),
      owner: z.string().optional().describe("Owner whose unassigned cards to draw from ('Jeffrey' or 'Abby'). Omit to consider all unassigned cards."),
    },
    async ({ commander_name, owner }) => {
      try {
        const commander = await getCardByName(commander_name);
        if (!commander) return err(`Commander "${commander_name}" not found on Scryfall`);
        if (commander.legalities?.commander !== "legal") {
          return err(`${commander.name} is not legal as a commander`);
        }

        const colorIdentity = commander.color_identity;
        let unassigned = getUnassignedCards(colorIdentity.length > 0 ? colorIdentity : undefined);
        if (owner) {
          unassigned = unassigned.filter((c) => c.owner?.toLowerCase() === owner.toLowerCase());
        }

        // Categorize cards for deck building suggestions
        const lands = unassigned.filter((c) => c.type_line?.includes("Land"));
        const creatures = unassigned.filter((c) => c.type_line?.includes("Creature") && !c.type_line?.includes("Land"));
        const instants = unassigned.filter((c) => c.type_line?.includes("Instant"));
        const sorceries = unassigned.filter((c) => c.type_line?.includes("Sorcery"));
        const artifacts = unassigned.filter((c) => c.type_line?.includes("Artifact") && !c.type_line?.includes("Creature"));
        const enchantments = unassigned.filter((c) => c.type_line?.includes("Enchantment") && !c.type_line?.includes("Creature"));
        const planeswalkers = unassigned.filter((c) => c.type_line?.includes("Planeswalker"));

        const summarize = (cards: typeof unassigned) =>
          cards.slice(0, 30).map((c) => ({ name: c.name, mana_cost: c.mana_cost, type_line: c.type_line, qty: c.quantity }));

        return ok({
          commander: commander.name,
          commander_color_identity: colorIdentity,
          commander_oracle_text: commander.oracle_text,
          available_cards: unassigned.length,
          breakdown: {
            lands: { count: lands.length, cards: summarize(lands) },
            creatures: { count: creatures.length, cards: summarize(creatures) },
            instants: { count: instants.length, cards: summarize(instants) },
            sorceries: { count: sorceries.length, cards: summarize(sorceries) },
            artifacts: { count: artifacts.length, cards: summarize(artifacts) },
            enchantments: { count: enchantments.length, cards: summarize(enchantments) },
            planeswalkers: { count: planeswalkers.length, cards: summarize(planeswalkers) },
          },
          recommendation: `Found ${unassigned.length} unassigned cards fitting ${commander.name}'s ${colorIdentity.join("")} color identity. Create a deck with this commander and then add cards from these categories to build your 99.`,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "suggest_deck_upgrades",
    "Analyze an existing deck and suggest upgrades from a specific owner's unassigned collection cards. Optionally provide an opponent's deck to tailor suggestions toward countering their strategy. This powers questions like 'what cards from my collection would strengthen my Avatar deck against Abby's Dragon deck?'",
    {
      deck_name: z.string().describe("Name of the deck to upgrade (partial match)"),
      owner: z.string().describe("Owner whose unassigned cards to draw from ('Jeffrey' or 'Abby')"),
      opponent_deck: z.string().optional().describe("Opponent's deck name to counter (partial match). Providing this focuses suggestions on strategic matchup."),
    },
    async ({ deck_name, owner, opponent_deck }) => {
      try {
        const decks = getDecks();
        const myDeck = decks.find((d) => d.name.toLowerCase().includes(deck_name.toLowerCase()));
        if (!myDeck) return err(`Deck "${deck_name}" not found`);

        const myDeckDetail = getDeckById(myDeck.id)!;
        const myDeckStats = getDeckStats(myDeck.id)!;

        // Get color identity of the deck from the commander
        const colorIdentity = myDeck.commander_colors ?? [];

        // Get owner's unassigned cards that fit the deck's color identity
        let available = getUnassignedCards(colorIdentity.length > 0 ? colorIdentity : undefined);
        available = available.filter((c) => c.owner?.toLowerCase() === owner.toLowerCase());

        // Cards already in the deck (to avoid duplicates)
        const inDeckNames = new Set(myDeckDetail.cards.map((c) => c.card.name.toLowerCase()));
        available = available.filter((c) => !inDeckNames.has(c.name.toLowerCase()));

        // Categorize available cards
        const categorize = (cards: typeof available) => cards.map((c) => ({
          name: c.name,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          color_identity: c.color_identity,
          quantity: c.quantity,
          price_usd: c.prices?.usd || "N/A",
        }));

        const lands = available.filter((c) => c.type_line?.includes("Land"));
        const creatures = available.filter((c) => c.type_line?.includes("Creature") && !c.type_line?.includes("Land"));
        const instants = available.filter((c) => c.type_line?.includes("Instant"));
        const sorceries = available.filter((c) => c.type_line?.includes("Sorcery"));
        const artifacts = available.filter((c) => c.type_line?.includes("Artifact") && !c.type_line?.includes("Creature"));
        const enchantments = available.filter((c) => c.type_line?.includes("Enchantment") && !c.type_line?.includes("Creature"));
        const planeswalkers = available.filter((c) => c.type_line?.includes("Planeswalker"));

        const result: Record<string, unknown> = {
          my_deck: {
            name: myDeck.name,
            owner: myDeck.owner,
            commander: myDeck.commander_name,
            color_identity: colorIdentity,
            card_count: myDeckStats.card_count,
            land_count: myDeckStats.land_count,
            type_breakdown: myDeckStats.type_breakdown,
            current_cards: myDeckDetail.cards.map((c) => ({
              name: c.card.name,
              type_line: c.card.type_line,
              mana_cost: c.card.mana_cost,
              category: c.category,
            })),
          },
          available_upgrades: {
            total_available: available.length,
            lands: { count: lands.length, cards: categorize(lands) },
            creatures: { count: creatures.length, cards: categorize(creatures) },
            instants: { count: instants.length, cards: categorize(instants) },
            sorceries: { count: sorceries.length, cards: categorize(sorceries) },
            artifacts: { count: artifacts.length, cards: categorize(artifacts) },
            enchantments: { count: enchantments.length, cards: categorize(enchantments) },
            planeswalkers: { count: planeswalkers.length, cards: categorize(planeswalkers) },
          },
        };

        // If an opponent deck is specified, include its full details for strategic analysis
        if (opponent_deck) {
          const oppDeck = decks.find((d) => d.name.toLowerCase().includes(opponent_deck.toLowerCase()));
          if (oppDeck) {
            const oppDetail = getDeckById(oppDeck.id)!;
            const oppStats = getDeckStats(oppDeck.id)!;
            result.opponent_deck = {
              name: oppDeck.name,
              owner: oppDeck.owner,
              commander: oppDeck.commander_name,
              color_identity: oppDeck.commander_colors,
              card_count: oppStats.card_count,
              type_breakdown: oppStats.type_breakdown,
              color_distribution: oppStats.color_distribution,
              avg_cmc: (() => {
                const nl = oppDetail.cards.filter((c) => !c.is_commander && !c.card.type_line?.toLowerCase().includes("land"));
                const tot = nl.reduce((s, c) => s + c.card.cmc * c.quantity, 0);
                const qty = nl.reduce((s, c) => s + c.quantity, 0);
                return qty ? (tot / qty).toFixed(2) : "0";
              })(),
              cards: oppDetail.cards.map((c) => ({
                name: c.card.name,
                type_line: c.card.type_line,
                mana_cost: c.card.mana_cost,
                oracle_text: c.card.oracle_text,
                category: c.category,
              })),
            };
            result.context = `Use the opponent deck details and available_upgrades to recommend specific cards that address strategic gaps or counter the opponent's threats. Consider removal for their key creatures, interaction for their win conditions, and synergy with the commander.`;
          } else {
            result.opponent_deck_warning = `Deck "${opponent_deck}" not found — proceeding with general upgrade suggestions.`;
          }
        }

        return ok(result);
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── SCRYFALL SEARCH ──────────────────────────────────────────────────────────

  server.tool(
    "search_scryfall",
    "Search Scryfall for Magic cards using full Scryfall query syntax. Use this to find cards to add to a deck or collection.",
    {
      query: z.string().describe("Scryfall search query (e.g., 'c:red type:instant oracle:draw', 'commander:legal cmc<=3 c:G type:creature')"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max results to return"),
    },
    async ({ query, limit }) => {
      try {
        const result = await searchScryfall(query, { unique: "cards", order: "name" });
        return ok({
          total_found: result.total_cards,
          showing: Math.min(result.cards.length, limit),
          cards: result.cards.slice(0, limit).map((c) => ({
            name: c.name,
            mana_cost: c.mana_cost,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            color_identity: c.color_identity,
            cmc: c.cmc,
            price_usd: c.prices?.usd || "N/A",
            rarity: c.rarity,
            set: c.set_code.toUpperCase(),
          })),
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  return server;
}

function getMainType(typeLine: string): string {
  const types = ["Land", "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Battle"];
  for (const t of types) {
    if (typeLine.includes(t)) return t;
  }
  return "Other";
}
