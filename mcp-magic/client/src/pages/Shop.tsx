import { useQuery } from "@tanstack/react-query";
import { Check, Package, Plus, Search, ShoppingBag, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { shopSearch, type ShopCard } from "../api/client";
import AddCardModal from "../components/AddCardModal";
import { HoverCardImage } from "../components/CardImage";
import { ManaCost } from "../components/ManaSymbol";
import { RARITY_COLORS } from "../types";
import type { ScryfallCard } from "../types";

export default function Shop() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [addCard, setAddCard] = useState<ScryfallCard | null>(null);

  // Debounce: fire search 400 ms after user stops typing
  useEffect(() => {
    if (!input.trim()) { setQuery(""); return; }
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["shop", query],
    queryFn: () => shopSearch(query),
    enabled: query.length >= 2,
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-gray-700/50 bg-surface-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 bg-amber-500/20 rounded-xl flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">Shop Lookup</h1>
            <p className="text-xs text-gray-500 leading-tight">Search a card to see value & ownership</p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type a card name…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="input w-full pl-10 py-3 text-base"
          />
          {(isLoading || isFetching) && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {!query && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
            <Sparkles className="w-8 h-8 opacity-40" />
            <p className="text-sm">Start typing to search cards</p>
          </div>
        )}

        {query && !isLoading && data?.cards.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-600">
            <Search className="w-8 h-8 opacity-30" />
            <p className="text-sm">No cards found for "{query}"</p>
          </div>
        )}

        {data?.cards && data.cards.length > 0 && (
          <ul className="divide-y divide-gray-700/30">
            {data.cards.map((card) => (
              <ShopCardRow key={card.id} card={card} onAdd={() => setAddCard(card)} />
            ))}
          </ul>
        )}
      </div>

      {addCard && <AddCardModal defaultCard={addCard} onClose={() => setAddCard(null)} />}
    </div>
  );
}

function getThumb(card: ShopCard): string | null {
  if (card.image_uris) return card.image_uris.small || card.image_uris.normal || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || face?.image_uris?.normal || null;
  }
  return null;
}

function ShopCardRow({ card, onAdd }: { card: ShopCard; onAdd: () => void }) {
  const thumb = getThumb(card);
  const price = parseFloat(card.prices?.usd || "0");
  const priceFoil = parseFloat(card.prices?.usd_foil || "0");
  const hasPrice = price > 0;
  const owned = card.owned_copies;
  const free = card.unassigned_copies;

  return (
    <li className="flex gap-3 p-4 hover:bg-gray-800/30 active:bg-gray-800/50 transition-colors">
      {/* Card thumbnail */}
      <HoverCardImage card={card}>
        <div className="w-14 h-20 rounded-lg overflow-hidden shrink-0 bg-gray-800 border border-gray-700/40">
          {thumb
            ? <img src={thumb} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-gray-700">
                <Package className="w-5 h-5" />
              </div>
          }
        </div>
      </HoverCardImage>

      {/* Card info */}
      <div className="flex-1 min-w-0">
        {/* Name + price row */}
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-white text-sm leading-tight">{card.name}</div>
          <div className="shrink-0 text-right">
            {hasPrice
              ? <span className="text-amber-400 font-bold text-base">${price.toFixed(2)}</span>
              : <span className="text-gray-600 text-sm">—</span>
            }
            {priceFoil > 0 && (
              <div className="text-xs text-purple-400 font-medium">${priceFoil.toFixed(2)} ✦</div>
            )}
          </div>
        </div>

        {/* Set + rarity + mana */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <img
            src={`https://svgs.scryfall.io/sets/${card.set_code}.svg`}
            alt={card.set_code}
            className="w-3.5 h-3.5 opacity-50"
            style={{ filter: "invert(0.6)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-xs text-gray-500">{card.set_name || card.set_code.toUpperCase()}</span>
          {card.collector_number && (
            <span className="text-xs text-gray-600">#{card.collector_number}</span>
          )}
          <span className={`text-xs font-medium ${RARITY_COLORS[card.rarity || "common"]}`}>
            {card.rarity && card.rarity[0].toUpperCase() + card.rarity.slice(1)}
          </span>
          <span className="text-gray-700">·</span>
          <ManaCost cost={card.mana_cost} size="sm" />
        </div>

        {/* Type */}
        <div className="text-xs text-gray-600 mt-0.5 truncate">{card.type_line}</div>

        {/* Ownership badge + add button */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {owned > 0 ? (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">
                <Check className="w-3 h-3" />
                {owned} owned
              </span>
              {free > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-700/30">
                  {free} not in a deck
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-500 border border-gray-700">
                  all in decks
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800/80 text-gray-500 border border-gray-700/50">
              Not in collection
            </span>
          )}
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>
    </li>
  );
}
