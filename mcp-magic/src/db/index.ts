import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "magic.db");

// ── Database Init ──────────────────────────────────────────────────────────────

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Cached Scryfall card data
  CREATE TABLE IF NOT EXISTS scryfall_cards (
    id TEXT PRIMARY KEY,
    oracle_id TEXT,
    name TEXT NOT NULL,
    set_code TEXT NOT NULL,
    set_name TEXT,
    collector_number TEXT,
    mana_cost TEXT,
    cmc REAL DEFAULT 0,
    type_line TEXT,
    oracle_text TEXT,
    colors TEXT DEFAULT '[]',
    color_identity TEXT DEFAULT '[]',
    keywords TEXT DEFAULT '[]',
    legalities TEXT DEFAULT '{}',
    prices TEXT DEFAULT '{}',
    image_uris TEXT,
    card_faces TEXT,
    power TEXT,
    toughness TEXT,
    loyalty TEXT,
    produced_mana TEXT,
    rarity TEXT,
    artist TEXT,
    layout TEXT,
    last_updated INTEGER DEFAULT (unixepoch())
  );

  -- Collection folders
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Owned cards (one row per unique card+condition+foil combo)
  CREATE TABLE IF NOT EXISTS collection_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scryfall_id TEXT NOT NULL REFERENCES scryfall_cards(id),
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    foil INTEGER NOT NULL DEFAULT 0,
    condition TEXT NOT NULL DEFAULT 'NM' CHECK(condition IN ('NM','LP','MP','HP','DMG')),
    language TEXT NOT NULL DEFAULT 'en',
    notes TEXT,
    purchase_price REAL,
    added_at INTEGER DEFAULT (unixepoch())
  );

  -- Commander decks
  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'commander',
    commander_scryfall_id TEXT REFERENCES scryfall_cards(id),
    partner_scryfall_id TEXT REFERENCES scryfall_cards(id),
    description TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  -- Cards assigned to decks
  CREATE TABLE IF NOT EXISTS deck_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    scryfall_id TEXT NOT NULL REFERENCES scryfall_cards(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    is_commander INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    UNIQUE(deck_id, scryfall_id)
  );

  CREATE INDEX IF NOT EXISTS idx_collection_scryfall ON collection_cards(scryfall_id);
  CREATE INDEX IF NOT EXISTS idx_collection_folder ON collection_cards(folder_id);
  CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);
  CREATE INDEX IF NOT EXISTS idx_scryfall_name ON scryfall_cards(name);

  -- App users (Jeffrey and Abby)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Persistent key-value config (session secret, etc.)
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations — add new columns without breaking existing databases
try { db.exec("ALTER TABLE collection_cards ADD COLUMN owner TEXT"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE collection_cards ADD COLUMN legal TEXT NOT NULL DEFAULT 'Y'"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE decks ADD COLUMN owner TEXT"); } catch { /* already exists */ }
// Drop the over-restrictive unique index that prevented the same card from being in multiple decks.
// The correct constraint is UNIQUE(deck_id, scryfall_id) which already exists in the table DDL.
try { db.exec("DROP INDEX IF EXISTS idx_deck_cards_scryfall"); } catch { /* ignore */ }
try { db.exec("ALTER TABLE deck_cards ADD COLUMN foil INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE deck_cards ADD COLUMN collection_card_id INTEGER REFERENCES collection_cards(id)"); } catch { /* already exists */ }
// Seed default users
try { db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run("Jeffrey"); } catch { /* already exists */ }
try { db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run("Abby"); } catch { /* already exists */ }

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScryfallCard {
  id: string;
  oracle_id: string | null;
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string | null;
  mana_cost: string | null;
  cmc: number;
  type_line: string | null;
  oracle_text: string | null;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  legalities: Record<string, string>;
  prices: Record<string, string | null>;
  image_uris: Record<string, string> | null;
  card_faces: Array<Record<string, unknown>> | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  produced_mana: string[] | null;
  rarity: string | null;
  artist: string | null;
  layout: string | null;
}

export interface CollectionCard {
  id: number;
  scryfall_id: string;
  folder_id: number | null;
  quantity: number;
  foil: boolean;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  language: string;
  notes: string | null;
  purchase_price: number | null;
  added_at: number;
  owner: string | null;
  legal: string; // 'Y' | 'N'
}

export interface Folder {
  id: number;
  name: string;
  description: string | null;
  created_at: number;
}

export interface Deck {
  id: number;
  name: string;
  format: string;
  commander_scryfall_id: string | null;
  partner_scryfall_id: string | null;
  description: string | null;
  owner: string | null;
  created_at: number;
  updated_at: number;
}

