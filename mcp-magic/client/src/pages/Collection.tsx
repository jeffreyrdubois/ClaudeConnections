import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Upload, Search, Filter, Trash2, Edit2, ExternalLink } from "lucide-react";
import { useState } from "react";
import { getCollection, getFolders, deleteCollectionCard, updateCollectionCard } from "../api/client";
import type { CollectionCard, Condition } from "../types";
import { CONDITION_LABELS, RARITY_COLORS } from "../types";
import AddCardModal from "../components/AddCardModal";
import ImportModal from "../components/ImportModal";
import { ManaCost, ColorIdentity } from "../components/ManaSymbol";
import { HoverCardImage } from "../components/CardImage";

const COLORS = ["W", "U", "B", "R", "G", "C"];

export default function Collection() {
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [filterFolder, setFilterFolder] = useState<string>("");
  const [filterColors, setFilterColors] = useState<string[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const queryClient = useQueryClient();

  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["collection", { search, filterFolder, filterColors, filterType, filterCondition }],
    queryFn: () =>
      getCollection({
        search: search || undefined,
        folder_id: filterFolder === "unassigned" ? "null" : filterFolder ? filterFolder : undefined,
        colors: filterColors.length ? filterColors.join(",") : undefined,
        type: filterType || undefined,
        condition: filterCondition || undefined,
      }),
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCollectionCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["collection-stats"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CollectionCard> }) =>
      updateCollectionCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      setEditingId(null);
    },
  });

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
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload className="w-4 h-4" /> Import
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Add Card
            </button>
          </div>
        </div>

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
        ) : cards.length === 0 ? (
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
                <th className="text-center py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Qty</th>
                <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Folder</th>
                <th className="text-right py-3 px-4 text-xs text-gray-500 font-medium uppercase tracking-wider">Price</th>
                <th className="py-3 px-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <CollectionRow
                  key={card.id}
                  card={card}
                  editing={editingId === card.id}
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

function CollectionRow({ card, editing, onEdit, onCancelEdit, onDelete, onUpdate, folders }: {
  card: CollectionCard;
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
        <span className="text-xs text-gray-400">{card.set_code?.toUpperCase()}</span>
        <span className={`text-xs ml-1 ${RARITY_COLORS[card.rarity || "common"]}`}>
          {card.rarity?.[0]?.toUpperCase()}
        </span>
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

      <td className="py-2 px-4 text-right">
        <div className="text-amber-400 text-xs font-medium">${price.toFixed(2)}</div>
        {card.quantity > 1 && (
          <div className="text-gray-600 text-xs">${(price * card.quantity).toFixed(2)}</div>
        )}
      </td>

      <td className="py-2 px-4">
        {editing ? (
          <div className="flex gap-1">
            <button
              onClick={() => onUpdate({ quantity: qty, condition: cond, folder_id: folderId })}
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

function getCardThumb(card: CollectionCard): string | null {
  if (card.image_uris) return card.image_uris.small || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || null;
  }
  return null;
}
