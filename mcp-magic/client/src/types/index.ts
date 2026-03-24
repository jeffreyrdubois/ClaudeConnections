// ── Scryfall Card ──────────────────────────────────────────────────────────────

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

// ── Collection ─────────────────────────────────────────────────────────────────

export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

export interface CollectionCard extends ScryfallCard {
  id: number;
  scryfall_id: string;
  folder_id: number | null;
  folder_name: string | null;
  quantity: number;
  foil: boolean;
  condition: Condition;
  language: string;
  notes: string | null;
  purchase_price: number | null;
  added_at: number;
}

export interface Folder {
  id: number;
  name: string;
  description: string | null;
  created_at: number;
  card_count: number;
}

// ── Decks ──────────────────────────────────────────────────────────────────────

export interface DeckSummary {
  id: number;
  name: string;
  format: string;
  commander_scryfall_id: string | null;
  partner_scryfall_id: string | null;
  commander_name: string | null;
  commander_image: string | null;
  commander_colors: string[] | null;
  partner_name: string | null;
  partner_image: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
  card_count: number;
}

export interface DeckCard {
  id: number;
  deck_id: number;
  scryfall_id: string;
  quantity: number;
  is_commander: boolean;
  category: string | null;
  card: ScryfallCard;
}

export interface DeckDetail extends DeckSummary {
  cards: DeckCard[];
}

export interface DeckStats {
  deck_id: number;
  card_count: number;
  land_count: number;
  mana_producer_count: number;
  mana_curve: Record<number, number>;
  color_distribution: Record<string, number>;
  type_breakdown: Record<string, number>;
  total_value: number;
  legality: LegalityResult;
}

export interface LegalityResult {
  legal: boolean;
  issues: string[];
  card_count: number;
  commander_name: string | null;
}

// ── Statistics ─────────────────────────────────────────────────────────────────

export interface CollectionStats {
  total_value: number;
  totals: {
    unique_entries: number;
    total_quantity: number;
    unique_cards: number;
  };
  byColor: Array<{ color_identity: string[]; count: number }>;
  byType: Array<{ type_line: string; count: number }>;
  byCmc: Array<{ cmc: number; count: number }>;
  byRarity: Array<{ rarity: string; unique_cards: number; total_copies: number }>;
  topByValue: Array<{ name: string; prices: Record<string, string | null>; qty: number }>;
}

// ── Import ─────────────────────────────────────────────────────────────────────

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

// ── Search ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  cards: ScryfallCard[];
  total_cards: number;
  has_more: boolean;
  source: "cache" | "scryfall";
}

// ── Color helpers ──────────────────────────────────────────────────────────────

export const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

export const COLOR_CLASSES: Record<string, string> = {
  W: "bg-yellow-50 text-yellow-900 border border-yellow-200",
  U: "bg-blue-600 text-white",
  B: "bg-gray-900 text-white border border-gray-600",
  R: "bg-red-600 text-white",
  G: "bg-green-700 text-white",
  C: "bg-gray-500 text-white",
  X: "bg-gray-600 text-white",
};

export const RARITY_COLORS: Record<string, string> = {
  common: "text-gray-300",
  uncommon: "text-slate-300",
  rare: "text-yellow-400",
  mythic: "text-orange-400",
  special: "text-purple-400",
  bonus: "text-pink-400",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};