export interface DeckCard {
  id: number;
  deck_id: number;
  scryfall_id: string;
  quantity: number;
  foil: boolean;
  collection_card_id: number | null;
  is_commander: boolean;
  category: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCard(row: Record<string, unknown>): ScryfallCard {
  return {
    ...row,
    colors: JSON.parse((row.colors as string) || "[]"),
    color_identity: JSON.parse((row.color_identity as string) || "[]"),
    keywords: JSON.parse((row.keywords as string) || "[]"),
    legalities: JSON.parse((row.legalities as string) || "{}"),
    prices: JSON.parse((row.prices as string) || "{}"),
    image_uris: row.image_uris ? JSON.parse(row.image_uris as string) : null,
    card_faces: row.card_faces ? JSON.parse(row.card_faces as string) : null,
    produced_mana: row.produced_mana ? JSON.parse(row.produced_mana as string) : null,
  } as ScryfallCard;
}

function boolify(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, foil: Boolean(row.foil), is_commander: Boolean(row.is_commander) };
}

// ── Scryfall Cache ─────────────────────────────────────────────────────────────

const insertCard = db.prepare(`
  INSERT OR REPLACE INTO scryfall_cards
    (id, oracle_id, name, set_code, set_name, collector_number, mana_cost, cmc,
     type_line, oracle_text, colors, color_identity, keywords, legalities, prices,
     image_uris, card_faces, power, toughness, loyalty, produced_mana, rarity, artist,
     layout, last_updated)
  VALUES
    (@id, @oracle_id, @name, @set_code, @set_name, @collector_number, @mana_cost, @cmc,
     @type_line, @oracle_text, @colors, @color_identity, @keywords, @legalities, @prices,
     @image_uris, @card_faces, @power, @toughness, @loyalty, @produced_mana, @rarity, @artist,
     @layout, unixepoch())
`);

export function upsertScryfallCard(card: ScryfallCard): void {
  insertCard.run({
    ...card,
    colors: JSON.stringify(card.colors),
    color_identity: JSON.stringify(card.color_identity),
    keywords: JSON.stringify(card.keywords),
    legalities: JSON.stringify(card.legalities),
    prices: JSON.stringify(card.prices),
    image_uris: card.image_uris ? JSON.stringify(card.image_uris) : null,
    card_faces: card.card_faces ? JSON.stringify(card.card_faces) : null,
    produced_mana: card.produced_mana ? JSON.stringify(card.produced_mana) : null,
  });
}

export function getScryfallCardById(id: string): ScryfallCard | null {
  const row = db.prepare("SELECT * FROM scryfall_cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? parseCard(row) : null;
}

export function getScryfallCardByName(name: string): ScryfallCard | null {
  const row = db.prepare("SELECT * FROM scryfall_cards WHERE LOWER(name) = LOWER(?) LIMIT 1").get(name) as Record<string, unknown> | undefined;
  return row ? parseCard(row) : null;
}

export function searchScryfallCache(query: string, limit = 20): ScryfallCard[] {
  const rows = db.prepare(
    "SELECT * FROM scryfall_cards WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT ?"
  ).all(`%${query}%`, limit) as Record<string, unknown>[];
  return rows.map(parseCard);
}

// ── Folders ────────────────────────────────────────────────────────────────────

export function getFolders(): Array<Folder & { card_count: number }> {
  return db.prepare(`
    SELECT f.*, COUNT(cc.id) as card_count
    FROM folders f
    LEFT JOIN collection_cards cc ON cc.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.name
  `).all() as Array<Folder & { card_count: number }>;
}

export function getFolderById(id: number): Folder | null {
  return db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as Folder | null;
}

export function createFolder(name: string, description?: string): Folder {
  const result = db.prepare(
    "INSERT INTO folders (name, description) VALUES (?, ?) RETURNING *"
  ).get(name, description ?? null) as Folder;
  return result;
}

export function updateFolder(id: number, name?: string, description?: string): Folder | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) { fields.push("name = ?"); values.push(name); }
  if (description !== undefined) { fields.push("description = ?"); values.push(description); }
  if (!fields.length) return getFolderById(id);
  values.push(id);
  return db.prepare(`UPDATE folders SET ${fields.join(", ")} WHERE id = ? RETURNING *`).get(...values) as Folder | null;
}

export function deleteFolder(id: number): void {
  db.prepare("UPDATE collection_cards SET folder_id = NULL WHERE folder_id = ?").run(id);
  db.prepare("DELETE FROM folders WHERE id = ?").run(id);
}

// ── Collection ─────────────────────────────────────────────────────────────────

export interface CollectionRow extends CollectionCard {
  // Joined scryfall fields
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string | null;
  mana_cost: string | null;
  cmc: number;
  type_line: string | null;
  colors: string[];
  color_identity: string[];
  prices: Record<string, string | null>;
  image_uris: Record<string, string> | null;
  card_faces: Array<Record<string, unknown>> | null;
  rarity: string | null;
  folder_name: string | null;
  legalities: Record<string, string>;
  produced_mana: string[] | null;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  deck_id: number | null;
  deck_name: string | null;
  assigned_qty: number;
}

