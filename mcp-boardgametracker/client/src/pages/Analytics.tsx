import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getAverageRank, getWinOdds, getPlayerTrend, getPlayers } from "../api/client";

export default function Analytics() {
  const [tab, setTab] = useState<"rank" | "odds" | "trend">("rank");
  const [trendPlayer, setTrendPlayer] = useState<number | "">("");
  const { data: avgRank } = useQuery({ queryKey: ["avgRank"], queryFn: getAverageRank });
  const { data: odds } = useQuery({ queryKey: ["odds"], queryFn: getWinOdds });
  const { data: players } = useQuery({ queryKey: ["players"], queryFn: () => getPlayers() });
  const { data: trendData } = useQuery({
    queryKey: ["trend", trendPlayer],
    queryFn: () => getPlayerTrend(trendPlayer as number),
    enabled: typeof trendPlayer === "number" && trendPlayer > 0,
  });

  // Group avg rank by game
  const rankByGame = new Map<string, typeof avgRank>();
  avgRank?.forEach(r => {
    const arr = rankByGame.get(r.game_name) ?? [];
    arr.push(r);
    rankByGame.set(r.game_name, arr);
  });

  // Group odds by game
  const oddsByGame = new Map<string, typeof odds>();
  odds?.forEach(r => {
    const arr = oddsByGame.get(r.game_name) ?? [];
    arr.push(r);
    oddsByGame.set(r.game_name, arr);
  });

  const tabs = [
    { key: "rank" as const, label: "Average Rank" },
    { key: "odds" as const, label: "Win Odds" },
    { key: "trend" as const, label: "Player Trend" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="w-6 h-6 text-game-gold" />
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-card rounded-lg p-1 border border-gray-700/50 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? "bg-accent text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Average Rank */}
      {tab === "rank" && (
        <div className="space-y-4">
          {[...rankByGame.entries()].map(([game, entries]) => (
            <div key={game} className="card">
              <div className="p-4 border-b border-gray-700/50">
                <h3 className="text-white font-semibold">{game}</h3>
                <span className="text-xs text-gray-400">{entries![0].match_count} matches</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                    <th className="p-3">Player</th>
                    <th className="p-3 text-right">Matches</th>
                    <th className="p-3 text-right">Avg Position</th>
                  </tr>
                </thead>
                <tbody>
                  {entries!.map((e, i) => (
                    <tr key={e.player_id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                      <td className="p-3 text-white font-medium">
                        <span className={`inline-block w-5 mr-2 ${i === 0 ? "text-game-gold" : i === 1 ? "text-game-silver" : i === 2 ? "text-game-bronze" : "text-gray-500"}`}>
                          {i + 1}.
                        </span>
                        {e.player_name}
                      </td>
                      <td className="p-3 text-right text-gray-300">{e.match_count}</td>
                      <td className="p-3 text-right font-mono text-white">{e.avg_position.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Win Odds */}
      {tab === "odds" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">Odds of finishing in the top half (minimum 3 games played)</p>
          {[...oddsByGame.entries()].map(([game, entries]) => (
            <div key={game} className="card">
              <div className="p-4 border-b border-gray-700/50">
                <h3 className="text-white font-semibold">{game}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                    <th className="p-3">Player</th>
                    <th className="p-3 text-right">Matches</th>
                    <th className="p-3 text-right">Win Odds</th>
                  </tr>
                </thead>
                <tbody>
                  {entries!.map(e => (
                    <tr key={e.player_id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                      <td className="p-3 text-white font-medium">{e.player_name}</td>
                      <td className="p-3 text-right text-gray-300">{e.match_count}</td>
                      <td className="p-3 text-right font-mono text-white">{(e.win_odds * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Player Trend */}
      {tab === "trend" && (
        <div className="space-y-4">
          <select
            className="select max-w-xs"
            value={trendPlayer}
            onChange={e => setTrendPlayer(Number(e.target.value) || "")}
          >
            <option value="">Select a player...</option>
            {players?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {trendData && trendData.length > 0 && (
            <div className="card p-4">
              <h3 className="text-white font-semibold mb-4">Running Average Position Over Time</h3>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickFormatter={(v: string) => v ? v.slice(0, 7) : "?"}
                  />
                  <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} reversed domain={[1, "auto"]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e2a3a", border: "1px solid #374151", borderRadius: 8 }}
                    labelStyle={{ color: "#9CA3AF" }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="running_avg" stroke="#e94560" strokeWidth={2} dot={false} name="Running Avg" />
                  <Line type="monotone" dataKey="position" stroke="#60a5fa" strokeWidth={1} dot={{ r: 2 }} name="Position" opacity={0.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
