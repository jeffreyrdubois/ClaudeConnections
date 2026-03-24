import { Upload, X, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { importCSV, importText, getFolders } from "../api/client";
import type { ImportResult } from "../types";

interface ImportModalProps {
  onClose: () => void;
  defaultFolderId?: number | null;
}

type Mode = "csv" | "text";

export default function ImportModal({ onClose, defaultFolderId }: ImportModalProps) {
  const [mode, setMode] = useState<Mode>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId ?? null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: getFolders });

  async function handleImport() {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      let res: ImportResult;
      if (mode === "csv") {
        if (!file) { setError("Please select a CSV file"); return; }
        res = await importCSV(file, folderId ?? undefined);
      } else {
        if (!text.trim()) { setError("Please enter card list text"); return; }
        res = await importText(text, folderId ?? undefined);
      }
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["collection-stats"] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface-card rounded-2xl shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Import Cards</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode tabs */}
          <div className="flex gap-2 p-1 bg-surface-input rounded-lg w-fit">
            {(["csv", "text"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? "bg-amber-500 text-gray-900" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {m === "csv" ? "Manabox CSV" : "Text List"}
              </button>
            ))}
          </div>

          {/* Folder selector */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Import to Folder (optional)</label>
            <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value ? parseInt(e.target.value) : null)} className="select max-w-xs">
              <option value="">No folder (unassigned)</option>
              {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          {mode === "csv" ? (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">CSV File (Manabox export)</label>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-700 hover:border-amber-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-green-400">
                    <FileText className="w-5 h-5" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <div className="text-sm text-gray-400">Click to select CSV file</div>
                    <div className="text-xs text-gray-600 mt-1">Supports Manabox export format</div>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Card List (one per line: "4x Lightning Bolt" or "4 Lightning Bolt" or just "Lightning Bolt")
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"4x Sol Ring\n1x Command Tower\n2 Swamp\nLightning Bolt"}
                rows={10}
                className="input font-mono text-xs resize-none"
              />
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-xl border ${result.imported > 0 ? "bg-green-900/20 border-green-700/50" : "bg-yellow-900/20 border-yellow-700/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.imported > 0
                  ? <CheckCircle className="w-4 h-4 text-green-400" />
                  : <AlertCircle className="w-4 h-4 text-yellow-400" />
                }
                <span className="text-sm font-medium text-white">Import Complete</span>
              </div>
              <div className="text-sm text-gray-300 space-y-0.5">
                <div>Total: {result.total} entries</div>
                <div className="text-green-400">Imported: {result.imported}</div>
                {result.skipped > 0 && <div className="text-yellow-400">Skipped: {result.skipped}</div>}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 max-h-32 overflow-y-auto">
                  <div className="text-xs text-gray-400 mb-1">Errors:</div>
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-400">{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-400">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
          <button onClick={onClose} className="btn-secondary">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button onClick={handleImport} disabled={importing} className="btn-primary">
              {importing ? "Importing..." : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
