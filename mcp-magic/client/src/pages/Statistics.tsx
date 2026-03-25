import { useQuery } from "@tanstack/react-query";
import { getCollectionStats, getFolders, getDecks } from "../api/client";
import { BarChart3, TrendingUp, Layers, DollarSign, Filter, X } from "lucide-react";
import { useState } from "react";
import type { StatsFilter } from "../types";
import ColorPie from "../components/stats/ColorPie";
import ManaCurve from "../components/stats/ManaCurve";
import TypeBreakdown from "../components/stats/TypeBreakdown";
import { RARITY_COLORS, CONDITION_LABELS } from "../types";

const CARD_TYPES = ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land"];

export default function Statistics() {
  const [filter, setFilter] = useState<StatsFilter>({});
  const [showFilters, setShowFilters] = useState(false);

  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });
  const { data: decks } = useQuery({ queryKey: ["decks"], queryFn: getDecks });

  const { data: stats, isLoading } = useQuery({
    queryKey: ["collection-stats", filter],
    queryFn: () => getCollectionStats(filter),
    staleTime: 60000,
  });

  const hasFilter = Object.values(filter).some((v) => v !== undefined && v !== "");

  function clearFilter() { setFilter({}); }
  function setF<K extends keyof StatsFilter>(key: K, value: StatsFilter[K]) {
    setFilter((prev) => ({ ...prev, [key]: value || undefined }));
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading statistics...</div>;
  }

  if (!stats) return null;

  // Build color distribution from raw data
  const colorDist: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const row of stats.byColor || []) {
    const colors = Array.isArray(row.color_identity) ? row.color_identity : [];
    for (const c of colors) {
      colorDist[c] = (colorDist[c] || 0) + row.count;
    }
    if (colors.length === 0) colorDist["C"] = (colorDist["C"] || 0) + row.count;
  }

  // Build type breakdown
  const typeDist: Record<string, number> = {};
  for (const row of stats.byType || []) {
    const main = getMainType(row.type_line || "");
    typeDist[main] = (typeDist[main] || 0) + row.count;
  }

  // Build mana curve
  const manaCurve: Record<number, number> = {};
  for (const row of stats.byCmc || []) {
    const bucket = Math.min(row.cmc, 7);
    manaCurve[bucket] = (manaCurve[bucket] || 0) + row.count;
  }

  const totalValue = typeof stats.total_value === "number" ? stats.total_value : 0;

  // Active filter label
  const filterLabels: string[] = [];
  if (filter.owner) filterLabels.push(`Owner: ${filter.owner}`);
  if (filter.folder_id !== undefined) {
    const folder = folders?.find((f) => f.id === Number(filter.folder_id));
    filterLabels.push(`Folder: ${folder?.name || filter.folder_id}`);
  }
  if (filter.deck_id !== undefined) {
    const deck = decks?.find((d) => d.id === Number(filter.deck_id));
    filterLabels.push(`Deck: ${deck?.name || filter.deck_id}`);
  }
  if (filter.set_code) filterLabels.push(`Set: ${filter.set_code}`);
  if (filter.condition) filterLabels.push(`Condition: ${filter.condition}`);
  if (filter.type) filterLabels.push(`Type: ${filter.type}`);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Collection Statistics</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {filterLabels.length > 0
              ? `Filtered: ${filterLabels.join(" · ")}`
              : "Overview of your entire Magic collection"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasFilter && (
            <button onClick={clearFilter} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors">
              <X className="w-4 h-4" /> Clear filters
            </button>
          )}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              showFilters || hasFilter
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200"
            }`}
          >
            <Filter className="w-4 h-4" /> Filters
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="card p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Owner</label>
            <select value={filter.owner || ""} onChange={(e) => setF("owner", e.target.value || undefined)} className="select w-full">
              <option value="">All Owners</option>
              <option value="Jeffrey">Jeffrey</option>
              <option value="Abby">Abby</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Folder</label>
            <select
              value={filter.folder_id !== undefined ? String(filter.folder_id) : ""}
              onChange={(e) => setF("folder_id", e.target.value !== "" ? (e.target.value === "null" ? null : parseInt(e.target.value)) : undefined)}
              className="select w-full"
            >
              <option value="">All Folders</option>
              <option value="null">Unassigned</option>
              {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Deck</label>
            <select
              value={filter.deck_id !== undefined ? String(filter.deck_id) : ""}
              onChange={(e) => setF("deck_id", e.target.value ? parseInt(e.target.value) : undefined)}
              className="select w-full"
            >
              <option value="">All Decks</option>
              {decks?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Set Code</label>
            <input
              type="text"
              placeholder="e.g. dom, mh3"
              value={filter.set_code || ""}
              onChange={(e) => setF("set_code", e.target.value || undefined)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Condition</label>
            <select value={filter.condition || ""} onChange={(e) => setF("condition", e.target.value || undefined)} className="select w-full">
              <option value="">All Conditions</option>
              {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{k} — {v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select value={filter.type || ""} onChange={(e) => setF("type", e.target.value || undefined)} className="select w-full">
              <option value="">All Types</option>
              {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-amber-400" />
            <div className="stat-label">Total Value</div>
          </div>
          <div className="stat-value text-amber-400">${totalValue.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-blue-400" />
            <div className="stat-label">Unique Cards</div>
          </div>
          <div className="stat-value">{(stats.totals?.unique_cards || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-4 h-4 text-green-400" />
            <div className="stat-label">Total Copies</div>
          </div>
          <div className="stat-value">{(stats.totals?.total_quantity || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <div className="stat-label">Avg Value/Card</div>
          </div>
          <div className="stat-value">
            ${((stats.totals?.unique_cards || 1) > 0 ? totalValue / (stats.totals?.unique_cards || 1) : 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <ColorPie distribution={colorDist} />
        </div>
        <div className="card p-4">
          <ManaCurve curve={manaCurve} />
        </div>
        <div className="card p-4">
          <TypeBreakdown types={typeDist} />
        </div>
      </div>

      {/* Rarity breakdown */}
      <div className="card p-4">
        <div className="text-sm font-medium text-gray-300 mb-4">Rarity Breakdown</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {["mythic", "rare", "uncommon", "common"].map((rarity) => {
            const row = stats.byRarity?.find((r) => r.rarity === rarity);
            return (
              <div key={rarity} className="text-center">
                <div className={`text-2xl font-bold ${RARITY_COLORS[rarity]}`}>
                  {row?.unique_cards || 0}
                </div>
                <div className="text-xs text-gray-500 capitalize mt-0.5">{rarity}</div>
                <div className="text-xs text-gray-600">{row?.total_copies || 0} copies</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top valuable cards */}
      {stats.topByValue && stats.topByValue.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <div className="text-sm font-medium text-gray-300">Top Cards by Value</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/30">
                <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium">#</th>
                <th className="text-left py-2.5 px-4 text-xs text-gray-500 font-medium">Card</th>
                <th className="text-right py-2.5 px-4 text-xs text-gray-500 font-medium">Price</th>
                <th className="text-right py-2.5 px-4 text-xs text-gray-500 font-medium">Qty</th>
                <th className="text-right py-2.5 px-4 text-xs text-gray-500 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {stats.topByValue.slice(0, 15).map((card, i) => {
                const price = parseFloat(card.prices?.usd || "0");
                return (
                  <tr key={i} className="border-b border-gray-700/20 hover:bg-gray-800/30">
                    <td className="py-2.5 px-4 text-gray-600 text-xs">{i + 1}</td>
                    <td className="py-2.5 px-4 text-gray-200">{card.name}</td>
                    <td className="py-2.5 px-4 text-right text-amber-400">${price.toFixed(2)}</td>
                    <td className="py-2.5 px-4 text-right text-gray-400">×{card.qty}</td>
                    <td className="py-2.5 px-4 text-right text-amber-300 font-medium">
                      ${(price * card.qty).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getMainType(typeLine: string): string {
  const types = ["Land", "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Battle"];
  for (const t of types) {
    if (typeLine.includes(t)) return t;
  }
  return "Other";
}
