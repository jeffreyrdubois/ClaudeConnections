/**
 * Import Excel data into the SQLite database.
 * Run: npm run import
 *
 * This reads "Board Games.xlsx" and imports all 608 matches,
 * creating players, games, boards, and match results.
 */

import ExcelJS from "exceljs";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "boardgames.db");
const XLSX_PATH = path.join(__dirname, "../Board Games.xlsx");

// Player columns (E through W = indices 4-22)
const PLAYER_COLUMNS: { col: number; name: string }[] = [
  { col: 5, name: "Jeffrey" },
  { col: 6, name: "Robert" },
  { col: 7, name: "Bobby" },
  { col: 8, name: "Stephen" },
  { col: 9, name: "Cory" },
  { col: 10, name: "Chelsea" },
  { col: 11, name: "Robin" },
  { col: 12, name: "Marcus" },
  { col: 13, name: "Spencer" },
  { col: 14, name: "Syvaunti" },
  { col: 15, name: "Rob Elrod" },
  { col: 16, name: "Cayla" },
  { col: 17, name: "Ethan" },
  { col: 18, name: "Ruth" },
  { col: 19, name: "Katie Zackarias" },
  { col: 20, name: "John Zackarias" },
  { col: 21, name: "Danielle" },
  { col: 22, name: "Abby" },
  { col: 23, name: "Georgia" },
];

async function main() {
  console.log("Opening database:", DB_PATH);
  console.log("Reading Excel:", XLSX_PATH);

  // Ensure data directory exists
  const fs = await import("fs");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create tables (same schema as the app)
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(game_id, name)
    );
    CREATE TABLE IF NOT EXISTS instruction_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version_name TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      created_by TEXT,
      UNIQUE(game_id, version_name)
    );
    CREATE TABLE IF NOT EXISTS instruction_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES instruction_versions(id) ON DELETE CASCADE,
      section_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      UNIQUE(version_id, section_number)
    );
    CREATE TABLE IF NOT EXISTS instruction_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES instruction_sections(id) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      UNIQUE(section_id, line_number)
    );
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
    CREATE TABLE IF NOT EXISTS match_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      UNIQUE(match_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_game ON matches(game_id);
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results(match_id);
    CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
    CREATE INDEX IF NOT EXISTS idx_boards_game ON boards(game_id);
  `);

  // Read Excel
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_PATH);
  const dataSheet = workbook.getWorksheet("Data");

  if (!dataSheet) {
    console.error("Could not find 'Data' sheet");
    process.exit(1);
  }

  // Prepare statements
  const insertPlayer = db.prepare("INSERT OR IGNORE INTO players (name) VALUES (?)");
  const insertGame = db.prepare("INSERT OR IGNORE INTO games (name) VALUES (?)");
  const insertBoard = db.prepare("INSERT OR IGNORE INTO boards (game_id, name) VALUES (?, ?)");
  const getGameId = db.prepare("SELECT id FROM games WHERE name = ?");
  const getPlayerId = db.prepare("SELECT id FROM players WHERE name = ?");
  const getBoardId = db.prepare("SELECT id FROM boards WHERE game_id = ? AND name = ?");
  const insertMatch = db.prepare(
    "INSERT INTO matches (game_id, board_id, date, player_count) VALUES (?, ?, ?, ?)"
  );
  const insertResult = db.prepare(
    "INSERT INTO match_results (match_id, player_id, position) VALUES (?, ?, ?)"
  );

  // Collect unique names and games first
  const allGames = new Set<string>();
  const allPlayers = new Set<string>();
  const allBoards = new Map<string, Set<string>>(); // game -> boards

  let matchCount = 0;
  let skipped = 0;

  // Helper to coerce ExcelJS cell values
  function cellStr(cell: ExcelJS.Cell): string | null {
    const v = cell.value;
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "object" && "richText" in (v as Record<string, unknown>)) {
      return ((v as { richText: { text: string }[] }).richText).map(r => r.text).join("");
    }
    return String(v);
  }

  function cellNum(cell: ExcelJS.Cell): number | null {
    const v = cell.value;
    if (typeof v === "number") return v;
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  const importTx = db.transaction(() => {
    dataSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header

      const gameName = cellStr(row.getCell(1));
      if (!gameName) return;

      const normalizedGame = gameName.trim();

      // Board (column B)
      const boardName = cellStr(row.getCell(2))?.trim() || null;

      // Date (column C)
      const dateRaw = row.getCell(3).value;
      let dateStr: string | null = null;
      if (dateRaw instanceof Date) {
        dateStr = dateRaw.toISOString().split("T")[0];
      } else if (typeof dateRaw === "string" && dateRaw !== "Unknown") {
        dateStr = dateRaw;
      }

      // Collect player results first, then derive player count
      const results: { name: string; position: number }[] = [];
      for (const pc of PLAYER_COLUMNS) {
        const val = cellNum(row.getCell(pc.col));
        if (val !== null) {
          results.push({ name: pc.name, position: val });
          allPlayers.add(pc.name);
        }
      }

      // Player count: use column D if available, otherwise count results
      const playerCountCell = cellNum(row.getCell(4));
      const playerCount = playerCountCell ?? results.length;

      if (results.length === 0) return;

      allGames.add(normalizedGame);
      if (boardName) {
        if (!allBoards.has(normalizedGame)) allBoards.set(normalizedGame, new Set());
        allBoards.get(normalizedGame)!.add(boardName);
      }

      // Insert game
      insertGame.run(normalizedGame);
      const gameRow = getGameId.get(normalizedGame) as { id: number };

      // Insert board
      let boardId: number | null = null;
      if (boardName) {
        insertBoard.run(gameRow.id, boardName);
        const boardRow = getBoardId.get(gameRow.id, boardName) as { id: number };
        boardId = boardRow.id;
      }

      // Insert players
      for (const r of results) {
        insertPlayer.run(r.name);
      }

      // Insert match
      const matchResult = insertMatch.run(gameRow.id, boardId, dateStr, playerCount);
      const matchId = matchResult.lastInsertRowid as number;

      // Insert results
      for (const r of results) {
        const playerRow = getPlayerId.get(r.name) as { id: number };
        insertResult.run(matchId, playerRow.id, r.position);
      }

      matchCount++;
    });
  });

  importTx();

  console.log(`\nImport complete!`);
  console.log(`  Matches imported: ${matchCount}`);
  console.log(`  Rows skipped: ${skipped}`);
  console.log(`  Unique games: ${allGames.size}`);
  console.log(`  Unique players: ${allPlayers.size}`);
  console.log(`  Games with boards: ${allBoards.size}`);

  // Print summary
  console.log(`\nGames: ${[...allGames].sort().join(", ")}`);
  console.log(`Players: ${[...allPlayers].sort().join(", ")}`);
  for (const [game, boards] of allBoards) {
    console.log(`  ${game} boards: ${[...boards].join(", ")}`);
  }

  db.close();
}

main().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