const COLLECTION_SELECT = `
  SELECT
    cc.*,
    sc.name, sc.set_code, sc.set_name, sc.collector_number,
    sc.mana_cost, sc.cmc, sc.type_line, sc.oracle_text,
    sc.colors, sc.color_identity, sc.prices, sc.image_uris,
    sc.card_faces, sc.rarity, sc.legalities, sc.produced_mana,
    sc.power, sc.toughness, sc.loyalty,
    f.name as folder_name,
    (SELECT dkc2.deck_id FROM deck_cards dkc2 WHERE dkc2.collection_card_id = cc.id OR (dkc2.collection_card_id IS NULL AND dkc2.scryfall_id = cc.scryfall_id AND dkc2.foil = cc.foil) LIMIT 1) as deck_id,
    (SELECT GROUP_CONCAT(dk2.name, ' / ') FROM deck_cards dkc2 JOIN decks dk2 ON dk2.id = dkc2.deck_id WHERE dkc2.collection_card_id = cc.id OR (dkc2.collection_card_id IS NULL AND dkc2.scryfall_id = cc.scryfall_id AND dkc2.foil = cc.foil)) as deck_name,
    (SELECT COALESCE(SUM(dkc2.quantity), 0) FROM deck_cards dkc2 WHERE dkc2.collection_card_id = cc.id OR (dkc2.collection_card_id IS NULL AND dkc2.scryfall_id = cc.scryfall_id AND dkc2.foil = cc.foil)) as assigned_qty
  FROM collection_cards cc
  JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
  LEFT JOIN folders f ON f.id = cc.folder_id
`;

function parseCollectionRow(row: Record<string, unknown>): CollectionRow {
  return {
    ...row,
    foil: Boolean(row.foil),
    colors: JSON.parse((row.colors as string) || "[]"),
    color_identity: JSON.parse((row.color_identity as string) || "[]"),
    prices: JSON.parse((row.prices as string) || "{}"),
    image_uris: row.image_uris ? JSON.parse(row.image_uris as string) : null,
    card_faces: row.card_faces ? JSON.parse(row.card_faces as string) : null,
    legalities: JSON.parse((row.legalities as string) || "{}"),
    produced_mana: row.produced_mana ? JSON.parse(row.produced_mana as string) : null,
  } as CollectionRow;
}

export interface CollectionFilter {
  folder_id?: number | null;
  search?: string;
  colors?: string[];
  type?: string;
  foil?: boolean;
  condition?: string;
  owner?: string;
  legal?: string;
  set_code?: string;
  deck_id?: number | "none";
  rarity?: string;
}

export function getCollection(filter: CollectionFilter = {}): CollectionRow[] {
  let sql = COLLECTION_SELECT + " WHERE 1=1";
  const params: unknown[] = [];

  if (filter.folder_id !== undefined) {
    sql += filter.folder_id === null ? " AND cc.folder_id IS NULL" : " AND cc.folder_id = ?";
    if (filter.folder_id !== null) params.push(filter.folder_id);
  }
  if (filter.search) {
    sql += " AND LOWER(sc.name) LIKE LOWER(?)";
    params.push(`%${filter.search}%`);
  }
  if (filter.type) {
    sql += " AND LOWER(sc.type_line) LIKE LOWER(?)";
    params.push(`%${filter.type}%`);
  }
  if (filter.foil !== undefined) {
    sql += " AND cc.foil = ?";
    params.push(filter.foil ? 1 : 0);
  }
  if (filter.condition) {
    sql += " AND cc.condition = ?";
    params.push(filter.condition);
  }
  if (filter.owner) {
    sql += " AND cc.owner = ?";
    params.push(filter.owner);
  }
  if (filter.legal) {
    sql += " AND cc.legal = ?";
    params.push(filter.legal);
  }
  if (filter.set_code) {
    sql += " AND LOWER(sc.set_code) = LOWER(?)";
    params.push(filter.set_code);
  }
  if (filter.deck_id === "none") {
    sql += " AND NOT EXISTS (SELECT 1 FROM deck_cards dkf WHERE dkf.scryfall_id = cc.scryfall_id)";
  } else if (filter.deck_id !== undefined) {
    sql += " AND EXISTS (SELECT 1 FROM deck_cards dkf WHERE dkf.scryfall_id = cc.scryfall_id AND dkf.deck_id = ?)";
    params.push(filter.deck_id);
  }
  if (filter.rarity) {
    sql += " AND LOWER(sc.rarity) = LOWER(?)";
    params.push(filter.rarity);
  }
  sql += " ORDER BY sc.name";

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  let result = rows.map(parseCollectionRow);

  // Filter by color client-side (JSON array comparison)
  if (filter.colors && filter.colors.length > 0) {
    result = result.filter((r) =>
      filter.colors!.some((c) => r.color_identity.includes(c))
    );
  }

  // deck_cards tracks quantity by (scryfall_id, foil) — no link to specific collection entries.
  // Distribute the assigned_qty pool across entries with the same scryfall_id+foil (sorted by id)
  // so only the first N entries show a deck assignment, where N covers the assigned copies.
  const byScryfallFoil = new Map<string, CollectionRow[]>();
  for (const row of result) {
    const key = `${row.scryfall_id}:${row.foil ? 1 : 0}`;
    if (!byScryfallFoil.has(key)) byScryfallFoil.set(key, []);
    byScryfallFoil.get(key)!.push(row);
  }
  for (const entries of byScryfallFoil.values()) {
    if (entries.length <= 1) continue; // single entry: SQL value is already correct
    const totalAssigned = entries[0].assigned_qty; // same for all rows with same scryfall_id+foil
    let remaining = totalAssigned;
    for (const entry of entries) {
      if (remaining <= 0) {
        entry.deck_name = null;
        entry.deck_id = null;
        entry.assigned_qty = 0;
      } else {
        entry.assigned_qty = Math.min(entry.quantity, remaining);
        remaining -= entry.quantity;
      }
    }
  }

  return result;
}

