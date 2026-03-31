import { useQuery } from "@tanstack/react-query";
import { Trophy, Dice5, Users, Gamepad2 } from "lucide-react";
import { getLeaderboard, getMatches, getMatchCount, getPlayers, getGames } from "../api/client";

export default function Dashboard() {
  const { data: leaderboard } = useQuery({ queryKey: ["leaderboard"], queryFn: getLeaderboard });
  const { data: recentMatches } = useQuery({ queryKey: ["matches", "recent"], queryFn: () => getMatches({ limit: 10 }) });
  const { data: matchCount } = useQuery({ queryKey: ["matchCount"], queryFn: getMatchCount });
  const { data: players } = useQuery({ queryKey: ["players"], queryFn: () => getPlayers() });
  const { data: games } = useQuery({ queryKey: ["games"], queryFn: getGames });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-label">Total Matches</div>
          <div className="stat-value flex items-center gap-2">
            <Dice5 className="w-6 h-6 text-accent" />
            {matchCount?.count ?? "..."}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Players</div>
          <div className="stat-value flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" />
            {players?.length ?? "..."}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Games</div>
          <div className="stat-value flex items-center gap-2">
            <Gamepad2 className="w-6 h-6 text-green-400" />
            {games?.length ?? "..."}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Top Player</div>
          <div className="stat-value flex items-center gap-2 text-lg">
            <Trophy className="w-6 h-6 text-game-gold" />
            {leaderboard?.[0]?.player_name ?? "..."}
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card">
        <div className="p-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
          <p className="text-xs text-gray-400">Overall average finishing position (lower is better)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="p-3 w-12">#</th>
                <th className="p-3">Player</th>
                <th className="p-3 text-right">Matches</th>
                <th className="p-3 text-right">Wins</th>
                <th className="p-3 text-right">Win %</th>
                <th className="p-3 text-right">Avg Position</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard?.map((p, i) => (
                <tr key={p.player_id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className={`p-3 font-bold ${i === 0 ? "text-game-gold" : i === 1 ? "text-game-silver" : i === 2 ? "text-game-bronze" : "text-gray-500"}`}>
                    {i + 1}
                  </td>
                  <td className="p-3 text-white font-medium">{p.player_name}</td>
                  <td className="p-3 text-right text-gray-300">{p.total_matches}</td>
                  <td className="p-3 text-right text-gray-300">{p.wins}</td>
                  <td className="p-3 text-right text-gray-300">
                    {p.total_matches > 0 ? Math.round((p.wins / p.total_matches) * 100) : 0}%
                  </td>
                  <td className="p-3 text-right font-mono text-white">{p.overall_avg_position.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Matches */}
      <div className="card">
        <div className="p-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Recent Matches</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="p-3">Date</th>
                <th className="p-3">Game</th>
                <th className="p-3">Board</th>
                <th className="p-3 text-right">Players</th>
              </tr>
            </thead>
            <tbody>
              {recentMatches?.map(m => (
                <tr key={m.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="p-3 text-gray-300">{m.date ?? "Unknown"}</td>
                  <td className="p-3 text-white font-medium">{m.game_name}</td>
                  <td className="p-3 text-gray-400">{m.board_name ?? "—"}</td>
                  <td className="p-3 text-right text-gray-300">{m.player_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
