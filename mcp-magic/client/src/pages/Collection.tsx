import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Upload, Search, Filter, Trash2, Edit2, Layers, BarChart3, CheckSquare, X, ArrowUp, ArrowDown, ArrowUpDown, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getCollection, getFolders, getDecks, deleteCollectionCard, updateCollectionCard, bulkUpdateCards } from "../api/client";
import type { CollectionCard, Condition } from "../types";
import { CONDITION_LABELS, RARITY_COLORS } from "../types";
import AddCardModal from "../components/AddCardModal";
import ImportModal from "../components/ImportModal";
import { ManaCost, ColorIdentity } from "../components/ManaSymbol";
import { HoverCardImage } from "../components/CardImage";

const COLORS = ["W", "U", "B", "R", "G", "C"];
const OWNERS = ["Jeffrey", "Abby"];
const GROUP_BY_OPTIONS = ["Owner", "Folder", "Set"] as const;
type GroupByKey = (typeof GROUP_BY_OPTIONS)[number];

const COND_ORDER: Record<string, number> = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };
type SortCol = "name" | "cmc" | "type" | "set" | "cond" | "owner" | "folder" | "deck" | "price";

function cardPrice(card: CollectionCard): number {
  return card.foil
    ? parseFloat(card.prices?.usd_foil || card.prices?.usd || "0")
    : parseFloat(card.prices?.usd || "0");
}

