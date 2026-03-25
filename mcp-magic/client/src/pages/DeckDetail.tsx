import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, AlertCircle, Plus, Trash2, Crown } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getDeck, getDeckStats, addCardToDeck, removeCardFromDeck, setCardAsCommander } from "../api/client";
import type { CollectionCard, DeckCard } from "../types";
import { RARITY_COLORS } from "../types";
import CollectionCardSearch from "../components/CollectionCardSearch";
import { ManaCost, ColorIdentity } from "../components/ManaSymbol";
import { HoverCardImage } from "../components/CardImage";
import ManaCurve from "../components/stats/ManaCurve";
import ColorPie from "../components/stats/ColorPie";
import TypeBreakdown from "../components/stats/TypeBreakdown";

const CATEGORIES = ["Commander", "Lands", "Ramp", "Card Draw", "Removal", "Counterspells", "Creatures", "Enchantments", "Artifacts", "Planeswalkers", "Wincon", "Utility", "Other"];

// Color identity → MTG guild/shard/wedge/clan name
function getDeckColorType(colors: string[]): string {
  const sorted = [...colors].sort().join("");
  const map: Record<string, string> = {
    "": "Colorless",
    "W": "Mono-White",
    "U": "Mono-Blue",
    "B": "Mono-Black",
    "R": "Mono-Red",
    "G": "Mono-Green",
    "UW": "Azorius",
    "BW": "Orzhov",
    "RW": "Boros",
    "GW": "Selesnya",
    "BU": "Dimir",
    "RU": "Izzet",
    "GU": "Simic",
    "BR": "Rakdos",
    "BG": "Golgari",
    "GR": "Gruul",
    "BUW": "Esper",
    "RUW": "Jeskai",
    "GUW": "Bant",
    "BRW": "Mardu",
    "BGW": "Abzan",
    "GRW": "Naya",
    "BRU": "Grixis",
    "BGU": "Sultai",
    "GRU": "Temur",
    "BGR": "Jund",
    "BRUW": "Yore-Tiller",
    "BGUW": "Witch-Maw",
    "GRUW": "Ink-Treader",
    "BGRW": "Dune-Brood",
    "BGRU": "Glint-Eye",
    "BGRUW": "Five-Color",
  };
  return map[sorted] || colors.join("");
}

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const deckId = parseInt(id!);
  const [showAddCard, setShowAddCard] = useState(false);
  const [addCategory, setAddCategory] = useState("Other");
  const [filterCategory, setFilterCategory] = useState("All");
  const queryClient = useQueryClient();

  const { data: deck, isLoading: deckLoading } = useQuery({
    queryKey: ["deck", deckId],
    queryFn: () => getDeck(deckId),
  });

  const { data: stats } = useQuery({
    queryKey: ["deck-stats", deckId],
    queryFn: () => getDeckStats(deckId),
    enabled: !!deck,
  });

  const addMutation = useMutation({
    mutationFn: ({ scryfallId, category }: { scryfallId: string; category: string }) =>
      addCardToDeck(deckId, { scryfall_id: scryfallId, category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck-stats", deckId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (scryfallId: string) => removeCardFromDeck(deckId, scryfallId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck-stats", deckId] });
    },
  });

  const commanderMutation = useMutation({
    mutationFn: ({ scryfallId, isCommander }: { scryfallId: string; isCommander: boolean }) =>
      setCardAsCommander(deckId, scryfallId, isCommander),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck-stats", deckId] });
    },
  });

  if (deckLoading) return <div className="flex items-center justify-center h-64 text-gray-500">Loading deck...</div>;
  if (!deck) return <div className="p-6 text-gray-500">Deck not found</div>;

  const cardCount = deck.cards.reduce((s, c) => s + c.quantity, 0);
  const legality = stats?.legality;
  const avgCmc = (() => {
    const nl = deck.cards.filter((c) => !c.is_commander && !c.card.type_line?.toLowerCase().includes("land"));
    const tot = nl.reduce((s, c) => s + c.card.cmc * c.quantity, 0);
    const qty = nl.reduce((s, c) => s + c.quantity, 0);
    return qty ? (tot / qty).toFixed(2) : "0";
  })();

  const commanderColors = deck.commander_colors || [];
  const deckType = getDeckColorType(commanderColors);

  // Group cards by category
  const categories = new Map<string, DeckCard[]>();
  for (const dc of deck.cards.filter((c) => !c.is_commander)) {
    const cat = dc.category || "Other";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(dc);
  }
  const sortedCategories = [...categories.entries()].sort(([a], [b]) => a.localeCompare(b));
  const allCategories = ["All", ...sortedCategories.map(([cat]) => cat)];

  const filteredCards = filterCategory === "All"
    ? deck.cards.filter((c) => !c.is_commander)
    : deck.cards.filter((c) => !c.is_commander && (c.category || "Other") === filterCategory);

  const commanders = deck.cards.filter((c) => c.is_commander);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-700/50 bg-surface-card shrink-0">
        <Link to="/decks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> All Decks
        </Link>

        <div className="flex items-start gap-6">
          {/* Commander image */}
          {deck.commander_image && (
            <div className="w-20 h-28 shrink-0 rounded-lg overflow-hidden shadow-xl">
              <img
                src={deck.commander_image}
                alt={deck.commander_name || "Commander"}
                className="w-full h-full object-cover object-[center_10%]"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
            {deck.commander_name ? (
              <div className="text-gray-400 mt-0.5">
                {deck.commander_name}
                {deck.partner_name && <span> / {deck.partner_name}</span>}
              </div>
            ) : (
              <div className="text-gray-600 mt-0.5 text-sm italic">No commander set — mark a card as commander below</div>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <ColorIdentity identity={commanderColors} />
              {commanderColors.length > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 bg-gray-700/50 rounded-full text-gray-300">
                  {deckType}
                </span>
              )}
              {legality && (
                <div className={`flex items-center gap-1.5 text-xs font-medium ${legality.legal ? "text-green-400" : "text-red-400"}`}>
                  {legality.legal
                    ? <><CheckCircle className="w-3.5 h-3.5" /> Legal</>
                    : <><AlertCircle className="w-3.5 h-3.5" /> {legality.issues.length} issue{legality.issues.length !== 1 ? "s" : ""}</>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex gap-4 shrink-0">
            <div className="text-center">
              <div className={`text-2xl font-bold ${cardCount === 100 ? "text-green-400" : cardCount > 100 ? "text-red-400" : "text-white"}`}>
                {cardCount}
              </div>
              <div className="text-xs text-gray-500">/ 100 cards</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">${(stats?.total_value || 0).toFixed(2)}</div>
              <div className="text-xs text-gray-500">est. value</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{avgCmc}</div>
              <div className="text-xs text-gray-500">avg. CMC</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{stats?.land_count || 0}</div>
              <div className="text-xs text-gray-500">lands</div>
            </div>
          </div>
        </div>

        {/* Legality issues */}
        {legality && !legality.legal && legality.issues.length > 0 && (
          <div className="mt-3 p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
            <div className="text-xs font-medium text-red-400 mb-1">Legality Issues:</div>
            <ul className="text-xs text-red-300 space-y-0.5">
              {legality.issues.slice(0, 5).map((issue, i) => <li key={i}>• {issue}</li>)}
              {legality.issues.length > 5 && <li className="text-red-500">...and {legality.issues.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Card list */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Add card bar */}
          <div className="p-4 border-b border-gray-700/30 flex gap-3 items-center shrink-0">
            {showAddCard ? (
              <>
                <CollectionCardSearch
                  onSelect={(card: CollectionCard) => {
                    addMutation.mutate({ scryfallId: card.scryfall_id, category: addCategory });
                    setShowAddCard(false);
                  }}
                  placeholder="Search your collection..."
                  className="flex-1"
                />
                <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="select w-40">
                  {CATEGORIES.filter((c) => c !== "Commander").map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => setShowAddCard(false)} className="btn-secondary text-sm">Cancel</button>
              </>
            ) : (
              <>
                {/* Category filter tabs */}
                <div className="flex gap-1 overflow-x-auto flex-1 pb-1">
                  {allCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        filterCategory === cat
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "text-gray-500 hover:text-gray-300 hover:bg-gray-700/50"
                      }`}
                    >
                      {cat}
                      {cat !== "All" && (
                        <span className="ml-1 text-gray-600">
                          ({categories.get(cat)?.reduce((s: number, c: DeckCard) => s + c.quantity, 0) || 0})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowAddCard(true)} className="btn-primary text-sm shrink-0">
                  <Plus className="w-4 h-4" /> Add Card
                </button>
              </>
            )}
          </div>

          {/* Cards table */}
          <div className="flex-1 overflow-auto">
            {/* Commanders */}
            {commanders.length > 0 && filterCategory === "All" && (
              <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
                <div className="text-xs font-medium text-amber-500 uppercase tracking-wider mb-2">Commander</div>
                {commanders.map((dc) => (
                  <CardRow
                    key={dc.id}
                    dc={dc}
                    onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                    onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: false })}
                    isCommander
                  />
                ))}
              </div>
            )}

            {/* Filtered cards */}
            {filteredCards.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                No cards in this category
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 sticky top-0 bg-surface">
                    <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider w-8"></th>
                    <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Name</th>
                    <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Mana</th>
                    <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Type</th>
                    <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Category</th>
                    <th className="text-right py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Price</th>
                    <th className="py-2.5 px-4 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCards
                    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name))
                    .map((dc) => (
                      <CardRow
                        key={dc.id}
                        dc={dc}
                        onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                        onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: true })}
                      />
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Stats sidebar */}
        {stats && (
          <div className="w-72 shrink-0 border-l border-gray-700/50 overflow-auto p-4 space-y-6">
            <ManaCurve curve={stats.mana_curve} title="Mana Curve" />
            <ColorPie distribution={stats.color_distribution} title="Color Distribution" />
            <TypeBreakdown types={stats.type_breakdown} title="Card Types" />

            {/* Mana production */}
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">Mana Production</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="stat-card">
                  <div className="stat-label">Lands</div>
                  <div className="stat-value text-xl">{stats.land_count}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Producers</div>
                  <div className="stat-value text-xl">{stats.mana_producer_count}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CardRow({ dc, onRemove, onSetCommander, isCommander = false }: {
  dc: DeckCard;
  onRemove: () => void;
  onSetCommander: () => void;
  isCommander?: boolean;
}) {
  const price = parseFloat(dc.card.prices?.usd || "0");

  return (
    <tr className="border-b border-gray-700/20 hover:bg-gray-800/30 transition-colors group">
      <td className="py-2 px-4">
        <HoverCardImage card={dc.card}>
          <div className="w-6 h-8 bg-gray-800 rounded overflow-hidden">
            {getThumb(dc.card) && (
              <img src={getThumb(dc.card)!} alt={dc.card.name} className="w-full h-full object-cover" loading="lazy" />
            )}
          </div>
        </HoverCardImage>
      </td>
      <td className="py-2 px-4">
        <div className="font-medium text-gray-100">{dc.card.name}</div>
        {dc.quantity > 1 && <div className="text-xs text-amber-400">×{dc.quantity}</div>}
      </td>
      <td className="py-2 px-4"><ManaCost cost={dc.card.mana_cost} size="sm" /></td>
      <td className="py-2 px-4 text-gray-400 text-xs max-w-32 truncate">{dc.card.type_line}</td>
      <td className="py-2 px-4">
        <span className={`text-xs px-2 py-0.5 rounded-full border ${
          isCommander
            ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
            : "bg-gray-700/50 text-gray-400 border-gray-700"
        }`}>
          {dc.category || "Other"}
        </span>
      </td>
      <td className="py-2 px-4 text-right text-xs text-amber-400">${price.toFixed(2)}</td>
      <td className="py-2 px-4">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Set/unset commander */}
          <button
            onClick={onSetCommander}
            title={isCommander ? "Remove as commander" : "Set as commander"}
            className={`btn-ghost p-1.5 rounded-md ${isCommander ? "text-amber-400 hover:text-gray-400" : "text-gray-500 hover:text-amber-400"}`}
          >
            <Crown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { if (confirm(`Remove ${dc.card.name} from deck?`)) onRemove(); }}
            className="btn-ghost p-1.5 rounded-md text-gray-500 hover:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getThumb(card: any): string | null {
  if (card.image_uris) return card.image_uris.small || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || null;
  }
  return null;
}
