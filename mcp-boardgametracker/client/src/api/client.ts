import type {
  Player, Game, Board, Match, AverageRankEntry, WinOddsEntry,
  HeadToHeadResult, MonopolyTournament, PlayerStat, TrendPoint,
  InstructionVersion, FullInstructions, AuthUser,
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

// ── Auth ──────────────────────────────────────────────────────────────────────

export function getAuthStatus(): Promise<{ needs_setup: boolean }> {
  return request("/auth/status");
}

export function getCurrentUser(): Promise<AuthUser> {
  return request("/auth/me");
}

export function loginUser(username: string, password: string): Promise<AuthUser> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function registerUser(username: string, password: string): Promise<{ message: string }> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function setupAdmin(username: string, password: string): Promise<AuthUser> {
  return request("/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function logoutUser(): Promise<{ ok: boolean }> {
  return request("/auth/logout", { method: "POST" });
}

export function getUsers(): Promise<{ id: number; username: string; is_admin: number; is_approved: number }[]> {
  return request("/auth/users");
}

export function approveUserById(id: number): Promise<{ ok: boolean }> {
  return request(`/auth/users/${id}/approve`, { method: "POST" });
}

export function deleteUserById(id: number): Promise<{ ok: boolean }> {
  return request(`/auth/users/${id}`, { method: "DELETE" });
}

// ── Players ───────────────────────────────────────────────────────────────────

export function getPlayers(): Promise<Player[]> {
  return request("/players");
}

export function createPlayer(name: string): Promise<Player> {
  return request("/players", { method: "POST", body: JSON.stringify({ name }) });
}

export function deletePlayer(id: number): Promise<void> {
  return request(`/players/${id}`, { method: "DELETE" });
}

// ── Games ─────────────────────────────────────────────────────────────────────

export function getGames(): Promise<Game[]> {
  return request("/games");
}

export function createGame(name: string): Promise<Game> {
  return request("/games", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteGame(id: number): Promise<void> {
  return request(`/games/${id}`, { method: "DELETE" });
}

export function getBoards(gameId: number): Promise<Board[]> {
  return request(`/games/${gameId}/boards`);
}

export function createBoard(gameId: number, name: string): Promise<Board> {
  return request(`/games/${gameId}/boards`, { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteBoard(gameId: number, boardId: number): Promise<void> {
  return request(`/games/${gameId}/boards/${boardId}`, { method: "DELETE" });
}

// ── Matches ───────────────────────────────────────────────────────────────────

export function getMatches(filters: {
  game_id?: number; player_id?: number; limit?: number; offset?: number;
} = {}): Promise<Match[]> {
  const params = new URLSearchParams();
  if (filters.game_id) params.set("game_id", String(filters.game_id));
  if (filters.player_id) params.set("player_id", String(filters.player_id));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return request(`/matches${qs ? "?" + qs : ""}`);
}

export function getMatchCount(): Promise<{ count: number }> {
  return request("/matches/count");
}

export function getMatch(id: number): Promise<Match> {
  return request(`/matches/${id}`);
}

export function createMatch(data: {
  game_id: number;
  board_id?: number | null;
  date?: string | null;
  player_count: number;
  notes?: string | null;
  instruction_version_id?: number | null;
  results: { player_id: number; position: number }[];
}): Promise<Match> {
  return request("/matches", { method: "POST", body: JSON.stringify(data) });
}

export function updateMatch(id: number, data: {
  game_id?: number;
  board_id?: number | null;
  date?: string | null;
  player_count?: number;
  notes?: string | null;
  instruction_version_id?: number | null;
  results?: { player_id: number; position: number }[];
}): Promise<Match> {
  return request(`/matches/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteMatch(id: number): Promise<void> {
  return request(`/matches/${id}`, { method: "DELETE" });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export function getAverageRank(): Promise<AverageRankEntry[]> {
  return request("/analytics/average-rank");
}

export function getWinOdds(): Promise<WinOddsEntry[]> {
  return request("/analytics/odds");
}

export function getHeadToHead(player1: number, player2: number): Promise<HeadToHeadResult> {
  return request(`/analytics/head-to-head?player1=${player1}&player2=${player2}`);
}

export function getMonopolyTournament(): Promise<MonopolyTournament> {
  return request("/analytics/monopoly-tournament");
}

export function getPlayerTrend(playerId: number): Promise<TrendPoint[]> {
  return request(`/analytics/trend/${playerId}`);
}

export function getLeaderboard(): Promise<PlayerStat[]> {
  return request("/analytics/leaderboard");
}

// ── Instructions ──────────────────────────────────────────────────────────────

export function getInstructionVersions(gameId: number): Promise<InstructionVersion[]> {
  return request(`/instructions/game/${gameId}`);
}

export function getFullInstructions(id: number): Promise<FullInstructions> {
  return request(`/instructions/${id}`);
}

export function createInstructionVersion(data: {
  game_id: number; version_name: string; notes?: string; created_by?: string;
}): Promise<{ id: number }> {
  return request("/instructions", { method: "POST", body: JSON.stringify(data) });
}

export function deleteInstructionVersion(id: number): Promise<void> {
  return request(`/instructions/${id}`, { method: "DELETE" });
}

export function createInstructionSection(versionId: number, data: {
  section_number: number; title: string;
}): Promise<{ id: number }> {
  return request(`/instructions/${versionId}/sections`, { method: "POST", body: JSON.stringify(data) });
}

export function updateInstructionSection(sectionId: number, data: {
  section_number?: number; title?: string;
}): Promise<void> {
  return request(`/instructions/sections/${sectionId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteInstructionSection(sectionId: number): Promise<void> {
  return request(`/instructions/sections/${sectionId}`, { method: "DELETE" });
}

export function setInstructionLines(sectionId: number, lines: { line_number: number; content: string }[]): Promise<void> {
  return request(`/instructions/sections/${sectionId}/lines`, { method: "PUT", body: JSON.stringify({ lines }) });
}