export function getCollectionCardById(id: number): CollectionRow | null {
  const row = db.prepare(COLLECTION_SELECT + " WHERE cc.id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? parseCollectionRow(row) : null;
}

export function addCollectionCard(data: {
  scryfall_id: string;
  folder_id?: number | null;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  notes?: string;
  purchase_price?: number;
  owner?: string | null;
  legal?: string;
}): CollectionRow {
  const result = db.prepare(`
    INSERT INTO collection_cards (scryfall_id, folder_id, quantity, foil, condition, language, notes, purchase_price, owner, legal)
    VALUES (@scryfall_id, @folder_id, @quantity, @foil, @condition, @language, @notes, @purchase_price, @owner, @legal)
    RETURNING id
  `).get({
    scryfall_id: data.scryfall_id,
    folder_id: data.folder_id ?? null,
    quantity: data.quantity,
    foil: data.foil ? 1 : 0,
    condition: data.condition,
    language: data.language,
    notes: data.notes ?? null,
    purchase_price: data.purchase_price ?? null,
    owner: data.owner ?? null,
    legal: data.legal ?? "Y",
  }) as { id: number };
  return getCollectionCardById(result.id)!;
}

export function updateCollectionCard(id: number, data: Partial<{
  folder_id: number | null;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  notes: string;
  purchase_price: number;
  owner: string | null;
  legal: string;
}>): CollectionRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  if ("folder_id" in data) { fields.push("folder_id = ?"); values.push(data.folder_id ?? null); }
  if ("quantity" in data) { fields.push("quantity = ?"); values.push(data.quantity); }
  if ("foil" in data) { fields.push("foil = ?"); values.push(data.foil ? 1 : 0); }
  if ("condition" in data) { fields.push("condition = ?"); values.push(data.condition); }
  if ("language" in data) { fields.push("language = ?"); values.push(data.language); }
  if ("notes" in data) { fields.push("notes = ?"); values.push(data.notes); }
  if ("purchase_price" in data) { fields.push("purchase_price = ?"); values.push(data.purchase_price); }
  if ("owner" in data) { fields.push("owner = ?"); values.push(data.owner ?? null); }
  if ("legal" in data) { fields.push("legal = ?"); values.push(data.legal); }
  if (!fields.length) return getCollectionCardById(id);
  values.push(id);
  db.prepare(`UPDATE collection_cards SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCollectionCardById(id);
}

export function deleteCollectionCard(id: number): void {
  db.prepare("DELETE FROM collection_cards WHERE id = ?").run(id);
}

export interface StatsFilter {
  owner?: string;
  folder_id?: number | null;
  condition?: string;
  set_code?: string;
  type?: string;
  deck_id?: number;
}

function buildStatsWhere(filter: StatsFilter): { joins: string; where: string; params: unknown[] } {
  let joins = "";
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.deck_id !== undefined) {
    joins += " JOIN deck_cards dc_f ON dc_f.deck_id = ? AND dc_f.scryfall_id = cc.scryfall_id";
    params.push(filter.deck_id);
  }
  if (filter.owner) { conditions.push("cc.owner = ?"); params.push(filter.owner); }
  if (filter.folder_id !== undefined) {
    if (filter.folder_id === null) conditions.push("cc.folder_id IS NULL");
    else { conditions.push("cc.folder_id = ?"); params.push(filter.folder_id); }
  }
  if (filter.condition) { conditions.push("cc.condition = ?"); params.push(filter.condition); }
  if (filter.set_code) { conditions.push("LOWER(sc.set_code) = LOWER(?)"); params.push(filter.set_code); }
  if (filter.type) { conditions.push("LOWER(sc.type_line) LIKE LOWER(?)"); params.push(`%${filter.type}%`); }

  return {
    joins,
    where: conditions.length ? "WHERE " + conditions.join(" AND ") : "",
    params,
  };
}

export function getCollectionStats(filter: StatsFilter = {}) {
  const { joins, where, params } = buildStatsWhere(filter);

  const totals = db.prepare(`
    SELECT
      COUNT(*) as unique_entries,
      SUM(cc.quantity) as total_quantity,
      COUNT(DISTINCT cc.scryfall_id) as unique_cards
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
  `).get(...params) as { unique_entries: number; total_quantity: number; unique_cards: number };

  const byColor = db.prepare(`
    SELECT sc.color_identity, SUM(cc.quantity) as count
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
    GROUP BY sc.color_identity
  `).all(...params) as { color_identity: string; count: number }[];

  const byType = db.prepare(`
    SELECT sc.type_line, SUM(cc.quantity) as count
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
    GROUP BY sc.type_line
  `).all(...params) as { type_line: string; count: number }[];

  const byCmc = db.prepare(`
    SELECT sc.cmc, SUM(cc.quantity) as count
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
    GROUP BY sc.cmc
    ORDER BY sc.cmc
  `).all(...params) as { cmc: number; count: number }[];

  const byRarity = db.prepare(`
    SELECT sc.rarity, COUNT(DISTINCT cc.scryfall_id) as unique_cards, SUM(cc.quantity) as total_copies
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
    GROUP BY sc.rarity
  `).all(...params) as { rarity: string; unique_cards: number; total_copies: number }[];

  const topByValue = db.prepare(`
    SELECT sc.name, sc.prices, SUM(cc.quantity) as qty
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
    GROUP BY sc.name, sc.prices
    ORDER BY CAST(json_extract(sc.prices, '$.usd') AS REAL) DESC
    LIMIT 20
  `).all(...params) as { name: string; prices: string; qty: number }[];

  return {
    totals,
    byColor: byColor.map((r) => ({ ...r, color_identity: JSON.parse(r.color_identity || "[]") })),
    byType,
    byCmc,
    byRarity,
    topByValue: topByValue.map((r) => ({ ...r, prices: JSON.parse(r.prices || "{}") })),
  };
}

export function getTotalCollectionValue(filterOrFolderId?: number | null | StatsFilter): number {
  // Accept either legacy folderId or new StatsFilter
  let joins = "";
  let where = "";
  let params: unknown[] = [];

  if (filterOrFolderId !== null && typeof filterOrFolderId === "object") {
    const built = buildStatsWhere(filterOrFolderId);
    joins = built.joins;
    where = built.where;
    params = built.params;
  } else if (filterOrFolderId !== undefined) {
    const folderId = filterOrFolderId as number | null;
    if (folderId === null) where = "WHERE cc.folder_id IS NULL";
    else { where = "WHERE cc.folder_id = ?"; params = [folderId]; }
  }

  const sql = `
    SELECT SUM(
      CASE WHEN cc.foil = 1
        THEN COALESCE(CAST(json_extract(sc.prices, '$.usd_foil') AS REAL), CAST(json_extract(sc.prices, '$.usd') AS REAL), 0)
        ELSE COALESCE(CAST(json_extract(sc.prices, '$.usd') AS REAL), 0)
      END * cc.quantity
    ) as total
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    ${joins}
    ${where}
  `;
  const result = db.prepare(sql).get(...params) as { total: number | null };
  return result.total ?? 0;
}

// Returns collection cards that still have at least one copy not yet assigned to any deck.
// Foil and non-foil are tracked separately so only the specific printing that's fully
// assigned is hidden.
export function searchCollectionForDeck(query: string): CollectionRow[] {
  const assigned = db.prepare(
    "SELECT scryfall_id, foil, SUM(quantity) as total FROM deck_cards GROUP BY scryfall_id, foil"
  ).all() as { scryfall_id: string; foil: number; total: number }[];
  const assignedMap = new Map(assigned.map((r) => [`${r.scryfall_id}:${r.foil}`, r.total]));

  const cards = getCollection({ search: query });
  return cards.filter((c) => {
    const key = `${c.scryfall_id}:${c.foil ? 1 : 0}`;
    return c.quantity > (assignedMap.get(key) ?? 0);
  });
}

export function getCardQuantityInCollection(cardName: string): { total: number; entries: CollectionRow[] } {
  const entries = getCollection({ search: cardName }).filter(
    (r) => r.name.toLowerCase() === cardName.toLowerCase()
  );
  const total = entries.reduce((sum, e) => sum + e.quantity, 0);
  return { total, entries };
}

// ── Decks ──────────────────────────────────────────────────────────────────────

export interface DeckRow extends Deck {
  commander_name: string | null;
  commander_image: string | null;
  commander_colors: string[] | null;
  partner_name: string | null;
  partner_image: string | null;
  card_count: number;
}

export function getDecks(): DeckRow[] {
  const rows = db.prepare(`
    SELECT
      d.*,
      sc1.name as commander_name,
      sc1.image_uris as commander_image,
      sc1.color_identity as commander_colors,
      sc1.card_faces as commander_faces,
      sc2.name as partner_name,
      sc2.image_uris as partner_image,
      (SELECT SUM(quantity) FROM deck_cards WHERE deck_id = d.id) as card_count
    FROM decks d
    LEFT JOIN scryfall_cards sc1 ON sc1.id = d.commander_scryfall_id
    LEFT JOIN scryfall_cards sc2 ON sc2.id = d.partner_scryfall_id
    ORDER BY d.name
  `).all() as Record<string, unknown>[];

  return rows.map((r) => ({
    ...r,
    commander_image: resolveImage(r.commander_image as string | null, r.commander_faces as string | null),
    partner_image: resolveImage(r.partner_image as string | null, null),
    commander_colors: r.commander_colors ? JSON.parse(r.commander_colors as string) : null,
    card_count: (r.card_count as number) || 0,
  })) as DeckRow[];
}

function resolveImage(imageUris: string | null, cardFaces: string | null): string | null {
  if (imageUris) {
    const parsed = JSON.parse(imageUris);
    return parsed.normal || parsed.large || parsed.small || null;
  }
  if (cardFaces) {
    const faces = JSON.parse(cardFaces);
    if (faces[0]?.image_uris) {
      return faces[0].image_uris.normal || faces[0].image_uris.large || null;
    }
  }
  return null;
}

export interface DeckDetailRow extends DeckRow {
  cards: Array<DeckCard & { card: ScryfallCard }>;
}

export function getDeckById(id: number): DeckDetailRow | null {
  const deckRows = db.prepare(`
    SELECT
      d.*,
      sc1.name as commander_name,
      sc1.image_uris as commander_image,
      sc1.color_identity as commander_colors,
      sc1.card_faces as commander_faces,
      sc2.name as partner_name,
      sc2.image_uris as partner_image,
      (SELECT SUM(quantity) FROM deck_cards WHERE deck_id = d.id) as card_count
    FROM decks d
    LEFT JOIN scryfall_cards sc1 ON sc1.id = d.commander_scryfall_id
    LEFT JOIN scryfall_cards sc2 ON sc2.id = d.partner_scryfall_id
    WHERE d.id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!deckRows) return null;

  const cardRows = db.prepare(`
    SELECT dc.*, sc.*,
      dc.id as dc_id, dc.quantity as dc_quantity
    FROM deck_cards dc
    JOIN scryfall_cards sc ON sc.id = dc.scryfall_id
    WHERE dc.deck_id = ?
    ORDER BY dc.is_commander DESC, sc.cmc, sc.name
  `).all(id) as Record<string, unknown>[];

  const cards = cardRows.map((r) => ({
    id: r.dc_id as number,
    deck_id: id,
    scryfall_id: r.scryfall_id as string,
    quantity: r.dc_quantity as number,
    foil: Boolean(r.foil),
    collection_card_id: (r.collection_card_id as number | null) ?? null,
    is_commander: Boolean(r.is_commander),
    category: r.category as string | null,
    card: parseCard(r),
  }));

  return {
    ...deckRows,
    commander_image: resolveImage(deckRows.commander_image as string | null, deckRows.commander_faces as string | null),
    partner_image: resolveImage(deckRows.partner_image as string | null, null),
    commander_colors: deckRows.commander_colors ? JSON.parse(deckRows.commander_colors as string) : null,
    card_count: (deckRows.card_count as number) || 0,
    cards,
  } as DeckDetailRow;
}

