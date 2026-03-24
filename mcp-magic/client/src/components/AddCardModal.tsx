import { X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addCardToCollection, getFolders } from "../api/client";
import type { ScryfallCard } from "../types";
import { CONDITION_LABELS } from "../types";
import CardSearch from "./CardSearch";
import CardImage from "./CardImage";
import { ManaCost } from "./ManaSymbol";

interface AddCardModalProps {
  onClose: () => void;
  defaultCard?: ScryfallCard;
  defaultFolderId?: number | null;
}

export default function AddCardModal({ onClose, defaultCard, defaultFolderId }: AddCardModalProps) {
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(defaultCard || null);
  const [quantity, setQuantity] = useState(1);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState<keyof typeof CONDITION_LABELS>("NM");
  const [language, setLanguage] = useState("en");
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId ?? null);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });

  async function handleSave() {
    if (!selectedCard) return;
    setSaving(true);
    setError(null);
    try {
      await addCardToCollection({
        scryfall_id: selectedCard.id,
        quantity,
        foil,
        condition,
        language,
        folder_id: folderId,
        purchase_price: purchasePrice ? parseFloat(purchasePrice) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["collection-stats"] });
      setSuccess(`Added ${quantity}x ${selectedCard.name}!`);
      // Reset for next card
      setTimeout(() => {
        setSelectedCard(null);
        setQuantity(1);
        setFoil(false);
        setCondition("NM");
        setPurchasePrice("");
        setSuccess(null);
      }, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    } finally {
      setSaving(false);
    }
  }

  const cardPrice = selectedCard?.prices?.[foil ? "usd_foil" : "usd"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-surface-card rounded-2xl shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Add Card to Collection</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Card search */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Card Name</label>
            <CardSearch onSelect={setSelectedCard} placeholder="Search Scryfall..." />
          </div>

          {/* Selected card preview */}
          {selectedCard && (
            <div className="flex gap-4 p-3 bg-surface-input rounded-xl border border-gray-700">
              <div className="w-16 h-22 shrink-0">
                <CardImage card={selectedCard} size="small" className="h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white">{selectedCard.name}</div>
                <div className="text-sm text-gray-400 mt-0.5">{selectedCard.type_line}</div>
                <div className="mt-1"><ManaCost cost={selectedCard.mana_cost} /></div>
                <div className="text-xs text-gray-500 mt-1">
                  {selectedCard.set_name} · #{selectedCard.collector_number} · {selectedCard.rarity}
                </div>
                {cardPrice && (
                  <div className="text-sm text-amber-400 mt-1 font-medium">${cardPrice}</div>
                )}
              </div>
            </div>
          )}

          {/* Form fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Quantity</label>
              <input
                type="number"
                min={1}
                max={99}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Condition</label>
              <select value={condition} onChange={(e) => setCondition(e.target.value as keyof typeof CONDITION_LABELS)} className="select">
                {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{k} — {v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="select">
                {[["en","English"],["ja","Japanese"],["de","German"],["fr","French"],["es","Spanish"],["it","Italian"],["pt","Portuguese"],["ko","Korean"],["ru","Russian"],["zhs","Simplified Chinese"],["zht","Traditional Chinese"]].map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Folder</label>
              <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value ? parseInt(e.target.value) : null)} className="select">
                <option value="">No folder</option>
                {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Purchase Price ($)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="Optional"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={foil}
                  onChange={(e) => setFoil(e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-500"
                />
                <span className="text-sm text-gray-300">Foil</span>
              </label>
            </div>
          </div>

          {error && <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-400">{error}</div>}
          {success && <div className="p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-sm text-green-400">{success}</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!selectedCard || saving}
            className="btn-primary"
          >
            {saving ? "Adding..." : "Add to Collection"}
          </button>
        </div>
      </div>
    </div>
  );
}
