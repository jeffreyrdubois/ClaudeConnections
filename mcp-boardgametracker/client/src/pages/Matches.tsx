import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Dice5, X, ChevronDown, ChevronRight, Edit } from "lucide-react";
import {
  getMatches, getMatch, createMatch, deleteMatch, updateMatch,
  getPlayers, getGames, getBoards, getInstructionVersions,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Player, Game, Match } from "../types";

function MatchForm({
  onClose,
  editMatch,
}: {
  onClose: () => void;
  editMatch?: Match;
}) {
  const queryClient = useQueryClient();
  const { data: allPlayers } = useQuery({ queryKey: ["players"], queryFn: () => getPlayers() });
  const { data: games } = useQuery({ queryKey: ["games"], queryFn: getGames });

  // Build initial positions map from edit data
  const editPositions = new Map<number, string>();
  editMatch?.results?.forEach(r => editPositions.set(r.player_id, String(r.position)));

  const [gameId, setGameId] = useState(editMatch?.game_id ?? 0);
  const [date, setDate] = useState(editMatch?.date ?? new Date().toISOString().split("T")[0]);
  const [boardId, setBoardId] = useState<number | "">(editMatch?.board_id ?? "");
  const [instructionVersionId, setInstructionVersionId] = useState<number | "">(editMatch?.instruction_version_id ?? "");
  const [notes, setNotes] = useState(editMatch?.notes ?? "");
  // positions: map of player_id -> position string (empty string = didn't play)
  const [positions, setPositions] = useState<Map<number, string>>(editPositions);
  const [error, setError] = useState("");

  const { data: boards } = useQuery({
    queryKey: ["boards", gameId],
    queryFn: () => getBoards(gameId),
    enabled: gameId > 0,
  });

  const { data: versions } = useQuery({
    queryKey: ["instructionVersions", gameId],
    queryFn: () => getInstructionVersions(gameId),
    enabled: gameId > 0,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof createMatch>[0]) =>
      editMatch ? updateMatch(editMatch.id, data) : createMatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["matchCount"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function setPosition(pid: number, val: string) {
    const next = new Map(positions);
    if (val === "") {
      next.delete(pid);
    } else {
      next.set(pid, val);
    }
    setPositions(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gameId) { setError("Select a game"); return; }

    // Build results from positions (only players with a position entered)
    const results: { player_id: number; position: number }[] = [];
    for (const [pid, posStr] of positions) {
      const pos = parseInt(posStr);
      if (!isNaN(pos) && pos > 0) {
        results.push({ player_id: pid, position: pos });
      }
    }

    if (results.length < 2) { setError("Enter positions for at least 2 players"); return; }

    saveMutation.mutate({
      game_id: gameId,
      board_id: boardId || null,
      date: date || null,
      player_count: results.length,
      notes: notes || null,
      instruction_version_id: instructionVersionId || null,
      results,
    });
  }

  // Show active players for new matches, or all players with positions for edits
  const displayPlayers = editMatch
    ? allPlayers ?? []
    : (allPlayers ?? []).filter(p => p.is_active);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">{editMatch ? "Edit Match" : "New Match"}</h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Game */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Game</label>
            <select className="select" value={gameId} onChange={e => { setGameId(Number(e.target.value)); setBoardId(""); setInstructionVersionId(""); }}>
              <option value={0}>Select a game...</option>
              {games?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Date</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {/* Board (optional) */}
          {boards && boards.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Board</label>
              <select className="select" value={boardId} onChange={e => setBoardId(Number(e.target.value) || "")}>
                <option value="">None</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Instruction Version (optional) */}
          {versions && versions.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Instruction Version</label>
              <select className="select" value={instructionVersionId} onChange={e => setInstructionVersionId(Number(e.target.value) || "")}>
                <option value="">None</option>
                {versions.map(v => <option key={v.id} value={v.id}>{v.version_name}</option>)}
              </select>
            </div>
          )}

          {/* Players & Positions — all active players listed, leave blank if didn't play */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Finishing Positions <span className="text-gray-600">(leave blank = didn't play)</span>
            </label>
            <div className="space-y-1.5">
              {displayPlayers.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-surface-input rounded-lg px-3 py-2">
                  <span className={`text-sm flex-1 ${positions.has(p.id) ? "text-white font-medium" : "text-gray-500"}`}>
                    {p.name}
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="input w-16 text-center py-1"
                    value={positions.get(p.id) ?? ""}
                    onChange={e => setPosition(p.id, e.target.value)}
                    placeholder="—"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Notes</label>
            <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={saveMutation.isPending}>
              {editMatch ? "Save Changes" : "Record Match"}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Matches() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingMatch, setEditingMatch] = useState<Match | undefined>();
  const [filterGame, setFilterGame] = useState<number | "">("");
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);

  const { data: games } = useQuery({ queryKey: ["games"], queryFn: getGames });
  const { data: matches, isLoading } = useQuery({
    queryKey: ["matches", filterGame],
    queryFn: () => getMatches({ game_id: filterGame || undefined }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMatch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["matchCount"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });

  // Load match details when expanded
  const { data: expandedDetails } = useQuery({
    queryKey: ["match", expandedMatch],
    queryFn: () => getMatch(expandedMatch!),
    enabled: expandedMatch !== null,
  });

  function openEdit(match: Match) {
    getMatch(match.id).then(m => {
      setEditingMatch(m);
      setShowForm(true);
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Dice5 className="w-6 h-6 text-accent" />
          <h1 className="text-2xl font-bold text-white">Matches</h1>
        </div>
        {user && (
          <button onClick={() => { setEditingMatch(undefined); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> New Match
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <select className="select max-w-xs" value={filterGame} onChange={e => setFilterGame(Number(e.target.value) || "")}>
          <option value="">All Games</option>
          {games?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {showForm && (
        <MatchForm
          onClose={() => setShowForm(false)}
          editMatch={editingMatch}
        />
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading...</div>
      ) : (
        <div className="card divide-y divide-gray-700/30">
          {matches?.length === 0 && (
            <div className="p-8 text-center text-gray-500">No matches recorded yet</div>
          )}
          {matches?.map(m => (
            <div key={m.id}>
              <div
                className="flex items-center p-3 hover:bg-gray-700/20 cursor-pointer"
                onClick={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}
              >
                {expandedMatch === m.id ? <ChevronDown className="w-4 h-4 text-gray-500 mr-2" /> : <ChevronRight className="w-4 h-4 text-gray-500 mr-2" />}
                <span className="text-gray-400 text-sm w-28 shrink-0">{m.date ?? "Unknown"}</span>
                <span className="text-white font-medium flex-1">{m.game_name}</span>
                {m.board_name && <span className="text-gray-500 text-sm mr-4">{m.board_name}</span>}
                <span className="text-gray-400 text-sm">{m.player_count}p</span>
                {user && (
                  <div className="flex gap-1 ml-3">
                    <button onClick={e => { e.stopPropagation(); openEdit(m); }} className="p-1 text-gray-600 hover:text-blue-400">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); if (confirm("Delete this match?")) deleteMutation.mutate(m.id); }} className="p-1 text-gray-600 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {expandedMatch === m.id && expandedDetails && (
                <div className="px-3 pb-3 pl-10">
                  <div className="bg-surface-input rounded-lg p-3 space-y-1">
                    {expandedDetails.results?.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-sm">
                        <span className={`w-6 text-right font-bold ${r.position === 1 ? "text-game-gold" : r.position === 2 ? "text-game-silver" : r.position === 3 ? "text-game-bronze" : "text-gray-500"}`}>
                          {r.position}
                        </span>
                        <span className="text-white">{r.player_name}</span>
                      </div>
                    ))}
                    {expandedDetails.notes && (
                      <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-700/30">
                        {expandedDetails.notes}
                      </p>
                    )}
                    {expandedDetails.instruction_version_name && (
                      <p className="text-xs text-gray-500">
                        Played under: {expandedDetails.instruction_version_name}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
