import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users } from "lucide-react";
import { getPlayers, createPlayer, deletePlayer } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function Players() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: players, isLoading } = useQuery({ queryKey: ["players"], queryFn: getPlayers });
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const addMutation = useMutation({
    mutationFn: (name: string) => createPlayer(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players"] });
      setNewName("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePlayer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["players"] }),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim()) addMutation.mutate(newName.trim());
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-white">Players</h1>
      </div>

      {user && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="New player name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={addMutation.isPending}>
            <Plus className="w-4 h-4" /> Add
          </button>
          {error && <span className="text-red-400 text-sm self-center">{error}</span>}
        </form>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading...</div>
      ) : (
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="p-3">Name</th>
                {user && <th className="p-3 w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {players?.map(p => (
                <tr key={p.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="p-3 text-white font-medium">{p.name}</td>
                  {user && (
                    <td className="p-3">
                      <button
                        onClick={() => { if (confirm(`Delete ${p.name}?`)) deleteMutation.mutate(p.id); }}
                        className="p-1 text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete player"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
