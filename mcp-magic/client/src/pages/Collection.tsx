import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Upload, Search, Filter, Trash2, Edit2, Layers, BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getCollection, getFolders, deleteCollectionCard, updateCollectionCard } from "../api/client";
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

export default function Collection() {
  const [searchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  // Initialize folder filter from URL param (e.g. navigating from Folders page)
  const [filterFolder, setFilterFolder] = useState<string>(() => searchParams.get("folder_id") || "");
  const [filterColors, setFilterColors] = useState<string[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [filterLegal, setFilterLegal] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [aggregate, setAggregate] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByKey[]>([]);

  const queryClient = useQueryClient();

  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["collection", { search, filterFolder, filterColors, filterType, filterCondition, filterOwner, filterLegal }],
    queryFn: () =>
      getCollection({
        search: search || undefined,
        folder_id: filterFolder === "unassigned" ? "null" : filterFolder ? filterFolder : undefined,
        colors: filterColors.length ? filterColors.join(",") : undefined,
        type: filterType || undefined,
        condition: filterCondition || undefined,
        owner: filterOwner || undefined,
        legal: filterLegal || undefined,
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

  // Build display rows: individual (expand by qty) or aggregate
  const displayCards = useMemo(() => {
    if (aggregate) {
      if (groupBy.length === 0) return cards;
      // Group by selected dimensions and sum quantities
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
      return [...groups.values()];
    } else {
      // Individual mode: expand each entry by quantity (each row = 1 physical card)
      return cards.flatMap((card) =>
        Array.from({ length: card.quantity }, () => ({ ...card, quantity: 1 }))
      );
    }
  }, [cards, aggregate, groupBy]);

  const totalValue = cards.reduce((sum, c) => {
    const price = c.foil
      ? parseFloat(c.prices?.usd_foil || c.prices?.usd || "0")
      : parseFloat(c.prices?.usd || "0");
    return sum + price * c.quantity;
  }, 0);

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

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="p-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Collection</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {totalQty.toLocaleString()} cards · {cards.length} entries · <span className="text-amber-400">${totalValue.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {/* Aggregate / Individual toggle */}
            <button
              onClick={() => setAggregate((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                aggregate
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200"
              }`}
              title={aggregate ? "Switch to individual card view" : "Switch to aggregate view"}
            >
              {aggregate ? <BarChart3 className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
              {aggregate ? "Aggregate" : "Individual"}
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload className="w-4 h-4" /> Import
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Add Card
            </button>
          </div>
        </div>

        {/* Group by options (only in aggregate mode) */}
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

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Filter by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>

          <select
            value={filterFolder}
            onChange={(e) => setFilterFolder(e.target.value)}
            className="select w-44"
          >
            <option value="">All Folders</option>
            <option value="unassigned">Unassigned</option>
            {folders?.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
          </select>

          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="select w-36">
            <option value="">All Types</option>
            {["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} className="select w-36">
            <option value="">All Conditions</option>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{k} — {v}</option>
            ))}
          </select>

          <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="select w-32">
            <option value="">All Owners</option>
            {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>

          <select value={filterLegal} onChange={(e) => setFilterLegal(e.target.value)} className="select w-28">
            <option value="">All Legal</option>
            <option value="Y">Legal</option>
            <option value="N">Not Legal</option>
          </select>

          {/* Color filters */}
          <div className="flex gap-1">
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

      {/* Table */}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 sticky top-0 bg-surface">
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider w-8"></th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Mana</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Colors</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Set</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Cond.</th>
                {aggregate && (
                  <th className="text-center py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Qty</th>
                )}
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Folder</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Owner</th>
                <th className="text-center py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Legal</th>
                <th className="text-right py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Price</th>
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
                  onEdit={() => setEditingId(card.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => deleteMutation.mutate(card.id)}
                  onUpdate={(data) => updateMutation.mutate({ id: card.id, data })}
                  folders={folders || []}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddCardModal onClose={() => setShowAdd(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function CollectionRow({ card, aggregate, editing, onEdit, onCancelEdit, onDelete, onUpdate, folders }: {
  card: CollectionCard;
  aggregate: boolean;
  editing: boolean;
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
  const [legal, setLegal] = useState(card.legal || "Y");

  const price = card.foil
    ? parseFloat(card.prices?.usd_foil || card.prices?.usd || "0")
    : parseFloat(card.prices?.usd || "0");

  return (
    <tr className="border-b border-gray-700/20 hover:bg-gray-800/30 transition-colors group">
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

      {/* Qty only shown in aggregate mode */}
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

      <td className="py-2 px-4 text-center">
        {editing ? (
          <select value={legal} onChange={(e) => setLegal(e.target.value)} className="select text-xs py-1 px-1.5 w-16">
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        ) : (
          <span className={`text-xs font-medium ${card.legal === "N" ? "text-red-400" : "text-green-400"}`}>
            {card.legal || "Y"}
          </span>
        )}
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
              onClick={() => onUpdate({ quantity: qty, condition: cond, folder_id: folderId, owner: owner || null, legal })}
              className="btn-primary text-xs py-1 px-2"
            >
              Save
            </button>
            <button onClick={onCancelEdit} className="btn-secondary text-xs py-1 px-2">✕</button>
          </div>
        ) : (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Only allow editing in aggregate mode (editing a row with qty=1 in individual mode is fine too) */}
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

function getCardThumb(card: CollectionCard): string | null {
  if (card.image_uris) return card.image_uris.small || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || null;
  }
  return null;
}
