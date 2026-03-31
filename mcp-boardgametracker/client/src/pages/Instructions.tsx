import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, ChevronDown, ChevronRight, Save, X, Edit } from "lucide-react";
import {
  getGames, getInstructionVersions, getFullInstructions,
  createInstructionVersion, deleteInstructionVersion,
  createInstructionSection, updateInstructionSection, deleteInstructionSection,
  setInstructionLines,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { FullInstructions, InstructionSection } from "../types";

function SectionEditor({
  section,
  versionId,
  canEdit,
}: {
  section: InstructionSection;
  versionId: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [linesText, setLinesText] = useState(
    section.lines.map(l => l.content).join("\n")
  );

  const updateTitleMutation = useMutation({
    mutationFn: () => updateInstructionSection(section.id, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instructions", versionId] }),
  });

  const saveLinesMutation = useMutation({
    mutationFn: () => {
      const lines = linesText.split("\n").map((content, i) => ({
        line_number: i + 1,
        content,
      }));
      return setInstructionLines(section.id, lines);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructions", versionId] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstructionSection(section.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instructions", versionId] }),
  });

  function handleSave() {
    updateTitleMutation.mutate();
    saveLinesMutation.mutate();
  }

  return (
    <div className="border border-gray-700/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-3 bg-surface-input/50">
        <span className="text-xs text-gray-500 font-mono w-12">S{section.section_number}</span>
        {editing ? (
          <input className="input flex-1 py-1" value={title} onChange={e => setTitle(e.target.value)} />
        ) : (
          <span className="text-white font-medium flex-1">{section.title}</span>
        )}
        {canEdit && (
          <div className="flex gap-1">
            {editing ? (
              <>
                <button onClick={handleSave} className="p-1 text-green-400 hover:text-green-300"><Save className="w-4 h-4" /></button>
                <button onClick={() => setEditing(false)} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="p-1 text-gray-500 hover:text-blue-400"><Edit className="w-4 h-4" /></button>
                <button onClick={() => { if (confirm("Delete this section?")) deleteMutation.mutate(); }} className="p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        {editing ? (
          <textarea
            className="input font-mono text-xs"
            rows={Math.max(3, linesText.split("\n").length + 1)}
            value={linesText}
            onChange={e => setLinesText(e.target.value)}
            placeholder="Enter lines (one per line)..."
          />
        ) : (
          <div className="space-y-0.5">
            {section.lines.length === 0 ? (
              <span className="text-gray-500 text-sm italic">No content</span>
            ) : (
              section.lines.map(l => (
                <div key={l.id} className="flex gap-2 text-sm">
                  <span className="text-gray-600 font-mono text-xs w-8 text-right shrink-0 pt-0.5">{l.line_number}</span>
                  <span className="text-gray-200">{l.content}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VersionDetail({ versionId, canEdit }: { versionId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: instructions } = useQuery({
    queryKey: ["instructions", versionId],
    queryFn: () => getFullInstructions(versionId),
  });

  const [newSectionNum, setNewSectionNum] = useState("");
  const [newSectionTitle, setNewSectionTitle] = useState("");

  const addSectionMutation = useMutation({
    mutationFn: () => createInstructionSection(versionId, {
      section_number: parseInt(newSectionNum),
      title: newSectionTitle.trim(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructions", versionId] });
      setNewSectionNum("");
      setNewSectionTitle("");
    },
  });

  if (!instructions) return <div className="p-4 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-3 p-4">
      {instructions.notes && (
        <p className="text-sm text-gray-400 italic">{instructions.notes}</p>
      )}

      {instructions.sections.map(s => (
        <SectionEditor key={s.id} section={s} versionId={versionId} canEdit={canEdit} />
      ))}

      {canEdit && (
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Section #</label>
            <input className="input w-20 py-1 text-xs" type="number" min={1} value={newSectionNum} onChange={e => setNewSectionNum(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Title</label>
            <input className="input py-1 text-xs" value={newSectionTitle} onChange={e => setNewSectionTitle(e.target.value)} placeholder="Section title" />
          </div>
          <button
            onClick={() => { if (newSectionNum && newSectionTitle.trim()) addSectionMutation.mutate(); }}
            className="btn-ghost text-xs py-1"
          >
            <Plus className="w-3 h-3" /> Add Section
          </button>
        </div>
      )}
    </div>
  );
}

export default function Instructions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: games } = useQuery({ queryKey: ["games"], queryFn: getGames });

  const [selectedGame, setSelectedGame] = useState<number | "">("");
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [newVersionName, setNewVersionName] = useState("");
  const [newVersionNotes, setNewVersionNotes] = useState("");

  const { data: versions } = useQuery({
    queryKey: ["instructionVersions", selectedGame],
    queryFn: () => getInstructionVersions(selectedGame as number),
    enabled: typeof selectedGame === "number" && selectedGame > 0,
  });

  const createVersionMutation = useMutation({
    mutationFn: () => createInstructionVersion({
      game_id: selectedGame as number,
      version_name: newVersionName.trim(),
      notes: newVersionNotes.trim() || undefined,
      created_by: user?.username,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructionVersions", selectedGame] });
      setNewVersionName("");
      setNewVersionNotes("");
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (id: number) => deleteInstructionVersion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instructionVersions", selectedGame] }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="w-6 h-6 text-teal-400" />
        <h1 className="text-2xl font-bold text-white">Game Instructions</h1>
      </div>

      <p className="text-sm text-gray-400">
        Manage versioned game instructions with house rules. Reference specific rules as:
        <span className="text-accent-light font-mono text-xs ml-1">
          "Per [Game] instructions version [X], section [Y], line [Z]"
        </span>
      </p>

      <select className="select max-w-xs" value={selectedGame} onChange={e => { setSelectedGame(Number(e.target.value) || ""); setExpandedVersion(null); }}>
        <option value="">Select a game...</option>
        {games?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>

      {selectedGame && (
        <>
          {/* Create new version */}
          {user && (
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-300">Create New Version</h3>
              <div className="flex gap-2">
                <input className="input max-w-48" placeholder="Version name (e.g. 2026)" value={newVersionName} onChange={e => setNewVersionName(e.target.value)} />
                <input className="input flex-1" placeholder="Notes (optional)" value={newVersionNotes} onChange={e => setNewVersionNotes(e.target.value)} />
                <button
                  onClick={() => { if (newVersionName.trim()) createVersionMutation.mutate(); }}
                  className="btn-primary"
                  disabled={createVersionMutation.isPending}
                >
                  <Plus className="w-4 h-4" /> Create
                </button>
              </div>
            </div>
          )}

          {/* Version list */}
          <div className="card divide-y divide-gray-700/30">
            {versions?.length === 0 && (
              <div className="p-8 text-center text-gray-500">No instruction versions yet</div>
            )}
            {versions?.map(v => (
              <div key={v.id}>
                <div
                  className="flex items-center p-3 hover:bg-gray-700/20 cursor-pointer"
                  onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                >
                  {expandedVersion === v.id ? <ChevronDown className="w-4 h-4 text-gray-500 mr-2" /> : <ChevronRight className="w-4 h-4 text-gray-500 mr-2" />}
                  <span className="text-white font-medium flex-1">Version: {v.version_name}</span>
                  {v.created_by && <span className="text-xs text-gray-500 mr-3">by {v.created_by}</span>}
                  <span className="text-xs text-gray-500 mr-3">{new Date(v.created_at * 1000).toLocaleDateString()}</span>
                  {user && (
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm("Delete this version?")) deleteVersionMutation.mutate(v.id); }}
                      className="p-1 text-gray-600 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {expandedVersion === v.id && (
                  <VersionDetail versionId={v.id} canEdit={!!user} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
