import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Gamepad2, ChevronDown, ChevronRight } from "lucide-react";
import { getGames, createGame, deleteGame, getBoards, createBoard, deleteBoard } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Game } from "../types";

function BoardList({ game }: { game: Game }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: boards } = useQuery({ queryKey: ["boards", game.id], queryFn: () => getBoards(game.id) });
  const [newBoard, setNewBoard] = useState("");

  const addBoardMutation = useMutation({
    mutationFn: (name: string) => createBoard(game.id, name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["boards", game.id] }); setNewBoard(""); },
  });

  const deleteBoardMutation = useMutation({
    mutationFn: (boardId: number) => deleteBoard(game.id, boardId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boards", game.id] }),
  });

  return (
    <div className="pl-8 py-2 space-y-2">
      {boards?.map(b => (
        <div key={b.id} className="flex items-center gap-2 text-sm text-gray-300">
          <span>{b.name}</span>
          {user && (
            <button
              onClick={() => deleteBoardMutation.mutate(b.id)}
              className="p-0.5 text-gray-600 hover:text-red-400"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {user && (
        <form onSubmit={e => { e.preventDefault(); if (newBoard.trim()) addBoardMutation.mutate(newBoard.trim()); }} className="flex gap-2">
          <input className="input max-w-48 text-xs py-1" placeholder="Add board..." value={newBoard} onChange={e => setNewBoard(e.target.value)} />
          <button type="submit" className="btn-ghost text-xs py-1 px-2"><Plus className="w-3 h-3" /></button>
        </form>
      )}
    </div>
  );
}

export default function Games() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: games, isLoading } = useQuery({ queryKey: ["games"], queryFn: getGames });
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const addMutation = useMutation({
    mutationFn: (name: string) => createGame(name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["games"] }); setNewName(""); setError(""); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGame(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["games"] }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Gamepad2 className="w-6 h-6 text-green-400" />
        <h1 className="text-2xl font-bold text-white">Games</h1>
      </div>

      {user && (
        <form onSubmit={e => { e.preventDefault(); if (newName.trim()) addMutation.mutate(newName.trim()); }} className="flex gap-2">
          <input className="input max-w-xs" placeholder="New game name" value={newName} onChange={e => setNewName(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={addMutation.isPending}><Plus className="w-4 h-4" /> Add</button>
          {error && <span className="text-red-400 text-sm self-center">{error}</span>}
        </form>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading...</div>
      ) : (
        <div className="card divide-y divide-gray-700/30">
          {games?.map(g => (
            <div key={g.id}>
              <div className="flex items-center p-3 hover:bg-gray-700/20">
                <button
                  onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                  className="p-1 text-gray-500 hover:text-gray-300 mr-2"
                >
                  {expanded === g.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <span className="text-white font-medium flex-1">{g.name}</span>
                {user && (
                  <button
                    onClick={() => { if (confirm(`Delete ${g.name}?`)) deleteMutation.mutate(g.id); }}
                    className="p-1 text-gray-600 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              {expanded === g.id && <BoardList game={g} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
