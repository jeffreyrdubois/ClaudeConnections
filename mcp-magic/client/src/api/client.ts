import type {
  CollectionCard, CollectionStats, DeckDetail, DeckSummary, DeckStats,
  Folder, ImportResult, LegalityResult, SearchResult, ScryfallCard, StatsFilter,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Collection ─────────────────────────────────────────────────────────────────

export interface CollectionFilter {
  folder_id?: number | null | string;
  search?: string;
  colors?: string;
  type?: string;
  foil?: boolean;
  condition?: string;
  owner?: string;
  legal?: string;
}

export function getCollection(filter: CollectionFilter = {}): Promise<CollectionCard[]> {
  const params = new URLSearchParams();
  if (filter.folder_id !== undefined) params.set("folder_id", String(filter.folder_id));
  if (filter.search) params.set("search", filter.search);
  if (filter.colors) params.set("colors", filter.colors);
  if (filter.type) params.set("type", filter.type);
  if (filter.foil !== undefined) params.set("foil", String(filter.foil));
  if (filter.condition) params.set("condition", filter.condition);
  if (filter.owner) params.set("owner", filter.owner);
  if (filter.legal) params.set("legal", filter.legal);
  return request<CollectionCard[]>(`/collection?${params}`);
}

export function getCollectionStats(filter: StatsFilter = {}): Promise<CollectionStats> {
  const params = new URLSearchParams();
  if (filter.owner) params.set("owner", filter.owner);
  if (filter.folder_id !== undefined) params.set("folder_id", String(filter.folder_id));
  if (filter.condition) params.set("condition", filter.condition);
  if (filter.set_code) params.set("set_code", filter.set_code);
  if (filter.type) params.set("type", filter.type);
  if (filter.deck_id !== undefined) params.set("deck_id", String(filter.deck_id));
  const qs = params.toString();
  return request<CollectionStats>(`/collection/stats${qs ? "?" + qs : ""}`);
}

export function searchCollectionForDeck(query: string): Promise<CollectionCard[]> {
  return request<CollectionCard[]>(`/collection/deck-search?q=${encodeURIComponent(query)}`);
}

export function getCollectionValue(folderId?: number | null): Promise<{ value: number; formatted: string }> {
  const params = folderId !== undefined ? `?folder_id=${folderId}` : "";
  return request(`/collection/value${params}`);
}

export function addCardToCollection(data: {
  name?: string;
  scryfall_id?: string;
  set_code?: string;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  folder_id?: number | null;
  notes?: string;
  purchase_price?: number;
  owner?: string | null;
  legal?: string;
}): Promise<CollectionCard> {
  return request<CollectionCard>("/collection", { method: "POST", body: JSON.stringify(data) });
}

export function updateCollectionCard(id: number, data: Partial<CollectionCard>): Promise<CollectionCard> {
  return request<CollectionCard>(`/collection/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteCollectionCard(id: number): Promise<void> {
  return request<void>(`/collection/${id}`, { method: "DELETE" });
}

// ── Folders ────────────────────────────────────────────────────────────────────

export function getFolders(): Promise<Folder[]> {
  return request<Folder[]>("/folders");
}

export function createFolder(name: string, description?: string): Promise<Folder> {
  return request<Folder>("/folders", { method: "POST", body: JSON.stringify({ name, description }) });
}

export function updateFolder(id: number, name: string, description?: string): Promise<Folder> {
  return request<Folder>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name, description }) });
}

export function deleteFolder(id: number): Promise<void> {
  return request<void>(`/folders/${id}`, { method: "DELETE" });
}

// ── Decks ──────────────────────────────────────────────────────────────────────

export function getDecks(): Promise<DeckSummary[]> {
  return request<DeckSummary[]>("/decks");
}

export function getDeck(id: number): Promise<DeckDetail> {
  return request<DeckDetail>(`/decks/${id}`);
}

export function getDeckStats(id: number): Promise<DeckStats> {
  return request<DeckStats>(`/decks/${id}/stats`);
}

export function getDeckLegality(id: number): Promise<LegalityResult> {
  return request<LegalityResult>(`/decks/${id}/legality`);
}

export function createDeck(data: {
  name: string;
  commander_name?: string;
  commander_scryfall_id?: string;
  partner_name?: string;
  description?: string;
}): Promise<DeckDetail> {
  return request<DeckDetail>("/decks", { method: "POST", body: JSON.stringify(data) });
}

export function updateDeck(id: number, data: {
  name?: string;
  commander_name?: string;
  description?: string;
}): Promise<DeckDetail> {
  return request<DeckDetail>(`/decks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteDeck(id: number): Promise<void> {
  return request<void>(`/decks/${id}`, { method: "DELETE" });
}

export function addCardToDeck(deckId: number, data: {
  name?: string;
  scryfall_id?: string;
  quantity?: number;
  is_commander?: boolean;
  category?: string;
}): Promise<unknown> {
  return request(`/decks/${deckId}/cards`, { method: "POST", body: JSON.stringify(data) });
}

export function removeCardFromDeck(deckId: number, scryfallId: string): Promise<void> {
  return request<void>(`/decks/${deckId}/cards/${scryfallId}`, { method: "DELETE" });
}

export function setCardAsCommander(deckId: number, scryfallId: string, isCommander: boolean): Promise<DeckDetail> {
  return request<DeckDetail>(`/decks/${deckId}/cards/${scryfallId}`, {
    method: "PATCH",
    body: JSON.stringify({ is_commander: isCommander }),
  });
}

// ── Scryfall ───────────────────────────────────────────────────────────────────

export function searchScryfall(query: string, page = 1, set?: string): Promise<SearchResult> {
  const q = set ? `${query} set:${set}` : query;
  return request<SearchResult>(`/scryfall/search?q=${encodeURIComponent(q)}&page=${page}`);
}

export function getCardByName(name: string, set?: string): Promise<ScryfallCard> {
  const params = new URLSearchParams({ name });
  if (set) params.set("set", set);
  return request<ScryfallCard>(`/scryfall/named?${params}`);
}

// ── Import ─────────────────────────────────────────────────────────────────────

export function importCSV(file: File, folderId?: number): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  if (folderId) form.append("folder_id", String(folderId));
  return request<ImportResult>("/import/csv", {
    method: "POST",
    headers: {},
    body: form,
  });
}

export function importText(text: string, folderId?: number): Promise<ImportResult> {
  return request<ImportResult>("/import/text", {
    method: "POST",
    body: JSON.stringify({ text, folder_id: folderId }),
  });
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export interface AuthUser {
  username: string;
}

export function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me");
}

export function loginUser(username: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function setupPassword(username: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logoutUser(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

// ── Bulk Edit ──────────────────────────────────────────────────────────────────

export function bulkUpdateCards(ids: number[], updates: {
  folder_id?: number | null;
  owner?: string | null;
  legal?: string;
  deck_id?: number;
}): Promise<{ updated: number; deck_added: number; deck_skipped: number }> {
  return request("/collection/bulk", {
    method: "PATCH",
    body: JSON.stringify({ ids, updates }),
  });
}
