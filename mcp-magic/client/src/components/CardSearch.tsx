import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchScryfall } from "../api/client";
import type { ScryfallCard } from "../types";
import { ManaCost } from "./ManaSymbol";

interface CardSearchProps {
  onSelect: (card: ScryfallCard) => void;
  placeholder?: string;
  className?: string;
  showSetFilter?: boolean;
}

export default function CardSearch({ onSelect, placeholder = "Search for a card...", className = "", showSetFilter = false }: CardSearchProps) {
  const [query, setQuery] = useState("");
  const [setFilter, setSetFilter] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
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
        const result = await searchScryfall(query, 1, setFilter.trim() || undefined);
        setResults(result.cards.slice(0, 12));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, setFilter]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(card: ScryfallCard) {
    onSelect(card);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className={`flex gap-2 ${showSetFilter ? "" : ""}`}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="input pl-9 pr-8 w-full"
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
        {showSetFilter && (
          <input
            type="text"
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
            placeholder="Set code (e.g. dom)"
            className="input w-36 text-xs"
          />
        )}
      </div>

      {/* Dropdown */}
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-card border border-gray-700 rounded-xl shadow-2xl overflow-y-auto max-h-72">
          {loading && (
            <div className="p-3 text-center text-gray-400 text-sm">Searching...</div>
          )}
          {!loading && results.map((card) => (
            <button
              key={card.id}
              onClick={() => handleSelect(card)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700/50 transition-colors text-left border-b border-gray-700/30 last:border-0"
            >
              {/* Mini card image */}
              <div className="w-8 h-11 shrink-0 rounded overflow-hidden bg-gray-800">
                {getCardImage(card) && (
                  <img src={getCardImage(card)!} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-100 truncate">{card.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {/* Set icon from Scryfall CDN */}
                  <img
                    src={`https://svgs.scryfall.io/sets/${card.set_code}.svg`}
                    alt={card.set_code}
                    className="w-4 h-4 shrink-0 opacity-80"
                    style={{ filter: "invert(0.7)" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-xs text-gray-400">{card.set_name || card.set_code?.toUpperCase()}</span>
                  <ManaCost cost={card.mana_cost} size="sm" />
                </div>
                <div className="text-xs text-gray-500 truncate">{card.type_line}</div>
              </div>
              {card.prices?.usd && (
                <span className="text-xs text-amber-400 shrink-0">${card.prices.usd}</span>
              )}
            </button>
          ))}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div className="p-3 text-center text-gray-500 text-sm">No cards found</div>
          )}
        </div>
      )}
    </div>
  );
}

function getCardImage(card: ScryfallCard): string | null {
  if (card.image_uris) return card.image_uris.small || null;
  if (card.card_faces) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    return face?.image_uris?.small || null;
  }
  return null;
}
