import { getScryfallCardById, getScryfallCardByName, upsertScryfallCard, type ScryfallCard } from "../db/index.js";

const SCRYFALL_BASE = "https://api.scryfall.com";
const CACHE_TTL_SECONDS = 86400; // 24 hours for card data
const PRICE_TTL_SECONDS = 3600;  // 1 hour for price refreshes

// ── Rate Limiter ───────────────────────────────────────────────────────────────
// Scryfall requests a minimum 50-100ms delay between requests.

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100 - elapsed));
  }
  lastRequestTime = Date.now();
  const response = await fetch(url, {
    headers: { "User-Agent": "mcp-magic/1.0 (self-hosted MTG manager)" },
  });
  return response;
}

// ── Raw Scryfall → ScryfallCard mapper ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapScryfallResponse(data: Record<string, any>): ScryfallCard {
  return {
    id: data.id,
    oracle_id: data.oracle_id ?? null,
    name: data.name,
    set_code: data.set,
    set_name: data.set_name ?? null,
    collector_number: data.collector_number ?? null,
    mana_cost: data.mana_cost ?? null,
    cmc: data.cmc ?? 0,
    type_line: data.type_line ?? null,
    oracle_text: data.oracle_text ?? null,
    colors: data.colors ?? [],
    color_identity: data.color_identity ?? [],
    keywords: data.keywords ?? [],
    legalities: data.legalities ?? {},
    prices: data.prices ?? {},
    image_uris: data.image_uris ?? null,
    card_faces: data.card_faces ?? null,
    power: data.power ?? null,
    toughness: data.toughness ?? null,
    loyalty: data.loyalty ?? null,
    produced_mana: data.produced_mana ?? null,
    rarity: data.rarity ?? null,
    artist: data.artist ?? null,
    layout: data.layout ?? null,
  };
}

// ── Search Scryfall ────────────────────────────────────────────────────────────

export interface SearchOptions {
  unique?: "cards" | "art" | "prints";
  order?: "name" | "cmc" | "price" | "released";
  dir?: "asc" | "desc";
  page?: number;
}

export interface SearchResult {
  cards: ScryfallCard[];
  total_cards: number;
  has_more: boolean;
}

export async function searchScryfall(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query });
  if (options.unique) params.set("unique", options.unique);
  if (options.order) params.set("order", options.order);
  if (options.dir) params.set("dir", options.dir);
  if (options.page) params.set("page", String(options.page));

  const response = await rateLimitedFetch(`${SCRYFALL_BASE}/cards/search?${params}`);

  if (response.status === 404) return { cards: [], total_cards: 0, has_more: false };
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { details?: string }).details || `Scryfall search failed: ${response.status}`);
  }

  const data = await response.json() as {
    data: Record<string, unknown>[];
    total_cards: number;
    has_more: boolean;
  };
  const cards = data.data.map((c) => mapScryfallResponse(c as Record<string, unknown>));

  // Cache results
  for (const card of cards) {
    upsertScryfallCard(card);
  }

  return { cards, total_cards: data.total_cards, has_more: data.has_more };
}

// ── Get Card By Name ───────────────────────────────────────────────────────────

export async function getCardByName(name: string, set?: string): Promise<ScryfallCard | null> {
  // Check cache first
  const cached = getScryfallCardByName(name);
  if (cached) {
    const age = Math.floor(Date.now() / 1000) - (cached as unknown as { last_updated: number }).last_updated;
    if (age < CACHE_TTL_SECONDS) return cached;
  }

  const params = new URLSearchParams({ fuzzy: name });
  if (set) params.set("set", set);

  const response = await rateLimitedFetch(`${SCRYFALL_BASE}/cards/named?${params}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { details?: string }).details || `Scryfall lookup failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const card = mapScryfallResponse(data);
  upsertScryfallCard(card);
  return card;
}

// ── Get Card By ID ─────────────────────────────────────────────────────────────

export async function getCardById(id: string, forceRefresh = false): Promise<ScryfallCard | null> {
  if (!forceRefresh) {
    const cached = getScryfallCardById(id);
    if (cached) {
      const age = Math.floor(Date.now() / 1000) - (cached as unknown as { last_updated: number }).last_updated;
      if (age < PRICE_TTL_SECONDS) return cached;
    }
  }

  const response = await rateLimitedFetch(`${SCRYFALL_BASE}/cards/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Scryfall card fetch failed: ${response.status}`);

  const data = await response.json() as Record<string, unknown>;
  const card = mapScryfallResponse(data);
  upsertScryfallCard(card);
  return card;
}

// ── Get Card Image URL ─────────────────────────────────────────────────────────

export function getCardImageUrl(card: ScryfallCard, size: "small" | "normal" | "large" = "normal"): string | null {
  if (card.image_uris) return card.image_uris[size] || card.image_uris.normal || null;
  if (card.card_faces && card.card_faces[0]) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    if (face.image_uris) return face.image_uris[size] || face.image_uris.normal || null;
  }
  return null;
}

// ── Get Current Price ──────────────────────────────────────────────────────────

export function getCardPrice(card: ScryfallCard, foil = false): number {
  if (foil) {
    return parseFloat(card.prices?.usd_foil || card.prices?.usd || "0") || 0;
  }
  return parseFloat(card.prices?.usd || "0") || 0;
}

// ── Batch Fetch ────────────────────────────────────────────────────────────────

export async function fetchCardsCollection(
  identifiers: Array<{ name: string; set?: string }>
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const toFetch: typeof identifiers = [];

  for (const ident of identifiers) {
    const cached = getScryfallCardByName(ident.name);
    if (cached) {
      result.set(ident.name.toLowerCase(), cached);
    } else {
      toFetch.push(ident);
    }
  }

  // Scryfall collection endpoint supports up to 75 identifiers per request
  const chunks = [];
  for (let i = 0; i < toFetch.length; i += 75) {
    chunks.push(toFetch.slice(i, i + 75));
  }

  for (const chunk of chunks) {
    const response = await rateLimitedFetch(`${SCRYFALL_BASE}/cards/collection`);
    const body = JSON.stringify({ identifiers: chunk.map((i) => ({ name: i.name, set: i.set })) });

    const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "mcp-magic/1.0 (self-hosted MTG manager)",
      },
      body,
    });

    if (!res.ok) continue;

    const data = await res.json() as { data: Record<string, unknown>[] };
    for (const rawCard of data.data) {
      const card = mapScryfallResponse(rawCard);
      upsertScryfallCard(card);
      result.set(card.name.toLowerCase(), card);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return result;
}
