import { ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { replaceCollectionCard } from "../api/client";
import type { CollectionCard, ScryfallCard } from "../types";
import CardSearch from "./CardSearch";
import CardImage from "./CardImage";
import { ManaCost } from "./ManaSymbol";

interface ReplaceCardModalProps {
  card: CollectionCard;
  onClose: () => void;
}

export default function ReplaceCardModal({ card, onClose }: ReplaceCardModalProps) {
  const [newCard, setNewCard] = useState<ScryfallCard | null>(null);
  const queryClient = useQueryClient();

  const replaceMutation = useMutation({
    mutationFn: () => replaceCollectionCard(card.id, newCard!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["collection-stats"] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
      onClose();
    },
  });

  function getThumb(c: CollectionCard | ScryfallCard): string | null {
    if (c.image_uris) return (c.image_uris as Record<string, string>).small || (c.image_uris as Record<string, string>).normal || null;
    if (c.card_faces) {
      const face = (c.card_faces as { image_uris?: Record<string, string> }[])[0];
      return face?.image_uris?.small || face?.image_uris?.normal || null;
    }
    return null;
  }

  const oldThumb = getThumb(card);
  const newThumb = newCard ? getThumb(newCard) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface-card rounded-2xl shadow-2xl border border-gray-700 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700 shrink-0">
          <h2 className="text-lg font-semibold text-white">Replace Card</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Before → After */}
          <div className="flex items-center gap-3">
            {/* Current card */}
            <div className="flex-1 p-3 rounded-xl bg-gray-800/60 border border-gray-700/50">
              <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Replacing</div>
              <div className="flex gap-3 items-start">
                <div className="w-10 h-14 rounded overflow-hidden shrink-0 bg-gray-900">
                  {oldThumb && <img src={oldThumb} alt={card.name} className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-gray-200 text-sm truncate">{card.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {card.set_code?.toUpperCase()}
                    {card.collector_number && <span className="ml-1">#{card.collector_number}</span>}
                  </div>
                  <ManaCost cost={card.mana_cost} size="sm" />
                  {card.deck_name && (
                    <div className="mt-1 text-xs text-blue-400">In: {card.deck_name}</div>
                  )}
                </div>
              </div>
            </div>

            <ArrowRight className="w-5 h-5 text-gray-600 shrink-0" />

            {/* New card preview */}
            <div className="flex-1 p-3 rounded-xl bg-gray-800/60 border border-gray-700/50">
              <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">With</div>
              {newCard ? (
                <div className="flex gap-3 items-start">
                  <div className="w-10 h-14 rounded overflow-hidden shrink-0 bg-gray-900">
                    {newThumb && <img src={newThumb} alt={newCard.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-green-300 text-sm truncate">{newCard.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {newCard.set_code?.toUpperCase()}
                      {newCard.collector_number && <span className="ml-1">#{newCard.collector_number}</span>}
                    </div>
                    <ManaCost cost={newCard.mana_cost} size="sm" />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-600 italic py-2">Search for a card below</div>
              )}
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Search for replacement</label>
            <CardSearch onSelect={setNewCard} placeholder="Search Scryfall..." showSetFilter autoFocus />
          </div>

          {/* Info */}
          <div className="text-xs text-gray-500 bg-gray-800/40 rounded-lg p-3">
            All metadata (folder, owner, condition, quantity) will be kept. Deck assignments will be updated to the new card.
          </div>

          {replaceMutation.isError && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-400">
              {replaceMutation.error instanceof Error ? replaceMutation.error.message : "Replace failed"}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700 shrink-0">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => replaceMutation.mutate()}
            disabled={!newCard || replaceMutation.isPending}
            className="btn-primary"
          >
            {replaceMutation.isPending ? "Replacing…" : "Replace Card"}
          </button>
        </div>
      </div>
    </div>
  );
}