export function createDeck(data: {
  name: string;
  commander_scryfall_id?: string;
  partner_scryfall_id?: string;
  description?: string;
  owner?: string;
}): Deck {
  return db.prepare(`
    INSERT INTO decks (name, commander_scryfall_id, partner_scryfall_id, description, owner)
    VALUES (@name, @commander_scryfall_id, @partner_scryfall_id, @description, @owner)
    RETURNING *
  `).get({
    name: data.name,
    commander_scryfall_id: data.commander_scryfall_id ?? null,
    partner_scryfall_id: data.partner_scryfall_id ?? null,
    description: data.description ?? null,
    owner: data.owner ?? null,
  }) as Deck;
}

export function updateDeck(id: number, data: Partial<{
  name: string;
  commander_scryfall_id: string | null;
  partner_scryfall_id: string | null;
  description: string;
  owner: string | null;
}>): Deck | null {
  const fields: string[] = ["updated_at = unixepoch()"];
  const values: unknown[] = [];
  if ("name" in data) { fields.push("name = ?"); values.push(data.name); }
  if ("commander_scryfall_id" in data) { fields.push("commander_scryfall_id = ?"); values.push(data.commander_scryfall_id ?? null); }
  if ("partner_scryfall_id" in data) { fields.push("partner_scryfall_id = ?"); values.push(data.partner_scryfall_id ?? null); }
  if ("description" in data) { fields.push("description = ?"); values.push(data.description); }
  if ("owner" in data) { fields.push("owner = ?"); values.push(data.owner ?? null); }
  values.push(id);
  db.prepare(`UPDATE decks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM decks WHERE id = ?").get(id) as Deck | null;
}

export function deleteDeck(id: number): void {
  db.prepare("DELETE FROM decks WHERE id = ?").run(id);
}

export function addCardToDeck(data: {
  deck_id: number;
  scryfall_id: string;
  quantity: number;
  foil?: boolean;
  collection_card_id?: number | null;
  is_commander: boolean;
  category?: string;
}): DeckCard {
  return db.prepare(`
    INSERT INTO deck_cards (deck_id, scryfall_id, quantity, foil, collection_card_id, is_commander, category)
    VALUES (@deck_id, @scryfall_id, @quantity, @foil, @collection_card_id, @is_commander, @category)
    ON CONFLICT(deck_id, scryfall_id) DO UPDATE SET
      quantity = excluded.quantity,
      foil = excluded.foil,
      collection_card_id = excluded.collection_card_id,
      is_commander = excluded.is_commander,
      category = excluded.category,
      id = id
    RETURNING *
  `).get({
    ...data,
    foil: data.foil ? 1 : 0,
    collection_card_id: data.collection_card_id ?? null,
    is_commander: data.is_commander ? 1 : 0,
    category: data.category ?? null,
  }) as DeckCard;
}

export function removeCardFromDeck(deck_id: number, scryfall_id: string): void {
  db.prepare("DELETE FROM deck_cards WHERE deck_id = ? AND scryfall_id = ?").run(deck_id, scryfall_id);
}

export function getDeckStats(id: number) {
  const deck = getDeckById(id);
  if (!deck) return null;

  const cards = deck.cards.filter((c) => !c.is_commander);

  const manaCurve: Record<number, number> = {};
  const colorCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const typeCounts: Record<string, number> = {};
  let totalValue = 0;
  let landCount = 0;
  let manaProducerCount = 0;

  for (const dc of deck.cards) {
    const c = dc.card;
    const qty = dc.quantity;

    // Mana curve (exclude lands)
    if (!c.type_line?.toLowerCase().includes("land")) {
      const bucket = Math.min(c.cmc, 7);
      manaCurve[bucket] = (manaCurve[bucket] || 0) + qty;
    } else {
      landCount += qty;
    }

    // Mana production
    if (c.produced_mana && c.produced_mana.length > 0) {
      manaProducerCount += qty;
    }

    // Colors
    for (const col of c.color_identity) {
      if (col in colorCounts) colorCounts[col] += qty;
    }
    if (c.color_identity.length === 0) colorCounts["C"] += qty;

    // Types
    const mainType = getMainType(c.type_line || "");
    typeCounts[mainType] = (typeCounts[mainType] || 0) + qty;

    // Value (foil not tracked at deck-card level; use non-foil price)
    const price = parseFloat(c.prices?.usd || "0");
    totalValue += price * qty;
  }

  // Commander legality check
  const legality = checkCommanderLegality(deck);

  return {
    deck_id: id,
    card_count: deck.cards.reduce((s, c) => s + c.quantity, 0),
    land_count: landCount,
    mana_producer_count: manaProducerCount,
    mana_curve: manaCurve,
    color_distribution: colorCounts,
    type_breakdown: typeCounts,
    total_value: totalValue,
    legality,
  };
}

function getMainType(typeLine: string): string {
  const types = ["Land", "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Battle"];
  for (const t of types) {
    if (typeLine.includes(t)) return t;
  }
  return "Other";
}

// ── Commander Legality ─────────────────────────────────────────────────────────

export interface LegalityResult {
  legal: boolean;
  issues: string[];
  card_count: number;
  commander_name: string | null;
}

export function checkCommanderLegality(deck: DeckDetailRow): LegalityResult {
  const issues: string[] = [];
  const commanders = deck.cards.filter((c) => c.is_commander);

  if (commanders.length === 0) {
    issues.push("No commander designated");
  } else if (commanders.length > 2) {
    issues.push("Too many commanders designated (max 2 with Partner)");
  } else if (commanders.length === 2) {
    // Both must have Partner or be a pair like "Partner with X"
    for (const cmd of commanders) {
      const hasPartner =
        cmd.card.keywords.includes("Partner") ||
        cmd.card.oracle_text?.includes("Partner with") ||
        cmd.card.oracle_text?.includes("Friends forever");
      if (!hasPartner) {
        issues.push(`${cmd.card.name} does not have Partner`);
      }
    }
  }

  // Color identity
  const commanderIdentity = new Set<string>();
  for (const cmd of commanders) {
    for (const c of cmd.card.color_identity) commanderIdentity.add(c);
  }

  // Basic lands that are always legal regardless of color identity
  const basicLandNames = new Set([
    "Plains", "Island", "Swamp", "Mountain", "Forest",
    "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
    "Snow-Covered Mountain", "Snow-Covered Forest", "Wastes",
  ]);

  const nonCommanderCards = deck.cards.filter((c) => !c.is_commander);
  const cardCount = nonCommanderCards.reduce((s, c) => s + c.quantity, 0) + commanders.reduce((s, c) => s + c.quantity, 0);

  if (cardCount !== 100) {
    issues.push(`Deck has ${cardCount} cards (must be exactly 100)`);
  }

  // Check for illegal cards
  for (const dc of nonCommanderCards) {
    const c = dc.card;

    // Format legality
    if (c.legalities?.commander === "banned") {
      issues.push(`${c.name} is banned in Commander`);
    } else if (c.legalities?.commander !== "legal") {
      issues.push(`${c.name} is not legal in Commander`);
    }

    // Color identity
    if (!basicLandNames.has(c.name)) {
      for (const col of c.color_identity) {
        if (!commanderIdentity.has(col)) {
          issues.push(`${c.name} has ${col} color identity, outside commander's identity`);
          break;
        }
      }
    }
  }

  // Duplicate check (only basics can have more than 1 copy)
  const nameCounts = new Map<string, number>();
  for (const dc of nonCommanderCards) {
    const existing = nameCounts.get(dc.card.name) || 0;
    nameCounts.set(dc.card.name, existing + dc.quantity);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1 && !basicLandNames.has(name)) {
      issues.push(`${name} appears ${count} times (duplicates not allowed)`);
    }
  }

  return {
    legal: issues.length === 0,
    issues,
    card_count: cardCount,
    commander_name: commanders[0]?.card.name ?? null,
  };
}

