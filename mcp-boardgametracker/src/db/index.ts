import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "boardgames.db");

// ── Database Init ──────────────────────────────────────────────────────────────

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Players
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Games
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Boards (for games with multiple boards, e.g. Monopoly, Terraforming Mars)
  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(game_id, name)
  );

  -- Game instruction versions
  CREATE TABLE IF NOT EXISTS instruction_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    version_name TEXT NOT NULL,
    notes TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    created_by TEXT,
    UNIQUE(game_id, version_name)
  );

  -- Instruction sections
  CREATE TABLE IF NOT EXISTS instruction_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES instruction_versions(id) ON DELETE CASCADE,
    section_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    UNIQUE(version_id, section_number)
  );

  -- Instruction lines
  CREATE TABLE IF NOT EXISTS instruction_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES instruction_sections(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    UNIQUE(section_id, line_number)
  );

  -- Matches
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    board_id INTEGER REFERENCES boards(id) ON DELETE SET NULL,
    date TEXT,
    player_count INTEGER NOT NULL,
    notes TEXT,
    instruction_version_id INTEGER REFERENCES instruction_versions(id) ON DELETE SET NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Match results (one per player per match)
  CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    UNIQUE(match_id, player_id)
  );

  -- Users (for auth)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_approved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- App config (key-value)
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_matches_game ON matches(game_id);
  CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
  CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results(match_id);
  CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
  CREATE INDEX IF NOT EXISTS idx_boards_game ON boards(game_id);
  CREATE INDEX IF NOT EXISTS idx_instruction_versions_game ON instruction_versions(game_id);
  CREATE INDEX IF NOT EXISTS idx_instruction_sections_version ON instruction_sections(version_id);
  CREATE INDEX IF NOT EXISTS idx_instruction_lines_section ON instruction_lines(section_id);
`);

// ── Player Queries ────────────────────────────────────────────────────────────

export function getAllPlayers() {
  return db.prepare("SELECT * FROM players ORDER BY name").all() as {
    id: number; name: string; created_at: number;
  }[];
}

export function getPlayerById(id: number) {
  return db.prepare("SELECT * FROM players WHERE id = ?").get(id) as {
    id: number; name: string; created_at: number;
  } | undefined;
}

export function createPlayer(name: string) {
  const result = db.prepare("INSERT INTO players (name) VALUES (?)").run(name);
  return { id: result.lastInsertRowid as number, name };
}

export function deletePlayer(id: number) {
  db.prepare("DELETE FROM players WHERE id = ?").run(id);
}

// ── Game Queries ──────────────────────────────────────────────────────────────

export function getAllGames() {
  return db.prepare("SELECT * FROM games ORDER BY name").all() as {
    id: number; name: string; created_at: number;
  }[];
}

export function getGameById(id: number) {
  return db.prepare("SELECT * FROM games WHERE id = ?").get(id) as {
    id: number; name: string; created_at: number;
  } | undefined;
}

export function createGame(name: string) {
  const result = db.prepare("INSERT INTO games (name) VALUES (?)").run(name);
  return { id: result.lastInsertRowid as number, name };
}

export function deleteGame(id: number) {
  db.prepare("DELETE FROM games WHERE id = ?").run(id);
}

// ── Board Queries ─────────────────────────────────────────────────────────────

export function getBoardsByGame(gameId: number) {
  return db.prepare("SELECT * FROM boards WHERE game_id = ? ORDER BY name").all(gameId) as {
    id: number; game_id: number; name: string; created_at: number;
  }[];
}

export function createBoard(gameId: number, name: string) {
  const result = db.prepare("INSERT INTO boards (game_id, name) VALUES (?, ?)").run(gameId, name);
  return { id: result.lastInsertRowid as number, game_id: gameId, name };
}

export function deleteBoard(id: number) {
  db.prepare("DELETE FROM boards WHERE id = ?").run(id);
}

// ── Match Queries ─────────────────────────────────────────────────────────────

export interface MatchRow {
  id: number;
  game_id: number;
  game_name: string;
  board_id: number | null;
  board_name: string | null;
  date: string | null;
  player_count: number;
  notes: string | null;
  instruction_version_id: number | null;
  instruction_version_name: string | null;
  created_at: number;
}

export function getMatches(filters: { game_id?: number; player_id?: number; limit?: number; offset?: number } = {}) {
  let sql = `
    SELECT m.*, g.name as game_name, b.name as board_name, iv.version_name as instruction_version_name
    FROM matches m
    JOIN games g ON g.id = m.game_id
    LEFT JOIN boards b ON b.id = m.board_id
    LEFT JOIN instruction_versions iv ON iv.id = m.instruction_version_id
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.game_id) {
    conditions.push("m.game_id = ?");
    params.push(filters.game_id);
  }
  if (filters.player_id) {
    conditions.push("m.id IN (SELECT match_id FROM match_results WHERE player_id = ?)");
    params.push(filters.player_id);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY m.date DESC, m.id DESC";
  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
    if (filters.offset) {
      sql += " OFFSET ?";
      params.push(filters.offset);
    }
  }
  return db.prepare(sql).all(...params) as MatchRow[];
}

