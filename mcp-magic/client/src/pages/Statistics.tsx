import { useQuery } from "@tanstack/react-query";
import { getCollectionStats } from "../api/client";
import { BarChart3, TrendingUp, Layers, DollarSign } from "lucide-react";
import ColorPie from "../components/stats/ColorPie";
import ManaCurve from "../components/stats/ManaCurve";
import TypeBreakdown from "../components/stats/TypeBreakdown";
import { RARITY_COLORS } from "../types";

export default function Statistics() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["collection-stats"],
    queryFn: getCollectionStats,
    staleTime: 60000,
  });

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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Collection Statistics</h1>
        <p className="text-gray-400 text-sm mt-0.5">Overview of your entire Magic collection</p>
      </div>

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