// ── Unassigned Cards ───────────────────────────────────────────────────────────

export function bulkUpdateCollectionCards(ids: number[], updates: {
  folder_id?: number | null;
  owner?: string | null;
  deck_id?: number;
}): { updated: number; deck_added: number; deck_skipped: number } {
  return db.transaction(() => {
    const fields: string[] = [];
    const values: unknown[] = [];
    if ("folder_id" in updates) { fields.push("folder_id = ?"); values.push(updates.folder_id ?? null); }
    if ("owner" in updates) { fields.push("owner = ?"); values.push(updates.owner ?? null); }

    let updated = 0;
    if (fields.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const result = db.prepare(`UPDATE collection_cards SET ${fields.join(", ")} WHERE id IN (${placeholders})`).run(...values, ...ids);
      updated = result.changes;
    }

    let deck_added = 0;
    let deck_skipped = 0;
    if (updates.deck_id !== undefined) {
      const deck_id = updates.deck_id;
      const placeholders = ids.map(() => "?").join(",");
      const cards = db.prepare(`SELECT scryfall_id FROM collection_cards WHERE id IN (${placeholders})`).all(...ids) as { scryfall_id: string }[];
      const insertStmt = db.prepare("INSERT OR IGNORE INTO deck_cards (deck_id, scryfall_id, quantity) VALUES (?, ?, 1)");
      for (const card of cards) {
        const existing = db.prepare("SELECT deck_id FROM deck_cards WHERE scryfall_id = ?").get(card.scryfall_id) as { deck_id: number } | undefined;
        if (existing) {
          deck_skipped++;
        } else {
          insertStmt.run(deck_id, card.scryfall_id);
          deck_added++;
        }
      }
    }

    return { updated, deck_added, deck_skipped };
  })();
}