export function getMatchById(id: number) {
  return db.prepare(`
    SELECT m.*, g.name as game_name, b.name as board_name, iv.version_name as instruction_version_name
    FROM matches m
    JOIN games g ON g.id = m.game_id
    LEFT JOIN boards b ON b.id = m.board_id
    LEFT JOIN instruction_versions iv ON iv.id = m.instruction_version_id
    WHERE m.id = ?
  `).get(id) as MatchRow | undefined;
}

export function createMatch(data: {
  game_id: number;
  board_id?: number | null;
  date?: string | null;
  player_count: number;
  notes?: string | null;
  instruction_version_id?: number | null;
}) {
  const result = db.prepare(`
    INSERT INTO matches (game_id, board_id, date, player_count, notes, instruction_version_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.game_id, data.board_id ?? null, data.date ?? null, data.player_count, data.notes ?? null, data.instruction_version_id ?? null);
  return result.lastInsertRowid as number;
}

export function updateMatch(id: number, data: {
  game_id?: number;
  board_id?: number | null;
  date?: string | null;
  player_count?: number;
  notes?: string | null;
  instruction_version_id?: number | null;
}) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.game_id !== undefined) { fields.push("game_id = ?"); params.push(data.game_id); }
  if (data.board_id !== undefined) { fields.push("board_id = ?"); params.push(data.board_id); }
  if (data.date !== undefined) { fields.push("date = ?"); params.push(data.date); }
  if (data.player_count !== undefined) { fields.push("player_count = ?"); params.push(data.player_count); }
  if (data.notes !== undefined) { fields.push("notes = ?"); params.push(data.notes); }
  if (data.instruction_version_id !== undefined) { fields.push("instruction_version_id = ?"); params.push(data.instruction_version_id); }
  if (!fields.length) return;
  params.push(id);
  db.prepare(`UPDATE matches SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteMatch(id: number) {
  db.prepare("DELETE FROM matches WHERE id = ?").run(id);
}

// ── Match Result Queries ──────────────────────────────────────────────────────

export function getMatchResults(matchId: number) {
  return db.prepare(`
    SELECT mr.*, p.name as player_name
    FROM match_results mr
    JOIN players p ON p.id = mr.player_id
    WHERE mr.match_id = ?
    ORDER BY mr.position
  `).all(matchId) as {
    id: number; match_id: number; player_id: number; player_name: string; position: number;
  }[];
}

export function setMatchResults(matchId: number, results: { player_id: number; position: number }[]) {
  const del = db.prepare("DELETE FROM match_results WHERE match_id = ?");
  const ins = db.prepare("INSERT INTO match_results (match_id, player_id, position) VALUES (?, ?, ?)");
  const tx = db.transaction(() => {
    del.run(matchId);
    for (const r of results) {
      ins.run(matchId, r.player_id, r.position);
    }
  });
  tx();
}

// ── Analytics Queries ─────────────────────────────────────────────────────────

export function getAverageRankByGame() {
  return db.prepare(`
    SELECT g.id as game_id, g.name as game_name, p.id as player_id, p.name as player_name,
           COUNT(*) as match_count,
           ROUND(AVG(CAST(mr.position AS REAL)), 3) as avg_position
    FROM match_results mr
    JOIN matches m ON m.id = mr.match_id
    JOIN games g ON g.id = m.game_id
    JOIN players p ON p.id = mr.player_id
    GROUP BY g.id, p.id
    ORDER BY g.name, avg_position
  `).all() as {
    game_id: number; game_name: string; player_id: number; player_name: string;
    match_count: number; avg_position: number;
  }[];
}

export function getWinOddsByGame() {
  // Win odds = percentage of matches where position was <= median position
  // Simplified: fraction of matches where player finished in top half
  return db.prepare(`
    SELECT g.id as game_id, g.name as game_name, p.id as player_id, p.name as player_name,
           COUNT(*) as match_count,
           ROUND(
             CAST(SUM(CASE WHEN mr.position <= (m.player_count / 2.0) THEN 1 ELSE 0 END) AS REAL) /
             COUNT(*), 4
           ) as win_odds
    FROM match_results mr
    JOIN matches m ON m.id = mr.match_id
    JOIN games g ON g.id = m.game_id
    JOIN players p ON p.id = mr.player_id
    GROUP BY g.id, p.id
    HAVING COUNT(*) >= 3
    ORDER BY g.name, win_odds DESC
  `).all() as {
    game_id: number; game_name: string; player_id: number; player_name: string;
    match_count: number; win_odds: number;
  }[];
}

export function getHeadToHead(player1Id: number, player2Id: number) {
  return db.prepare(`
    SELECT m.id as match_id, m.date, g.name as game_name,
           mr1.position as player1_position, mr2.position as player2_position
    FROM matches m
    JOIN games g ON g.id = m.game_id
    JOIN match_results mr1 ON mr1.match_id = m.id AND mr1.player_id = ?
    JOIN match_results mr2 ON mr2.match_id = m.id AND mr2.player_id = ?
    ORDER BY m.date DESC, m.id DESC
  `).all(player1Id, player2Id) as {
    match_id: number; date: string | null; game_name: string;
    player1_position: number; player2_position: number;
  }[];
}

export function getMonopolyTournament() {
  // Get all monopoly matches with results for Jeffrey, Robert, Bobby
  return db.prepare(`
    SELECT m.id, m.date,
           MAX(CASE WHEN p.name = 'Jeffrey' THEN mr.position END) as jeffrey_pos,
           MAX(CASE WHEN p.name = 'Robert' THEN mr.position END) as robert_pos,
           MAX(CASE WHEN p.name = 'Bobby' THEN mr.position END) as bobby_pos
    FROM matches m
    JOIN games g ON g.id = m.game_id
    JOIN match_results mr ON mr.match_id = m.id
    JOIN players p ON p.id = mr.player_id
    WHERE g.name = 'Monopoly'
      AND p.name IN ('Jeffrey', 'Robert', 'Bobby')
    GROUP BY m.id
    HAVING COUNT(DISTINCT CASE WHEN p.name IN ('Jeffrey', 'Robert', 'Bobby') THEN p.id END) = 3
    ORDER BY m.date ASC, m.id ASC
  `).all() as {
    id: number; date: string | null;
    jeffrey_pos: number; robert_pos: number; bobby_pos: number;
  }[];
}

export function getOverallTrend(playerId: number) {
  return db.prepare(`
    SELECT m.date, g.name as game_name, mr.position, m.player_count
    FROM match_results mr
    JOIN matches m ON m.id = mr.match_id
    JOIN games g ON g.id = m.game_id
    WHERE mr.player_id = ?
    ORDER BY m.date ASC, m.id ASC
  `).all(playerId) as {
    date: string | null; game_name: string; position: number; player_count: number;
  }[];
}

export function getPlayerStats() {
  return db.prepare(`
    SELECT p.id as player_id, p.name as player_name,
           COUNT(*) as total_matches,
           SUM(CASE WHEN mr.position = 1 THEN 1 ELSE 0 END) as wins,
           ROUND(AVG(CAST(mr.position AS REAL)), 3) as overall_avg_position
    FROM match_results mr
    JOIN players p ON p.id = mr.player_id
    GROUP BY p.id
    ORDER BY overall_avg_position ASC
  `).all() as {
    player_id: number; player_name: string;
    total_matches: number; wins: number; overall_avg_position: number;
  }[];
}

export function getMatchCount() {
  return (db.prepare("SELECT COUNT(*) as count FROM matches").get() as { count: number }).count;
}

// ── Instruction Queries ───────────────────────────────────────────────────────

export function getInstructionVersionsByGame(gameId: number) {
  return db.prepare(`
    SELECT * FROM instruction_versions WHERE game_id = ? ORDER BY created_at DESC
  `).all(gameId) as {
    id: number; game_id: number; version_name: string; notes: string | null;
    created_at: number; created_by: string | null;
  }[];
}

export function getInstructionVersion(id: number) {
  return db.prepare("SELECT * FROM instruction_versions WHERE id = ?").get(id) as {
    id: number; game_id: number; version_name: string; notes: string | null;
    created_at: number; created_by: string | null;
  } | undefined;
}

export function createInstructionVersion(gameId: number, versionName: string, notes?: string, createdBy?: string) {
  const result = db.prepare(
    "INSERT INTO instruction_versions (game_id, version_name, notes, created_by) VALUES (?, ?, ?, ?)"
  ).run(gameId, versionName, notes ?? null, createdBy ?? null);
  return result.lastInsertRowid as number;
}

export function deleteInstructionVersion(id: number) {
  db.prepare("DELETE FROM instruction_versions WHERE id = ?").run(id);
}

export function getInstructionSections(versionId: number) {
  return db.prepare(`
    SELECT * FROM instruction_sections WHERE version_id = ? ORDER BY section_number
  `).all(versionId) as {
    id: number; version_id: number; section_number: number; title: string;
  }[];
}

export function createInstructionSection(versionId: number, sectionNumber: number, title: string) {
  const result = db.prepare(
    "INSERT INTO instruction_sections (version_id, section_number, title) VALUES (?, ?, ?)"
  ).run(versionId, sectionNumber, title);
  return result.lastInsertRowid as number;
}

export function updateInstructionSection(id: number, data: { section_number?: number; title?: string }) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.section_number !== undefined) { fields.push("section_number = ?"); params.push(data.section_number); }
  if (data.title !== undefined) { fields.push("title = ?"); params.push(data.title); }
  if (!fields.length) return;
  params.push(id);
  db.prepare(`UPDATE instruction_sections SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteInstructionSection(id: number) {
  db.prepare("DELETE FROM instruction_sections WHERE id = ?").run(id);
}

export function getInstructionLines(sectionId: number) {
  return db.prepare(`
    SELECT * FROM instruction_lines WHERE section_id = ? ORDER BY line_number
  `).all(sectionId) as {
    id: number; section_id: number; line_number: number; content: string;
  }[];
}

export function setInstructionLines(sectionId: number, lines: { line_number: number; content: string }[]) {
  const del = db.prepare("DELETE FROM instruction_lines WHERE section_id = ?");
  const ins = db.prepare("INSERT INTO instruction_lines (section_id, line_number, content) VALUES (?, ?, ?)");
  const tx = db.transaction(() => {
    del.run(sectionId);
    for (const l of lines) {
      ins.run(sectionId, l.line_number, l.content);
    }
  });
  tx();
}

export function getFullInstructions(versionId: number) {
  const version = getInstructionVersion(versionId);
  if (!version) return null;
  const sections = getInstructionSections(versionId).map(s => ({
    ...s,
    lines: getInstructionLines(s.id),
  }));
  return { ...version, sections };
}

// ── User Queries ──────────────────────────────────────────────────────────────

export function getUserByUsername(username: string) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as {
    id: number; username: string; password_hash: string | null;
    is_admin: number; is_approved: number; created_at: number;
  } | undefined;
}

export function getAllUsers() {
  return db.prepare("SELECT id, username, is_admin, is_approved, created_at FROM users ORDER BY created_at").all() as {
    id: number; username: string; is_admin: number; is_approved: number; created_at: number;
  }[];
}

export function createUser(username: string, passwordHash: string, isAdmin: boolean = false) {
  const result = db.prepare(
    "INSERT INTO users (username, password_hash, is_admin, is_approved) VALUES (?, ?, ?, ?)"
  ).run(username, passwordHash, isAdmin ? 1 : 0, isAdmin ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function setUserPassword(username: string, hash: string) {
  db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hash, username);
}

export function approveUser(id: number) {
  db.prepare("UPDATE users SET is_approved = 1 WHERE id = ?").run(id);
}

export function deleteUser(id: number) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function getAppConfig(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setAppConfig(key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run(key, value);
}

export function hasAnyUsers(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count > 0;
}
