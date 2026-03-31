import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getMonopolyTournament } from "../api/client";

export default function MonopolyTracker() {
  const { data: tournament } = useQuery({ queryKey: ["monopolyTournament"], queryFn: getMonopolyTournament });

  if (!tournament) return <div className="p-6 text-gray-500">Loading...</div>;

  const { matches, total_games, wins, yearly, cumulative } = tournament;

  // Reverse matches for chronological chart (API returns oldest first already)
  const chartData = matches.map((m, i) => ({
    game: i + 1,
    date: m.date ?? `#${i + 1}`,
    Jeffrey: m.jeffrey_cumulative,
    Robert: m.robert_cumulative,
    Bobby: m.bobby_cumulative,
  }));

  const diffData = matches.map((m, i) => ({
    game: i + 1,
    date: m.date ?? `#${i + 1}`,
    "Jeffrey vs Robert": m.jeffrey_vs_robert,
    "Jeffrey vs Bobby": m.jeffrey_vs_bobby,
    "Robert vs Bobby": m.robert_vs_bobby,
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="w-6 h-6 text-game-gold" />
        <h1 className="text-2xl font-bold text-white">Monopoly Cup</h1>
        <span className="text-sm text-gray-400 ml-2">{total_games} games played</span>
      </div>

      {/* Summary */}
      {(() => {
        const leader = Math.min(cumulative.jeffrey, cumulative.robert, cumulative.bobby);
        const jBehind = cumulative.jeffrey - leader;
        const rBehind = cumulative.robert - leader;
        const bBehind = cumulative.bobby - leader;
        return (
          <div className="grid grid-cols-3 gap-4">
            <div className="stat-card items-center">
              <div className="stat-label">Jeffrey</div>
              <div className="stat-value text-blue-400">{cumulative.jeffrey}</div>
              <div className="text-xs text-gray-400">
                {wins.jeffrey} Wins | {jBehind === 0 ? "Leader" : `${jBehind} pts behind leader`}
              </div>
            </div>
            <div className="stat-card items-center">
              <div className="stat-label">Robert</div>
              <div className="stat-value text-green-400">{cumulative.robert}</div>
              <div className="text-xs text-gray-400">
                {wins.robert} Wins | {rBehind === 0 ? "Leader" : `${rBehind} pts behind leader`}
              </div>
            </div>
            <div className="stat-card items-center">
              <div className="stat-label">Bobby</div>
              <div className="stat-value text-accent">{cumulative.bobby}</div>
              <div className="text-xs text-gray-400">
                {wins.bobby} Wins | {bBehind === 0 ? "Leader" : `${bBehind} pts behind leader`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cumulative Points Chart */}
      {chartData.length > 0 && (
        <div className="card p-4">
          <h3 className="text-white font-semibold mb-4">Cumulative Points (Lower is Better)</h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="game" tick={{ fill: "#9CA3AF", fontSize: 11 }} label={{ value: "Game #", fill: "#9CA3AF", position: "insideBottom", offset: -5 }} />
              <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#1e2a3a", border: "1px solid #374151", borderRadius: 8 }} />
              <Legend />
              <Line type="monotone" dataKey="Jeffrey" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Robert" stroke="#34d399" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Bobby" stroke="#e94560" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Differential Chart */}
      {diffData.length > 0 && (
        <div className="card p-4">
          <h3 className="text-white font-semibold mb-4">Point Differentials</h3>
          <p className="text-xs text-gray-400 mb-2">Negative = behind (lower points is better)</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={diffData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="game" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#1e2a3a", border: "1px solid #374151", borderRadius: 8 }} />
              <Legend />
              <Line type="monotone" dataKey="Jeffrey vs Robert" stroke="#a78bfa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Jeffrey vs Bobby" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Robert vs Bobby" stroke="#14b8a6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Yearly Breakdown */}
      <div className="card">
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-white font-semibold">Yearly Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700/50 text-gray-400 text-left">
              <th className="p-3">Year</th>
              <th className="p-3 text-right">Games</th>
              <th className="p-3 text-right">Jeffrey</th>
              <th className="p-3 text-right">Robert</th>
              <th className="p-3 text-right">Bobby</th>
              <th className="p-3 text-right">Leader</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(yearly).sort(([a], [b]) => a.localeCompare(b)).map(([year, data]) => {
              const leader = data.jeffrey <= data.robert && data.jeffrey <= data.bobby ? "Jeffrey"
                : data.robert <= data.bobby ? "Robert" : "Bobby";
              return (
                <tr key={year} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="p-3 text-white font-medium">{year}</td>
                  <td className="p-3 text-right text-gray-300">{data.count}</td>
                  <td className="p-3 text-right font-mono text-blue-400">{data.jeffrey}</td>
                  <td className="p-3 text-right font-mono text-green-400">{data.robert}</td>
                  <td className="p-3 text-right font-mono text-accent">{data.bobby}</td>
                  <td className="p-3 text-right text-game-gold font-bold">{leader}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent Results */}
      <div className="card">
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-white font-semibold">Recent Results</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="p-3">#</th>
                <th className="p-3">Date</th>
                <th className="p-3 text-center">Jeffrey</th>
                <th className="p-3 text-center">Robert</th>
                <th className="p-3 text-center">Bobby</th>
                <th className="p-3 text-center">J-R</th>
                <th className="p-3 text-center">J-B</th>
                <th className="p-3 text-center">R-B</th>
              </tr>
            </thead>
            <tbody>
              {[...matches].reverse().slice(0, 30).map((m, i) => (
                <tr key={m.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="p-3 text-gray-500">{matches.length - i}</td>
                  <td className="p-3 text-gray-300">{m.date ?? "Unknown"}</td>
                  <td className={`p-3 text-center font-mono ${m.jeffrey_pos === 1 ? "text-game-gold font-bold" : "text-gray-400"}`}>{m.jeffrey_pos}</td>
                  <td className={`p-3 text-center font-mono ${m.robert_pos === 1 ? "text-game-gold font-bold" : "text-gray-400"}`}>{m.robert_pos}</td>
                  <td className={`p-3 text-center font-mono ${m.bobby_pos === 1 ? "text-game-gold font-bold" : "text-gray-400"}`}>{m.bobby_pos}</td>
                  <td className={`p-3 text-center font-mono text-xs ${m.jeffrey_vs_robert < 0 ? "text-blue-400" : m.jeffrey_vs_robert > 0 ? "text-green-400" : "text-gray-500"}`}>
                    {m.jeffrey_vs_robert}
                  </td>
                  <td className={`p-3 text-center font-mono text-xs ${m.jeffrey_vs_bobby < 0 ? "text-blue-400" : m.jeffrey_vs_bobby > 0 ? "text-accent" : "text-gray-500"}`}>
                    {m.jeffrey_vs_bobby}
                  </td>
                  <td className={`p-3 text-center font-mono text-xs ${m.robert_vs_bobby < 0 ? "text-green-400" : m.robert_vs_bobby > 0 ? "text-accent" : "text-gray-500"}`}>
                    {m.robert_vs_bobby}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