export default function Collection() {
  const [searchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [filterFolder, setFilterFolder] = useState<string>(() => searchParams.get("folder_id") || "");
  const [filterColors, setFilterColors] = useState<string[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [filterLegal, setFilterLegal] = useState("");
  const [filterSet, setFilterSet] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [aggregate, setAggregate] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByKey[]>([]);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Bulk edit state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkFolder, setBulkFolder] = useState("");
  const [bulkDeck, setBulkDeck] = useState("");

  const queryClient = useQueryClient();

  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });
  const { data: decks } = useQuery({ queryKey: ["decks"], queryFn: getDecks });

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["collection", { search, filterFolder, filterColors, filterType, filterCondition, filterOwner, filterLegal, filterSet }],
    queryFn: () =>
      getCollection({
        search: search || undefined,
        folder_id: filterFolder === "unassigned" ? "null" : filterFolder ? filterFolder : undefined,
        colors: filterColors.length ? filterColors.join(",") : undefined,
        type: filterType || undefined,
        condition: filterCondition || undefined,
        owner: filterOwner || undefined,
        legal: filterLegal || undefined,
        set_code: filterSet || undefined,
      }),
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCollectionCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["collection-stats"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CollectionCard> }) =>
      updateCollectionCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setEditingId(null);
    },
  });

  const bulkMutation = useMutation({
    mutationFn: ({ ids, updates }: { ids: number[]; updates: Parameters<typeof bulkUpdateCards>[1] }) =>
      bulkUpdateCards(ids, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
      clearBulkSelection();
    },
  });

  function clearBulkSelection() {
    setSelectedIds(new Set());
    setBulkOwner("");
    setBulkFolder("");
    setBulkDeck("");
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allIds = new Set(displayCards.map((c) => c.id));
    const allSelected = allIds.size > 0 && [...allIds].every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(allIds);
    }
  }

  function applyBulk() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const updates: Parameters<typeof bulkUpdateCards>[1] = {};
    if (bulkOwner !== "") updates.owner = bulkOwner.trim() || null;
    if (bulkFolder !== "") updates.folder_id = bulkFolder === "null" ? null : parseInt(bulkFolder);
    if (bulkDeck !== "") updates.deck_id = parseInt(bulkDeck);
    if (Object.keys(updates).length === 0) return;
    bulkMutation.mutate({ ids, updates });
  }

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  // Build display rows: individual or aggregate, then sort
  const displayCards = useMemo(() => {
    let base: CollectionCard[];

    if (aggregate) {
      if (groupBy.length === 0) {
        base = cards;
      } else {
        const groups = new Map<string, CollectionCard>();
        for (const card of cards) {
          const key = [
            card.scryfall_id,
            groupBy.includes("Owner") ? (card.owner || "") : "",
            groupBy.includes("Folder") ? (card.folder_id ?? "") : "",
            groupBy.includes("Set") ? card.set_code : "",
          ].join("|");
          if (groups.has(key)) {
            const ex = groups.get(key)!;
            groups.set(key, { ...ex, quantity: ex.quantity + card.quantity });
          } else {
            groups.set(key, { ...card });
          }
        }
        base = [...groups.values()];
      }
    } else {
      base = cards.flatMap((card) =>
        Array.from({ length: card.quantity }, () => ({ ...card, quantity: 1 }))
      );
    }

    // Sort
    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":   cmp = a.name.localeCompare(b.name); break;
        case "cmc":    cmp = (a.cmc ?? 0) - (b.cmc ?? 0); break;
        case "type":   cmp = (a.type_line || "").localeCompare(b.type_line || ""); break;
        case "set":    cmp = a.set_code.localeCompare(b.set_code); break;
        case "cond":   cmp = (COND_ORDER[a.condition] ?? 0) - (COND_ORDER[b.condition] ?? 0); break;
        case "owner":  cmp = (a.owner || "").localeCompare(b.owner || ""); break;
        case "folder": cmp = (a.folder_name || "").localeCompare(b.folder_name || ""); break;
        case "deck":   cmp = (a.deck_name || "").localeCompare(b.deck_name || ""); break;
        case "price":  cmp = cardPrice(a) - cardPrice(b); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [cards, aggregate, groupBy, sortCol, sortDir]);

  // Unique entry IDs in the current view — individual mode repeats rows for qty > 1,
  // so we deduplicate before driving the "select all" checkbox state.
  const displayEntryIds = useMemo(() => new Set(displayCards.map((c) => c.id)), [displayCards]);

  const totalValue = cards.reduce((sum, c) => sum + cardPrice(c) * c.quantity, 0);
  const totalQty = cards.reduce((s, c) => s + c.quantity, 0);

  function toggleColor(color: string) {
    setFilterColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    );
  }

  function toggleGroupBy(key: GroupByKey) {
    setGroupBy((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function SortHeader({ col, label, className }: { col: SortCol; label: string; className?: string }) {
    const active = sortCol === col;
    return (
      <th
        className={`text-left py-3 px-4 text-xs font-medium uppercase tracking-wider cursor-pointer select-none transition-colors ${active ? "text-amber-400" : "text-gray-500 hover:text-gray-300"} ${className ?? ""}`}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active
            ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
            : <ArrowUpDown className="w-3 h-3 opacity-30" />
          }
        </span>
      </th>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-4 py-3 md:p-6 border-b border-gray-700/50 shrink-0">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white leading-tight">Collection</h1>
            <p className="text-gray-400 text-xs md:text-sm mt-0.5">
              {totalQty.toLocaleString()} cards · {cards.length} entries · <span className="text-amber-400">${totalValue.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Mobile: filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showFilters || filterColors.length || filterFolder || filterType || filterCondition || filterOwner || filterLegal || filterSet || search
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-700"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <button
              onClick={() => setAggregate((v) => !v)}
              className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors border ${
                aggregate
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200"
              }`}
              title={aggregate ? "Switch to individual card view" : "Switch to aggregate view"}
            >
              {aggregate ? <BarChart3 className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Layers className="w-3.5 h-3.5 md:w-4 md:h-4" />}
              <span className="hidden sm:inline">{aggregate ? "Aggregate" : "Individual"}</span>
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary text-xs py-1.5 px-2.5 md:px-3">
              <Upload className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Import</span>
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary text-xs py-1.5 px-2.5 md:px-3">
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Add Card</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>

        {/* Mobile search — always visible */}
        <div className="md:hidden relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>

        {/* Group by (aggregate mode only) */}
        {aggregate && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Group by:</span>
            {GROUP_BY_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => toggleGroupBy(opt)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  groupBy.includes(opt)
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                    : "bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Filters — desktop always visible, mobile collapsible */}
        <div className={`${showFilters ? "block" : "hidden"} md:block`}>
          <div className="flex flex-wrap gap-2 md:gap-3 items-center">
            <div className="relative flex-1 min-w-48 hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Filter by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9"
              />
            </div>

            <select value={filterFolder} onChange={(e) => setFilterFolder(e.target.value)} className="select w-full md:w-44">
              <option value="">All Folders</option>
              <option value="unassigned">Unassigned</option>
              {folders?.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
            </select>

            <div className="flex gap-2 w-full md:w-auto md:contents">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="select flex-1 md:w-36">
                <option value="">All Types</option>
                {["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} className="select flex-1 md:w-36">
                <option value="">All Cond.</option>
                {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{k} — {v}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 w-full md:w-auto md:contents">
              <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="select flex-1 md:w-32">
                <option value="">All Owners</option>
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <select value={filterLegal} onChange={(e) => setFilterLegal(e.target.value)} className="select flex-1 md:w-28">
                <option value="">All Legal</option>
                <option value="Y">Legal</option>
                <option value="N">Not Legal</option>
              </select>

              <input
                type="text"
                placeholder="Set…"
                value={filterSet}
                onChange={(e) => setFilterSet(e.target.value.toLowerCase())}
                className="input w-20 text-sm"
              />
            </div>

            {/* Color filters */}
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleColor(c)}
                  className={`w-7 h-7 rounded-full text-xs font-bold border-2 transition-all ${
                    filterColors.includes(c)
                      ? "border-amber-400 scale-110"
                      : "border-transparent opacity-60 hover:opacity-100"
                  } ${
                    c === "W" ? "bg-yellow-50 text-yellow-900"
                    : c === "U" ? "bg-blue-600 text-white"
                    : c === "B" ? "bg-gray-800 text-white"
                    : c === "R" ? "bg-red-600 text-white"
                    : c === "G" ? "bg-green-700 text-white"
                    : "bg-gray-500 text-white"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500">Loading collection...</div>
        ) : displayCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500 gap-3">
            <Filter className="w-8 h-8 opacity-30" />
            <div>No cards found</div>
            <button onClick={() => setShowAdd(true)} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" /> Add your first card
            </button>
          </div>
        ) : (
          <>
            {/* ── Desktop table ─────────────────────────────────── */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 sticky top-0 bg-surface">
                  <th className="py-3 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={displayEntryIds.size > 0 && [...displayEntryIds].every((id) => selectedIds.has(id))}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider w-8"></th>
                  <SortHeader col="name" label="Name" />
                  <SortHeader col="cmc" label="Mana" />
                  <SortHeader col="type" label="Type" />
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Colors</th>
                  <SortHeader col="set" label="Set" />
                  <SortHeader col="cond" label="Cond." />
                  {aggregate && (
                    <th className="text-center py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Qty</th>
                  )}
                  <SortHeader col="owner" label="Owner" />
                  <SortHeader col="folder" label="Folder" />
                  <SortHeader col="deck" label="Deck" />
                  <th className="text-center py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Legal</th>
                  <SortHeader col="price" label="Price" className="text-right" />
                  <th className="py-3 px-4 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {displayCards.map((card, idx) => (
                  <CollectionRow
                    key={`${card.id}-${idx}`}
                    card={card}
                    aggregate={aggregate}
                    editing={editingId === card.id && aggregate}
                    selected={selectedIds.has(card.id)}
                    onToggleSelect={() => toggleSelect(card.id)}
                    onEdit={() => setEditingId(card.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => deleteMutation.mutate(card.id)}
                    onUpdate={(data) => updateMutation.mutate({ id: card.id, data })}
                    folders={folders || []}
                  />
                ))}
              </tbody>
            </table>

            {/* ── Mobile card list ───────────────────────────────── */}
            <ul className="md:hidden divide-y divide-gray-700/30">
              {displayCards.map((card, idx) => (
                <MobileCardRow
                  key={`${card.id}-${idx}`}
                  card={card}
                  aggregate={aggregate}
                  selected={selectedIds.has(card.id)}
                  onToggleSelect={() => toggleSelect(card.id)}
                  onDelete={() => deleteMutation.mutate(card.id)}
                  folders={folders || []}
                  decks={decks || []}
                  onUpdate={(data) => updateMutation.mutate({ id: card.id, data })}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {showAdd && <AddCardModal onClose={() => setShowAdd(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 md:bottom-6 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 z-40 md:rounded-xl bg-gray-900 border-t md:border border-amber-500/30 shadow-2xl px-3 py-3">
          {/* Mobile: stacked layout */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5 text-amber-400 text-sm font-medium">
              <CheckSquare className="w-4 h-4" />
              {selectedIds.size} selected
            </div>
            <div className="hidden md:block w-px h-5 bg-gray-700" />

            <select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className="select text-xs py-1.5 flex-1 min-w-0 md:w-28 md:flex-none">
              <option value="">Owner…</option>
              <option value="Jeffrey">Jeffrey</option>
              <option value="Abby">Abby</option>
              <option value=" ">— Clear —</option>
            </select>

            <select value={bulkFolder} onChange={(e) => setBulkFolder(e.target.value)} className="select text-xs py-1.5 flex-1 min-w-0 md:w-32 md:flex-none">
              <option value="">Folder…</option>
              <option value="null">— Remove —</option>
              {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>

            <select value={bulkDeck} onChange={(e) => setBulkDeck(e.target.value)} className="select text-xs py-1.5 flex-1 min-w-0 md:w-32 md:flex-none">
              <option value="">Add to deck…</option>
              {decks?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <button
              onClick={applyBulk}
              disabled={bulkMutation.isPending || (!bulkOwner.trim() && !bulkFolder && !bulkDeck)}
              className="btn-primary text-xs py-1.5 px-3 shrink-0"
            >
              {bulkMutation.isPending ? "Applying…" : "Apply"}
            </button>
            <button onClick={clearBulkSelection} className="p-1 text-gray-500 hover:text-gray-300 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectionRow({ card, aggregate, editing, selected, onToggleSelect, onEdit, onCancelEdit, onDelete, onUpdate, folders }: {
  card: CollectionCard;
  aggregate: boolean;
  editing: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onUpdate: (data: Partial<CollectionCard>) => void;
  folders: Array<{ id: number; name: string }>;
}) {
  const [qty, setQty] = useState(card.quantity);
  const [cond, setCond] = useState(card.condition);
  const [folderId, setFolderId] = useState<number | null>(card.folder_id);
  const [owner, setOwner] = useState(card.owner || "");

  const price = cardPrice(card);

  return (
    <tr className={`border-b border-gray-700/20 hover:bg-gray-800/30 transition-colors group ${selected ? "bg-amber-500/5" : ""}`}>
      {/* Checkbox */}
      <td className="py-2 px-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer"
        />
      </td>

      {/* Hover image */}
      <td className="py-2 px-4">
        <HoverCardImage card={card}>
          <div className="w-6 h-8 bg-gray-800 rounded overflow-hidden">
            {getCardThumb(card) && (
              <img src={getCardThumb(card)!} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
            )}
          </div>
        </HoverCardImage>
      </td>

      <td className="py-2 px-4">
        <div className="font-medium text-gray-100">{card.name}</div>
        {card.foil && <span className="text-xs text-amber-400">✦ Foil</span>}
      </td>

      <td className="py-2 px-4">
        <ManaCost cost={card.mana_cost} size="sm" />
      </td>

      <td className="py-2 px-4 text-gray-400 text-xs max-w-32 truncate">{card.type_line}</td>

      <td className="py-2 px-4">
        <ColorIdentity identity={card.color_identity} size="sm" />
      </td>

      <td className="py-2 px-4">
        <div className="flex items-center gap-1">
          <img
            src={`https://svgs.scryfall.io/sets/${card.set_code}.svg`}
            alt={card.set_code}
            className="w-3.5 h-3.5 opacity-60"
            style={{ filter: "invert(0.7)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-xs text-gray-400">{card.set_code?.toUpperCase()}</span>
          <span className={`text-xs ml-0.5 ${RARITY_COLORS[card.rarity || "common"]}`}>
            {card.rarity?.[0]?.toUpperCase()}
          </span>
        </div>
      </td>

      <td className="py-2 px-4">
        {editing ? (
          <select value={cond} onChange={(e) => setCond(e.target.value as Condition)} className="select text-xs py-1 px-1.5 w-20">
            {Object.keys(CONDITION_LABELS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : (
          <span className={`text-xs font-medium ${cond === "NM" ? "text-green-400" : cond === "LP" ? "text-blue-400" : cond === "MP" ? "text-yellow-400" : cond === "HP" ? "text-orange-400" : "text-red-400"}`}>
            {card.condition}
          </span>
        )}
      </td>

      {aggregate && (
        <td className="py-2 px-4 text-center">
          {editing ? (
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value) || 1)}
              className="input text-center w-14 py-1 text-xs"
            />
          ) : (
            <span className="text-gray-200 font-medium">{card.quantity}</span>
          )}
        </td>
      )}

      {/* Owner */}
      <td className="py-2 px-4">
        {editing ? (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="select text-xs py-1 px-1.5 w-24">
            <option value="">—</option>
            <option value="Jeffrey">Jeffrey</option>
            <option value="Abby">Abby</option>
          </select>
        ) : (
          <span className="text-xs text-gray-400">{card.owner || "—"}</span>
        )}
      </td>

      {/* Folder */}
      <td className="py-2 px-4">
        {editing ? (
          <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value ? parseInt(e.target.value) : null)} className="select text-xs py-1 px-1.5 w-28">
            <option value="">None</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : (
          <span className="text-xs text-gray-500">{card.folder_name || "—"}</span>
        )}
      </td>

      {/* Deck (read-only) */}
      <td className="py-2 px-4">
        <span className="text-xs text-gray-500">{card.deck_name || "—"}</span>
      </td>

      {/* Legal (read-only) */}
      <td className="py-2 px-4 text-center">
        <span className={`text-xs font-medium ${card.legal === "N" ? "text-red-400" : "text-green-400"}`}>
          {card.legal || "Y"}
        </span>
      </td>

      <td className="py-2 px-4 text-right">
        <div className="text-amber-400 text-xs font-medium">${price.toFixed(2)}</div>
        {card.quantity > 1 && aggregate && (
          <div className="text-gray-600 text-xs">${(price * card.quantity).toFixed(2)}</div>
        )}
      </td>

      <td className="py-2 px-4">
        {editing ? (
          <div className="flex gap-1">
            <button
              onClick={() => onUpdate({ quantity: qty, condition: cond, folder_id: folderId, owner: owner || null })}
              className="btn-primary text-xs py-1 px-2"
            >
              Save
            </button>
            <button onClick={onCancelEdit} className="btn-secondary text-xs py-1 px-2">✕</button>
          </div>
        ) : (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit} className="btn-ghost p-1.5 rounded-md text-gray-500 hover:text-gray-300">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (confirm(`Remove ${card.name} from collection?`)) onDelete(); }}
              className="btn-ghost p-1.5 rounded-md text-gray-500 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function MobileCardRow({ card, aggregate, selected, onToggleSelect, onDelete, onUpdate, folders, decks }: {
  card: CollectionCard;
  aggregate: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onUpdate: (data: Partial<CollectionCard>) => void;
  folders: Array<{ id: number; name: string }>;
  decks: Array<{ id: number; name: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(card.quantity);
  const [cond, setCond] = useState(card.condition);
  const [folderId, setFolderId] = useState<number | null>(card.folder_id);
  const [owner, setOwner] = useState(card.owner || "");

  const price = cardPrice(card);
  const thumb = getCardThumb(card);

  function saveEdit() {
    onUpdate({ quantity: qty, condition: cond, folder_id: folderId, owner: owner || null });
    setEditing(false);
  }

  return (
    <li className={`${selected ? "bg-amber-500/5" : ""}`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded accent-amber-500 cursor-pointer shrink-0"
        />

        {/* Thumbnail */}
        <HoverCardImage card={card}>
          <div className="w-10 h-14 rounded-md overflow-hidden shrink-0 bg-gray-800 border border-gray-700/40">
            {thumb
              ? <img src={thumb} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
              : <div className="w-full h-full" />
            }
          </div>
        </HoverCardImage>

        {/* Card info */}
        <div className="flex-1 min-w-0" onClick={() => setExpanded((v) => !v)}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold text-white text-sm leading-tight">{card.name}</span>
              {card.foil && <span className="ml-1.5 text-xs text-amber-400">✦</span>}
              {aggregate && card.quantity > 1 && (
                <span className="ml-1.5 text-xs text-gray-500">×{card.quantity}</span>
              )}
            </div>
            <span className="text-amber-400 text-sm font-bold shrink-0">${price.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {/* Set */}
            <span className="text-xs text-gray-500">{card.set_code?.toUpperCase()}</span>
            {/* Rarity */}
            <span className={`text-xs font-medium ${RARITY_COLORS[card.rarity || "common"]}`}>
              {card.rarity?.[0]?.toUpperCase()}
            </span>
            {/* Condition */}
            <span className={`text-xs font-medium ${
              card.condition === "NM" ? "text-green-400"
              : card.condition === "LP" ? "text-blue-400"
              : card.condition === "MP" ? "text-yellow-400"
              : card.condition === "HP" ? "text-orange-400"
              : "text-red-400"
            }`}>{card.condition}</span>
            {/* Owner */}
            {card.owner && <span className="text-xs text-gray-500">{card.owner}</span>}
            {/* Mana */}
            <ManaCost cost={card.mana_cost} size="sm" />
          </div>
          {/* Folder / Deck */}
          {(card.folder_name || card.deck_name) && (
            <div className="flex items-center gap-2 mt-0.5">
              {card.folder_name && (
                <span className="text-xs text-gray-600 truncate">{card.folder_name}</span>
              )}
              {card.deck_name && (
                <span className="text-xs text-blue-500/70 truncate">{card.deck_name}</span>
              )}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 text-gray-600 hover:text-gray-400 shrink-0"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details / edit */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-700/20 pt-2.5 space-y-2">
          {/* Type line */}
          <div className="text-xs text-gray-500">{card.type_line}</div>

          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {aggregate && (
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                      className="input text-xs py-1.5 w-full"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">Condition</label>
                  <select value={cond} onChange={(e) => setCond(e.target.value as Condition)} className="select text-xs py-1.5 w-full">
                    {Object.keys(CONDITION_LABELS).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">Owner</label>
                  <select value={owner} onChange={(e) => setOwner(e.target.value)} className="select text-xs py-1.5 w-full">
                    <option value="">—</option>
                    <option value="Jeffrey">Jeffrey</option>
                    <option value="Abby">Abby</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block">Folder</label>
                  <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value ? parseInt(e.target.value) : null)} className="select text-xs py-1.5 w-full">
                    <option value="">None</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={saveEdit} className="btn-primary text-xs py-1.5 flex-1">Save</button>
                <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 flex-1">Cancel</button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:text-white transition-colors flex-1 justify-center"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                onClick={() => { if (confirm(`Remove ${card.name} from collection?`)) onDelete(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-red-400 border border-gray-700 hover:bg-red-900/20 transition-colors flex-1 justify-center"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function getCardThumb(card: CollectionCard): string | null {
  if (card.image_uris) return card.image_uris.small || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || null;
  }
  return null;
}
