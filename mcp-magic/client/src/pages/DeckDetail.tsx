import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, AlertCircle, Plus, Trash2, Crown, ChevronDown, ChevronUp, BarChart3, Pencil, ArrowUp, ArrowDown, ArrowUpDown, Layers } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getDeck, getDeckStats, addCardToDeck, removeCardFromDeck, setCardAsCommander, updateDeck } from "../api/client";
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
  const [showStats, setShowStats] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [aggregate, setAggregate] = useState(false);
  const [sortCol, setSortCol] = useState<"name" | "cmc" | "type" | "category" | "price">("cmc");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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

  const ownerMutation = useMutation({
    mutationFn: (owner: string | null) => updateDeck(deckId, { owner }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
      setEditingOwner(false);
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

  const baseFiltered = filterCategory === "All"
    ? deck.cards.filter((c) => !c.is_commander)
    : deck.cards.filter((c) => !c.is_commander && (c.category || "Other") === filterCategory);

  // Aggregate mode: collapse same scryfall_id rows, summing quantity
  const aggregatedCards = aggregate
    ? (() => {
        const map = new Map<string, DeckCard>();
        for (const dc of baseFiltered) {
          if (map.has(dc.scryfall_id)) {
            const ex = map.get(dc.scryfall_id)!;
            map.set(dc.scryfall_id, { ...ex, quantity: ex.quantity + dc.quantity });
          } else {
            map.set(dc.scryfall_id, { ...dc });
          }
        }
        return [...map.values()];
      })()
    : baseFiltered;

  function sortCards(cards: DeckCard[]): DeckCard[] {
    return [...cards].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":     cmp = a.card.name.localeCompare(b.card.name); break;
        case "cmc":      cmp = (a.card.cmc ?? 0) - (b.card.cmc ?? 0); break;
        case "type":     cmp = (a.card.type_line || "").localeCompare(b.card.type_line || ""); break;
        case "category": cmp = (a.category || "Other").localeCompare(b.category || "Other"); break;
        case "price":    cmp = parseFloat(a.card.prices?.usd || "0") - parseFloat(b.card.prices?.usd || "0"); break;
      }
      if (cmp === 0) cmp = a.card.name.localeCompare(b.card.name);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const filteredCards = sortCards(aggregatedCards);

  function handleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  function SortTh({ col, label, className }: { col: typeof sortCol; label: string; className?: string }) {
    const active = sortCol === col;
    return (
      <th
        onClick={() => handleSort(col)}
        className={`py-2.5 px-4 text-xs font-medium uppercase tracking-wider cursor-pointer select-none text-left transition-colors ${active ? "text-amber-400" : "text-gray-500 hover:text-gray-300"} ${className ?? ""}`}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active
            ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
            : <ArrowUpDown className="w-3 h-3 opacity-30" />}
        </span>
      </th>
    );
  }

  const commanders = deck.cards.filter((c) => c.is_commander);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 md:p-6 border-b border-gray-700/50 bg-surface-card shrink-0">
        <Link to="/decks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4" /> All Decks
        </Link>

        {/* Commander image + deck identity row */}
        <div className="flex items-start gap-3 md:gap-6">
          {deck.commander_image && (
            <div className="w-16 h-[88px] md:w-20 md:h-28 shrink-0 rounded-lg overflow-hidden shadow-xl">
              <img
                src={deck.commander_image}
                alt={deck.commander_name || "Commander"}
                className="w-full h-full object-cover object-[center_10%]"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-white leading-tight flex-1">{deck.name}</h1>
              {/* Owner badge / edit */}
              {editingOwner ? (
                <select
                  autoFocus
                  defaultValue={deck.owner || ""}
                  onChange={(e) => ownerMutation.mutate(e.target.value || null)}
                  onBlur={() => setEditingOwner(false)}
                  className="select text-xs py-1 w-28 shrink-0"
                >
                  <option value="">No owner</option>
                  <option value="Jeffrey">Jeffrey</option>
                  <option value="Abby">Abby</option>
                </select>
              ) : (
                <button
                  onClick={() => setEditingOwner(true)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 shrink-0 mt-0.5"
                  title="Set deck owner"
                >
                  {deck.owner ? (
                    <span className="px-2 py-0.5 bg-gray-700/60 rounded-full">{deck.owner}</span>
                  ) : (
                    <span className="px-2 py-0.5 border border-dashed border-gray-700 rounded-full text-gray-600 hover:border-gray-500">owner?</span>
                  )}
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
            {deck.commander_name ? (
              <div className="text-gray-400 text-sm mt-0.5 leading-snug">
                {deck.commander_name}
                {deck.partner_name && <span> / {deck.partner_name}</span>}
              </div>
            ) : (
              <div className="text-gray-600 mt-0.5 text-xs italic">No commander set</div>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <ColorIdentity identity={commanderColors} />
              {commanderColors.length > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 bg-gray-700/50 rounded-full text-gray-300">
                  {deckType}
                </span>
              )}
              {legality && (
                <button
                  onClick={() => setShowIssues((v) => !v)}
                  className={`flex items-center gap-1 text-xs font-medium ${legality.legal ? "text-green-400" : "text-red-400"}`}
                >
                  {legality.legal
                    ? <><CheckCircle className="w-3.5 h-3.5" /> Legal</>
                    : <><AlertCircle className="w-3.5 h-3.5" /> {legality.issues.length} issues {showIssues ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick stats — 4-column pill grid */}
        <div className="grid grid-cols-4 gap-2 mt-3">
          <div className="bg-gray-800/60 rounded-lg p-2 text-center">
            <div className={`text-lg md:text-2xl font-bold ${cardCount === 100 ? "text-green-400" : cardCount > 100 ? "text-red-400" : "text-white"}`}>
              {cardCount}
            </div>
            <div className="text-xs text-gray-500 leading-none mt-0.5">/ 100</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-2 text-center">
            <div className="text-lg md:text-2xl font-bold text-amber-400">${(stats?.total_value || 0).toFixed(0)}</div>
            <div className="text-xs text-gray-500 leading-none mt-0.5">value</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-2 text-center">
            <div className="text-lg md:text-2xl font-bold text-white">{avgCmc}</div>
            <div className="text-xs text-gray-500 leading-none mt-0.5">avg CMC</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-2 text-center">
            <div className="text-lg md:text-2xl font-bold text-blue-400">{stats?.land_count || 0}</div>
            <div className="text-xs text-gray-500 leading-none mt-0.5">lands</div>
          </div>
        </div>

        {/* Legality issues — collapsible */}
        {legality && !legality.legal && legality.issues.length > 0 && showIssues && (
          <div className="mt-3 p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
            <div className="text-xs font-medium text-red-400 mb-1">Legality Issues:</div>
            <ul className="text-xs text-red-300 space-y-0.5">
              {legality.issues.slice(0, 5).map((issue, i) => <li key={i}>• {issue}</li>)}
              {legality.issues.length > 5 && <li className="text-red-500">...and {legality.issues.length - 5} more</li>}
            </ul>
          </div>
        )}
        {/* Always show a compact legality badge when issues exist and panel is closed */}
        {legality && !legality.legal && !showIssues && (
          <div className="mt-2 text-xs text-red-400/70">
            Tap the issues badge above to see details
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Card list */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Add card bar */}
          <div className="px-3 py-2.5 md:p-4 border-b border-gray-700/30 shrink-0">
            {showAddCard ? (
              <div className="flex flex-col md:flex-row gap-2">
                <CollectionCardSearch
                  autoFocus
                  onSelect={(card: CollectionCard) => {
                    addMutation.mutate({ scryfallId: card.scryfall_id, category: addCategory });
                    setShowAddCard(false);
                  }}
                  placeholder="Search your collection..."
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="select flex-1 md:w-40">
                    {CATEGORIES.filter((c) => c !== "Commander").map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => setShowAddCard(false)} className="btn-secondary text-sm shrink-0">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                {/* Category filter tabs — horizontally scrollable */}
                <div className="flex gap-1 overflow-x-auto flex-1 pb-0.5" style={{ scrollbarWidth: "none" }}>
                  {allCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
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
                {/* Aggregate toggle */}
                <button
                  onClick={() => setAggregate((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                    aggregate ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300"
                  }`}
                  title={aggregate ? "Switch to individual view" : "Collapse duplicate cards"}
                >
                  <Layers className="w-3.5 h-3.5" />
                </button>
                {/* Mobile stats toggle */}
                {stats && (
                  <button
                    onClick={() => setShowStats((v) => !v)}
                    className={`md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                      showStats ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-gray-800 text-gray-500 border-gray-700"
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => setShowAddCard(true)} className="btn-primary text-xs py-1.5 px-2.5 shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Add Card</span>
                  <span className="sm:hidden">Add</span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile stats panel (collapsible) */}
          {stats && showStats && (
            <div className="md:hidden border-b border-gray-700/30 p-4 space-y-4 overflow-auto shrink-0 max-h-72">
              <ManaCurve curve={stats.mana_curve} title="Mana Curve" />
              <ColorPie distribution={stats.color_distribution} title="Color Distribution" />
              <TypeBreakdown types={stats.type_breakdown} title="Card Types" />
            </div>
          )}

          {/* Cards list */}
          <div className="flex-1 overflow-auto">
            {/* Commanders */}
            {commanders.length > 0 && filterCategory === "All" && (
              <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
                <div className="text-xs font-medium text-amber-500 uppercase tracking-wider mb-2">Commander</div>
                {/* Desktop table row */}
                <table className="hidden md:table w-full">
                  <tbody>
                    {commanders.map((dc) => (
                      <CardRow
                        key={dc.id}
                        dc={dc}
                        onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                        onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: false })}
                        isCommander
                      />
                    ))}
                  </tbody>
                </table>
                {/* Mobile card rows */}
                <div className="md:hidden space-y-1">
                  {commanders.map((dc) => (
                    <MobileDeckCardRow
                      key={dc.id}
                      dc={dc}
                      onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                      onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: false })}
                      isCommander
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Filtered cards */}
            {filteredCards.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">No cards in this category</div>
            ) : (
              <>
                {/* Desktop table */}
                <table className="hidden md:table w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50 sticky top-0 bg-surface">
                      <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider w-8"></th>
                      <SortTh col="name" label="Name" />
                      <SortTh col="cmc" label="Mana" />
                      <SortTh col="type" label="Type" />
                      <SortTh col="category" label="Category" />
                      {aggregate && <th className="text-center py-2.5 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Qty</th>}
                      <SortTh col="price" label="Price" className="text-right" />
                      <th className="py-2.5 px-4 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.map((dc) => (
                        <CardRow
                          key={dc.id}
                          dc={dc}
                          showQty={aggregate}
                          onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                          onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: true })}
                        />
                      ))}
                  </tbody>
                </table>

                {/* Mobile card list */}
                <ul className="md:hidden divide-y divide-gray-700/30">
                  {filteredCards.map((dc) => (
                      <MobileDeckCardRow
                        key={dc.id}
                        dc={dc}
                        onRemove={() => removeMutation.mutate(dc.scryfall_id)}
                        onSetCommander={() => commanderMutation.mutate({ scryfallId: dc.scryfall_id, isCommander: true })}
                      />
                    ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Stats sidebar — desktop only */}
        {stats && (
          <div className="hidden md:block w-72 shrink-0 border-l border-gray-700/50 overflow-auto p-4 space-y-6">
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

function CardRow({ dc, onRemove, onSetCommander, isCommander = false, showQty = false }: {
  dc: DeckCard;
  onRemove: () => void;
  onSetCommander: () => void;
  isCommander?: boolean;
  showQty?: boolean;
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
        {!showQty && dc.quantity > 1 && <div className="text-xs text-amber-400">×{dc.quantity}</div>}
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
      {showQty && <td className="py-2 px-4 text-center text-sm font-medium text-white">×{dc.quantity}</td>}
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

function MobileDeckCardRow({ dc, onRemove, onSetCommander, isCommander = false }: {
  dc: DeckCard;
  onRemove: () => void;
  onSetCommander: () => void;
  isCommander?: boolean;
}) {
  const price = parseFloat(dc.card.prices?.usd || "0");
  const thumb = getThumb(dc.card);

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {/* Thumbnail */}
      <HoverCardImage card={dc.card}>
        <div className="w-9 h-12 rounded-md overflow-hidden shrink-0 bg-gray-800 border border-gray-700/40">
          {thumb
            ? <img src={thumb} alt={dc.card.name} className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full" />
          }
        </div>
      </HoverCardImage>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-white text-sm leading-tight">{dc.card.name}</span>
          <span className="text-amber-400 text-xs font-medium shrink-0">${price.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <ManaCost cost={dc.card.mana_cost} size="sm" />
          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
            isCommander
              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
              : "bg-gray-700/50 text-gray-400 border-gray-700"
          }`}>
            {dc.category || "Other"}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onSetCommander}
          title={isCommander ? "Remove as commander" : "Set as commander"}
          className={`p-2 rounded-md ${isCommander ? "text-amber-400 hover:text-gray-400" : "text-gray-600 hover:text-amber-400"}`}
        >
          <Crown className="w-4 h-4" />
        </button>
        <button
          onClick={() => { if (confirm(`Remove ${dc.card.name}?`)) onRemove(); }}
          className="p-2 rounded-md text-gray-600 hover:text-red-400"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
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
