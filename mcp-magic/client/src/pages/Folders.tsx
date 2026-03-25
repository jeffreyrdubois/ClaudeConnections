import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Trash2, Edit2, ChevronRight, DollarSign, Layers } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFolders, createFolder, updateFolder, deleteFolder } from "../api/client";

export default function Folders() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: folders = [], isLoading } = useQuery({
    queryKey: ["folders"],
    queryFn: getFolders,
  });

  const createMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createFolder(name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, description }: { id: number; name: string; description?: string }) =>
      updateFolder(id, name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["collection"] });
    },
  });

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Folders</h1>
          <p className="text-gray-400 text-sm mt-0.5">Organize your collection into folders</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> New Folder
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <FolderForm
          onSave={(name, description) => createMutation.mutate({ name, description })}
          onCancel={() => setShowCreate(false)}
          saving={createMutation.isPending}
        />
      )}

      {/* Folder grid */}
      {isLoading ? (
        <div className="text-gray-500 text-center py-12">Loading folders...</div>
      ) : folders.length === 0 && !showCreate ? (
        <div className="text-center py-16">
          <FolderOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <div className="text-gray-500 mb-2">No folders yet</div>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" /> Create your first folder
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders.map((folder) => (
            editingId === folder.id ? (
              <div key={folder.id} className="card p-4">
                <FolderForm
                  defaultName={folder.name}
                  defaultDescription={folder.description || ""}
                  onSave={(name, description) => updateMutation.mutate({ id: folder.id, name, description })}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                />
              </div>
            ) : (
              <div
                key={folder.id}
                className="card p-4 hover:border-amber-500/30 transition-colors cursor-pointer group"
                onClick={() => navigate(`/collection?folder_id=${folder.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-amber-500/15 rounded-lg flex items-center justify-center">
                      <FolderOpen className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <div className="font-medium text-white">{folder.name}</div>
                      {folder.description && (
                        <div className="text-xs text-gray-500">{folder.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setEditingId(folder.id)} className="btn-ghost p-1.5 rounded-md text-gray-500 hover:text-gray-300">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete folder "${folder.name}"? Cards will be unassigned.`)) {
                          deleteMutation.mutate(folder.id);
                        }
                      }}
                      className="btn-ghost p-1.5 rounded-md text-gray-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{folder.card_count} cards</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700/50">
                  <span className="text-xs text-gray-600">
                    Created {new Date(folder.created_at * 1000).toLocaleDateString()}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-amber-400 transition-colors" />
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function FolderForm({ defaultName = "", defaultDescription = "", onSave, onCancel, saving }: {
  defaultName?: string;
  defaultDescription?: string;
  onSave: (name: string, description?: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);

  return (
    <div className="card p-4 mb-4 border-amber-500/30">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          autoFocus
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={() => name.trim() && onSave(name.trim(), description.trim() || undefined)}
            disabled={!name.trim() || saving}
            className="btn-primary text-sm"
          >
            {saving ? "Saving..." : defaultName ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
