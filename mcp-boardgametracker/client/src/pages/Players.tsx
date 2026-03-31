import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users } from "lucide-react";
import { getPlayers, createPlayer, updatePlayer, deletePlayer } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function Players() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: players, isLoading } = useQuery({ queryKey: ["players"], queryFn: () => getPlayers() });
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

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => updatePlayer(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["players"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePlayer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["players"] }),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim()) addMutation.mutate(newName.trim());
  }

  const activePlayers = players?.filter(p => p.is_active) ?? [];
  const inactivePlayers = players?.filter(p => !p.is_active) ?? [];

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
        <>
          {/* Active Players */}
          <div className="card">
            <div className="p-3 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-300">Active Players ({activePlayers.length})</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {activePlayers.map(p => (
                  <tr key={p.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                    <td className="p-3 text-white font-medium">{p.name}</td>
                    <td className="p-3 w-32 text-right">
                      {user && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => toggleActiveMutation.mutate({ id: p.id, is_active: false })}
                            className="text-xs text-gray-500 hover:text-yellow-400 transition-colors"
                            title="Mark inactive"
                          >
                            Deactivate
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete ${p.name}?`)) deleteMutation.mutate(p.id); }}
                            className="p-1 text-gray-600 hover:text-red-400 transition-colors"
                            title="Delete player"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inactive Players */}
          {inactivePlayers.length > 0 && (
            <div className="card">
              <div className="p-3 border-b border-gray-700/50">
                <h2 className="text-sm font-semibold text-gray-500">Inactive Players ({inactivePlayers.length})</h2>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {inactivePlayers.map(p => (
                    <tr key={p.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 opacity-60">
                      <td className="p-3 text-gray-400">{p.name}</td>
                      <td className="p-3 w-32 text-right">
                        {user && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => toggleActiveMutation.mutate({ id: p.id, is_active: true })}
                              className="text-xs text-gray-500 hover:text-green-400 transition-colors"
                              title="Mark active"
                            >
                              Activate
                            </button>
                            <button
                              onClick={() => { if (confirm(`Delete ${p.name}?`)) deleteMutation.mutate(p.id); }}
                              className="p-1 text-gray-600 hover:text-red-400 transition-colors"
                              title="Delete player"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
