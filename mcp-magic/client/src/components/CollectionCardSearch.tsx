/**
 * Card search that only shows cards from the collection that are
 * not already assigned to another deck.
 */
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchCollectionForDeck } from "../api/client";
import type { CollectionCard } from "../types";
import { ManaCost } from "./ManaSymbol";

interface CollectionCardSearchProps {
  onSelect: (card: CollectionCard) => void;
  placeholder?: string;
  className?: string;
}

export default function CollectionCardSearch({ onSelect, placeholder = "Search your collection...", className = "" }: CollectionCardSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const cards = await searchCollectionForDeck(query);
        setResults(cards.slice(0, 12));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(card: CollectionCard) {
    onSelect(card);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function getThumb(card: CollectionCard): string | null {
    if (card.image_uris) return card.image_uris.small || null;
    if (card.card_faces) {
      const face = card.card_faces[0] as { image_uris?: Record<string, string> };
      return face?.image_uris?.small || null;
    }
    return null;
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="input pl-9 pr-8"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-card border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {loading && <div className="p-3 text-center text-gray-400 text-sm">Searching collection...</div>}
          {!loading && results.map((card, i) => (
            <button
              key={`${card.id}-${i}`}
              onClick={() => handleSelect(card)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700/50 transition-colors text-left border-b border-gray-700/30 last:border-0"
            >
              <div className="w-8 h-11 shrink-0 rounded overflow-hidden bg-gray-800">
                {getThumb(card) && (
                  <img src={getThumb(card)!} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-100 truncate">{card.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <img
                    src={`https://svgs.scryfall.io/sets/${card.set_code}.svg`}
                    alt={card.set_code}
                    className="w-4 h-4 opacity-70"
                    style={{ filter: "invert(0.7)" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-xs text-gray-500">{card.set_code?.toUpperCase()}</span>
                  <ManaCost cost={card.mana_cost} size="sm" />
                  {card.folder_name && (
                    <span className="text-xs text-gray-600 truncate">· {card.folder_name}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">{card.type_line}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-xs font-medium ${
                  card.condition === "NM" ? "text-green-400" : card.condition === "LP" ? "text-blue-400" : "text-yellow-400"
                }`}>{card.condition}</div>
                {card.prices?.usd && <div className="text-xs text-amber-400">${card.prices.usd}</div>}
              </div>
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div className="p-3 text-center text-gray-500 text-sm">No available collection cards found</div>
          )}
        </div>
      )}
    </div>
  );
}
