import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Swords, Trash2, ChevronRight, AlertCircle, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDecks, createDeck, deleteDeck } from "../api/client";
import type { DeckSummary } from "../types";
import { ColorIdentity } from "../components/ManaSymbol";

export default function Decks() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: decks = [], isLoading } = useQuery({
    queryKey: ["decks"],
    queryFn: getDecks,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDeck,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["decks"] }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Decks</h1>
          <p className="text-gray-400 text-sm mt-0.5">{decks.length} Commander deck{decks.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> New Deck
        </button>
      </div>

      {showCreate && (
        <CreateDeckForm
          onSave={async (name, commanderName) => {
            await createDeck({ name, commander_name: commanderName });
            queryClient.invalidateQueries({ queryKey: ["decks"] });
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {isLoading ? (
        <div className="text-gray-500 text-center py-12">Loading decks...</div>
      ) : decks.length === 0 && !showCreate ? (
        <div className="text-center py-16">
          <Swords className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <div className="text-gray-500 mb-2">No decks yet</div>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" /> Build your first deck
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onClick={() => navigate(`/decks/${deck.id}`)}
              onDelete={() => {
                if (confirm(`Delete deck "${deck.name}"?`)) deleteMutation.mutate(deck.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({ deck, onClick, onDelete }: {
  deck: DeckSummary;
  onClick: () => void;
  onDelete: () => void;
}) {
  const isComplete = deck.card_count >= 100;
  const colorIdentity = deck.commander_colors || [];

  return (
    <div
      className="card overflow-hidden hover:border-amber-500/30 transition-all cursor-pointer group"
      onClick={onClick}
    >
      {/* Commander image banner */}
      <div className="relative h-36 bg-gray-800 overflow-hidden">
        {deck.commander_image ? (
          <img
            src={deck.commander_image}
            alt={deck.commander_name || "Commander"}
            className="w-full h-full object-cover object-[center_15%] group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Swords className="w-8 h-8 text-gray-700" />
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-card via-surface-card/40 to-transparent" />

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 p-1.5 bg-gray-900/70 rounded-lg text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Card count pill */}
        <div className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
          isComplete ? "bg-green-900/80 text-green-400" : "bg-gray-900/80 text-gray-300"
        }`}>
          {isComplete ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          {deck.card_count}/100
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="font-semibold text-white mb-0.5">{deck.name}</div>
        {deck.commander_name && (
          <div className="text-sm text-gray-400 mb-2">
            {deck.commander_name}
            {deck.partner_name && ` / ${deck.partner_name}`}
          </div>
        )}

        <div className="flex items-center justify-between">
          <ColorIdentity identity={colorIdentity} size="sm" />
          <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-amber-400 transition-colors" />
        </div>

        {deck.description && (
          <p className="text-xs text-gray-500 mt-2 line-clamp-2">{deck.description}</p>
        )}
      </div>
    </div>
  );
}

function CreateDeckForm({ onSave, onCancel }: {
  onSave: (name: string, commanderName: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [commanderName, setCommanderName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || !commanderName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), commanderName.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create deck");
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 mb-4 border-amber-500/30 max-w-lg">
      <h3 className="text-sm font-semibold text-white mb-3">New Commander Deck</h3>
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Deck name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          autoFocus
        />
        <input
          type="text"
          placeholder="Commander name (will look up on Scryfall)"
          value={commanderName}
          onChange={(e) => setCommanderName(e.target.value)}
          className="input"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !commanderName.trim() || saving}
            className="btn-primary text-sm"
          >
            {saving ? "Creating..." : "Create Deck"}
          </button>
        </div>
      </div>
    </div>
  );
}
