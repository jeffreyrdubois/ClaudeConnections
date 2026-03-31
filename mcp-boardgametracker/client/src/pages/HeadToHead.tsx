import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Swords } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { getPlayers, getHeadToHead } from "../api/client";

export default function HeadToHead() {
  const { data: players } = useQuery({ queryKey: ["players"], queryFn: () => getPlayers() });
  const [player1, setPlayer1] = useState<number | "">("");
  const [player2, setPlayer2] = useState<number | "">("");

  const { data: h2h } = useQuery({
    queryKey: ["h2h", player1, player2],
    queryFn: () => getHeadToHead(player1 as number, player2 as number),
    enabled: typeof player1 === "number" && typeof player2 === "number" && player1 > 0 && player2 > 0,
  });

  const p1Name = players?.find(p => p.id === player1)?.name ?? "Player 1";
  const p2Name = players?.find(p => p.id === player2)?.name ?? "Player 2";

  // Running differential for chart
  const runningData = h2h?.matches ? [...h2h.matches].reverse().map((m, i, arr) => {
    const prior = arr.slice(0, i + 1);
    const p1w = prior.filter(x => x.player1_position < x.player2_position).length;
    const p2w = prior.filter(x => x.player2_position < x.player1_position).length;
    return {
      date: m.date ?? `Game ${i + 1}`,
      game: m.game_name,
      [p1Name]: p1w,
      [p2Name]: p2w,
      differential: p1w - p2w,
    };
  }) : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Swords className="w-6 h-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-white">Head to Head</h1>
      </div>

      <div className="flex gap-4 flex-wrap">
        <select className="select max-w-xs" value={player1} onChange={e => setPlayer1(Number(e.target.value) || "")}>
          <option value="">Select Player 1...</option>
          {players?.filter(p => p.id !== player2).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="self-center text-gray-500 font-bold">VS</span>
        <select className="select max-w-xs" value={player2} onChange={e => setPlayer2(Number(e.target.value) || "")}>
          <option value="">Select Player 2...</option>
          {players?.filter(p => p.id !== player1).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {h2h && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="stat-card items-center">
              <div className="stat-label">{p1Name} Wins</div>
              <div className="stat-value text-blue-400">{h2h.summary.player1_wins}</div>
            </div>
            <div className="stat-card items-center">
              <div className="stat-label">Total Matches</div>
              <div className="stat-value">{h2h.summary.total}</div>
              {h2h.summary.ties > 0 && <div className="text-xs text-gray-400">{h2h.summary.ties} ties</div>}
            </div>
            <div className="stat-card items-center">
              <div className="stat-label">{p2Name} Wins</div>
              <div className="stat-value text-accent">{h2h.summary.player2_wins}</div>
            </div>
          </div>

          {/* Running wins chart */}
          {runningData.length > 0 && (
            <div className="card p-4">
              <h3 className="text-white font-semibold mb-4">Cumulative Wins Over Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={runningData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fill: "#9CA3AF", fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 7)} />
                  <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#1e2a3a", border: "1px solid #374151", borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey={p1Name} stroke="#60a5fa" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey={p2Name} stroke="#e94560" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Match list */}
          <div className="card">
            <div className="p-4 border-b border-gray-700/50">
              <h3 className="text-white font-semibold">Match History</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                  <th className="p-3">Date</th>
                  <th className="p-3">Game</th>
                  <th className="p-3 text-center">{p1Name}</th>
                  <th className="p-3 text-center">{p2Name}</th>
                  <th className="p-3 text-center">Winner</th>
                </tr>
              </thead>
              <tbody>
                {h2h.matches.map((m, i) => {
                  const winner = m.player1_position < m.player2_position ? p1Name
                    : m.player2_position < m.player1_position ? p2Name : "Tie";
                  return (
                    <tr key={i} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                      <td className="p-3 text-gray-300">{m.date ?? "Unknown"}</td>
                      <td className="p-3 text-white">{m.game_name}</td>
                      <td className={`p-3 text-center font-mono ${m.player1_position < m.player2_position ? "text-game-gold font-bold" : "text-gray-400"}`}>
                        {m.player1_position}
                      </td>
                      <td className={`p-3 text-center font-mono ${m.player2_position < m.player1_position ? "text-game-gold font-bold" : "text-gray-400"}`}>
                        {m.player2_position}
                      </td>
                      <td className={`p-3 text-center font-medium ${winner === p1Name ? "text-blue-400" : winner === p2Name ? "text-accent" : "text-gray-500"}`}>
                        {winner}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