// ── Users & Config ──────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  password_hash: string | null;
  created_at: number;
}

export function getUserByUsername(username: string): User | null {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as User | null;
}

export function setUserPassword(username: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(passwordHash, username);
}

export function getAppConfig(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppConfig(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run(key, value);
}

export function getOwnershipForNames(names: string[]): Map<string, { total: number; unassigned: number }> {
  if (names.length === 0) return new Map();
  const lower = names.map((n) => n.toLowerCase());
  const placeholders = lower.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT
      LOWER(sc.name) as card_name,
      SUM(cc.quantity) as total_quantity,
      SUM(CASE WHEN dkc.scryfall_id IS NULL THEN cc.quantity ELSE 0 END) as unassigned_quantity
    FROM collection_cards cc
    JOIN scryfall_cards sc ON sc.id = cc.scryfall_id
    LEFT JOIN deck_cards dkc ON dkc.scryfall_id = cc.scryfall_id
    WHERE LOWER(sc.name) IN (${placeholders})
    GROUP BY LOWER(sc.name)
  `).all(...lower) as { card_name: string; total_quantity: number; unassigned_quantity: number }[];
  return new Map(rows.map((r) => [r.card_name, { total: r.total_quantity, unassigned: r.unassigned_quantity }]));
}

export function getUnassignedCards(colorIdentity?: string[]): CollectionRow[] {
  const assignedIds = db.prepare(
    "SELECT DISTINCT scryfall_id FROM deck_cards"
  ).all() as { scryfall_id: string }[];
  const assignedSet = new Set(assignedIds.map((r) => r.scryfall_id));

  let cards = getCollection({});
  cards = cards.filter((c) => !assignedSet.has(c.scryfall_id));

  if (colorIdentity && colorIdentity.length > 0) {
    cards = cards.filter((c) =>
      c.color_identity.every((col) => colorIdentity.includes(col))
    );
  }

  return cards;
}
