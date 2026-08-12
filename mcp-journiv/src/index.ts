import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { rawRequest as rawRequestBase, type RawResponse } from "./httpclient.js";
import {
  asList,
  isVisible as isVisibleTag,
  tagNames,
  textToDelta,
  deltaToText,
  appendTextToDelta,
} from "./visibility.js";

// ── Config ────────────────────────────────────────────────────────────────────
// Config is read from env vars first, then persisted to /config/config.json so
// that settings survive container recreation (e.g. Unraid auto-updates).

const CONFIG_DIR = process.env.CONFIG_DIR || "/config";
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface SavedConfig {
  journivUrl?: string;
  journivUser?: string;
  journivPass?: string;
  requiredTag?: string;
  hostHeader?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

function loadConfig(): SavedConfig {
  const fromEnv: SavedConfig = {
    journivUrl: process.env.JOURNIV_URL || undefined,
    journivUser: process.env.JOURNIV_USER || undefined,
    journivPass: process.env.JOURNIV_PASS || undefined,
    requiredTag: process.env.JOURNIV_REQUIRED_TAG || undefined,
    hostHeader: process.env.JOURNIV_HOST_HEADER || undefined,
    oauthClientId: process.env.OAUTH_CLIENT_ID || undefined,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || undefined,
  };

  // If any env vars are set, persist the full config to disk so future
  // restarts work even if the container is recreated without env vars.
  const hasEnvConfig = Object.values(fromEnv).some(Boolean);
  if (hasEnvConfig) {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const toSave: SavedConfig = {};
      for (const [k, v] of Object.entries(fromEnv)) {
        if (v) (toSave as any)[k] = v;
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 });
      console.log(`Config saved to ${CONFIG_FILE}`);
    } catch (e) {
      console.warn("Warning: Could not save config to file:", e);
    }
    return fromEnv;
  }

  // No env vars — try the persisted config file.
  try {
    const saved: SavedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    console.log(`Config loaded from ${CONFIG_FILE}`);
    return saved;
  } catch {
    return fromEnv;
  }
}

const config = loadConfig();

const JOURNIV_URL = (config.journivUrl ?? "http://journiv:8000").replace(/\/$/, "");
const JOURNIV_USER = config.journivUser ?? "";
const JOURNIV_PASS = config.journivPass ?? "";
// The allowlist tag. Everything is compared lowercased.
const REQUIRED_TAG = (config.requiredTag ?? "ai").toLowerCase();
// Optional Host header override. Journiv (Starlette TrustedHostMiddleware) only
// accepts requests whose Host matches its configured public hostname (DOMAIN_NAME),
// so hitting it by internal IP yields "Invalid host header". Set this to that
// public hostname (no scheme, no port, no path — e.g. "journal.example.net") and
// we connect to JOURNIV_URL's address while presenting the Host Journiv trusts.
// Leave unset when JOURNIV_URL's own host is already trusted.
const JOURNIV_HOST_HEADER = (config.hostHeader ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .trim();
const OAUTH_CLIENT_ID = config.oauthClientId;
const OAUTH_CLIENT_SECRET = config.oauthClientSecret;
const PORT = parseInt(process.env.PORT || "3000");

const API = `${JOURNIV_URL}/api/v1`;

function journivConfigured(): boolean {
  return !!(JOURNIV_URL && JOURNIV_USER && JOURNIV_PASS);
}

// ── Low-level HTTP to Journiv ───────────────────────────────────────────────────
// rawRequest lives in ./httpclient (side-effect-free, unit-tested). This thin
// wrapper binds the configured Host override so callers don't repeat it.
function rawRequest(
  pathOrUrl: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<RawResponse> {
  return rawRequestBase(pathOrUrl, opts, JOURNIV_HOST_HEADER);
}

// ── Journiv auth (module-level, shared across MCP requests) ─────────────────────
// The server logs in on startup/first-use with a dedicated MCP account, caches
// the JWT, and refreshes on 401. Concurrent logins are de-duplicated so a burst
// of tool calls triggers at most one login.

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loginInFlight: Promise<void> | null = null;

async function login(): Promise<void> {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const res = await rawRequest(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: JOURNIV_USER, password: JOURNIV_PASS }),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Journiv login failed: HTTP ${res.status}: ${res.body}`);
    }
    const data: any = JSON.parse(res.body || "{}");
    accessToken = data.access_token ?? null;
    refreshToken = data.refresh_token ?? null;
    if (!accessToken) throw new Error("Journiv login returned no access_token");
  })().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await rawRequest(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.status < 200 || res.status >= 300) return false;
    const data: any = JSON.parse(res.body || "{}");
    if (data.access_token) {
      accessToken = data.access_token;
      // Journiv does not rotate the refresh token, but honor it if it ever does.
      if (data.refresh_token) refreshToken = data.refresh_token;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

interface JError extends Error {
  status?: number;
}

// Authenticated request against the Journiv API. On 401 it refreshes (or re-logs
// in) once and retries. Returns parsed JSON, raw text, or null for 204.
async function jfetch(
  pathname: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
  retried = false
): Promise<any> {
  if (!accessToken) await login();
  const res = await rawRequest(`${API}${pathname}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 && !retried) {
    const refreshed = await tryRefresh();
    if (!refreshed) await login();
    return jfetch(pathname, opts, true);
  }

  if (res.status < 200 || res.status >= 300) {
    const err: JError = new Error(`HTTP ${res.status}: ${res.body}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204 || res.body === "") return null;
  const ct = (res.headers["content-type"] as string) ?? "";
  return ct.includes("application/json") ? JSON.parse(res.body) : res.body;
}

async function jget(pathname: string): Promise<any> {
  return jfetch(pathname, { method: "GET" });
}

// GET that maps a 404 to null instead of throwing — used for "by id" lookups so
// a missing/non-visible entry becomes a clean not-found.
async function jgetOrNull(pathname: string): Promise<any> {
  try {
    return await jget(pathname);
  } catch (e) {
    if ((e as JError).status === 404) return null;
    throw e;
  }
}

// ── Visibility model — ALLOWLIST ────────────────────────────────────────────────
// Only entries tagged REQUIRED_TAG are visible. Everything else does not exist as
// far as the MCP is concerned. This is the single choke point: adding a seventh
// tool later must not require remembering to add a filter.
//
// Two independent enforcement paths, both fail closed:
//   1. is_visible(moment) — for a fully-hydrated moment object (single GET). If
//      the `tags` field is missing or not an array (API renamed/restructured it),
//      returns false — private, not public.
//   2. visibleMomentIds() — the server-side source of truth from
//      GET /tags/{id}/moments, used to filter list/search results whose per-item
//      tags may not be hydrated. If the tag itself can't be resolved (e.g. the
//      tag system was renamed), the id set is empty — nothing is visible.

function isVisible(moment: any): boolean {
  return isVisibleTag(moment, REQUIRED_TAG);
}

// Resolve the REQUIRED_TAG's id (needed for server-side tag scoping). Cached
// briefly. Returns null if the tag does not exist yet (no visible entries).
let cachedTagId: string | null = null;
let cachedTagIdAt = 0;
const TAG_ID_TTL_MS = 60_000;

async function requiredTagId(): Promise<string | null> {
  const now = Date.now();
  if (cachedTagId !== null && now - cachedTagIdAt < TAG_ID_TTL_MS) return cachedTagId;
  const data = await jget(
    `/tags/search?q=${encodeURIComponent(REQUIRED_TAG)}&limit=50&include_unused=true`
  );
  const match = asList(data).find(
    (t: any) => typeof t?.name === "string" && t.name.toLowerCase() === REQUIRED_TAG
  );
  cachedTagId = match?.id ?? null;
  cachedTagIdAt = now;
  return cachedTagId;
}

// The set of moment ids that carry REQUIRED_TAG, straight from the server-side
// tag endpoint. This is the source of truth for filtering list/search results
// and sidesteps the "paginate → filter client-side → silently under-return"
// trap, since membership is decided server-side.
const VISIBLE_IDS_CAP = 5000;

async function visibleMomentIds(): Promise<{ tagId: string | null; ids: Set<string> }> {
  const tagId = await requiredTagId();
  const ids = new Set<string>();
  if (!tagId) return { tagId, ids };
  const limit = 100;
  let offset = 0;
  while (ids.size < VISIBLE_IDS_CAP) {
    const data = await jget(`/tags/${tagId}/moments?limit=${limit}&offset=${offset}`);
    const list = asList(data);
    if (list.length === 0) break;
    for (const m of list) if (m?.id) ids.add(m.id);
    if (list.length < limit) break;
    offset += limit;
  }
  return { tagId, ids };
}

// ── Shaping ─────────────────────────────────────────────────────────────────────

// Compact form for lists/search. Uses the entry preview Journiv already returns
// on a moment; full text is only fetched for get_entry.
function summarize(moment: any): Record<string, unknown> {
  return {
    id: moment?.id,
    date: moment?.logged_date_tz ?? moment?.logged_at_utc ?? null,
    title: moment?.entry?.title ?? null,
    preview: moment?.entry?.content_plain_text ?? moment?.note ?? null,
    tags: tagNames(moment),
    is_pinned: moment?.is_pinned ?? undefined,
  };
}

// Full text lives on the entry, not the moment (the moment carries a truncated
// preview). Fetch it only when the caller wants the whole thing.
async function entryFullText(moment: any): Promise<string> {
  const entryId = moment?.entry?.id;
  if (!entryId) return moment?.note ?? "";
  const e = await jgetOrNull(`/entries/${entryId}`);
  if (!e) return moment?.entry?.content_plain_text ?? moment?.note ?? "";
  return e.content_plain_text ?? deltaToText(e.content_delta) ?? "";
}

// Order newest-first by logged date when the field is present.
function byDateDesc(a: any, b: any): number {
  const av = a?.logged_at_utc ?? a?.logged_date_tz ?? "";
  const bv = b?.logged_at_utc ?? b?.logged_date_tz ?? "";
  return av < bv ? 1 : av > bv ? -1 : 0;
}

// ── Response Helpers ────────────────────────────────────────────────────────────

function notConfigured() {
  return {
    content: [
      {
        type: "text" as const,
        text: "Journiv is not configured. Set JOURNIV_URL, JOURNIV_USER, and JOURNIV_PASS.",
      },
    ],
    isError: true,
  };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// Non-visible / missing entries return "not found" — never "access denied" — so
// the existence and dates of private entries can't be enumerated by probing ids.
function notFound() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: "not_found", message: "No such entry." }),
      },
    ],
    isError: true,
  };
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// ── MCP Server Factory ──────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "mcp-journiv", version: "1.0.0" });

  server.tool(
    "list_recent",
    `List the most recent journal entries visible to you. Only entries tagged "${REQUIRED_TAG}" are ever returned — everything else in the journal is private and does not exist as far as this tool is concerned.`,
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("How many recent entries to return. Defaults to 10."),
    },
    async ({ limit = 10 }) => {
      if (!journivConfigured()) return notConfigured();
      try {
        const tagId = await requiredTagId();
        if (!tagId) {
          return ok({ total: 0, entries: [], note: `No entries tagged "${REQUIRED_TAG}" yet.` });
        }
        const data = await jget(`/tags/${tagId}/moments?limit=${limit}&offset=0`);
        const list = asList(data).sort(byDateDesc).slice(0, limit);
        return ok({ total: list.length, entries: list.map(summarize) });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "get_entry",
    `Read a single journal entry in full, by its id or by date. Returns "not found" for any entry not tagged "${REQUIRED_TAG}" (private entries are indistinguishable from ones that don't exist).`,
    {
      entry_id: z.string().optional().describe("The entry (moment) id. Provide this OR date."),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("A date (YYYY-MM-DD) to fetch visible entries logged that day. Provide this OR entry_id."),
    },
    async ({ entry_id, date }) => {
      if (!journivConfigured()) return notConfigured();
      if (!entry_id && !date) return errorResponse("Provide either entry_id or date.");
      if (entry_id && date) return errorResponse("Provide only one of entry_id or date.");
      try {
        if (entry_id) {
          const m = await jgetOrNull(`/moments/${entry_id}`);
          if (!m || !isVisible(m)) return notFound();
          const text = await entryFullText(m);
          return ok({ ...summarize(m), text, created_at: m.created_at, updated_at: m.updated_at });
        }
        // by date — one day window, then filter to visible
        const data = await jget(
          `/moments?start_date=${date}&end_date=${date}&limit=200&include_drafts=false`
        );
        const { ids } = await visibleMomentIds();
        const visible = asList(data)
          .filter((m: any) => isVisible(m) || ids.has(m.id))
          .sort(byDateDesc);
        if (visible.length === 0) return notFound();
        const withText = await Promise.all(
          visible.map(async (m: any) => ({ ...summarize(m), text: await entryFullText(m) }))
        );
        return ok({ date, total: withText.length, entries: withText });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "search_entries",
    `Full-text search across your visible journal. Only entries tagged "${REQUIRED_TAG}" can match; private entries never appear in results.`,
    {
      query: z.string().min(1).describe("Text to search for."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of matches to return. Defaults to 10."),
    },
    async ({ query, limit = 10 }) => {
      if (!journivConfigured()) return notConfigured();
      try {
        // Server-side tag filtering isn't available on /moments, so we intersect
        // search hits with the authoritative set of visible ids. We page through
        // hits (cursor-based) rather than filtering a single page, so a large
        // private journal can't make a real match look like "no results".
        const { tagId, ids } = await visibleMomentIds();
        if (!tagId || ids.size === 0) return ok({ total: 0, results: [] });

        const results: Record<string, unknown>[] = [];
        const MAX_SCAN = 2000; // bound the crawl on very large journals
        let scanned = 0;
        let cursor: { at?: string; id?: string } | null = null;

        while (results.length < limit && scanned < MAX_SCAN) {
          const qp = new URLSearchParams({
            search: query,
            limit: "100",
            include_drafts: "false",
          });
          if (cursor?.at && cursor?.id) {
            qp.set("cursor_logged_at_utc", cursor.at);
            qp.set("cursor_id", cursor.id);
          }
          const data = await jget(`/moments?${qp.toString()}`);
          const list = asList(data);
          if (list.length === 0) break;
          for (const m of list) {
            scanned++;
            if (ids.has(m.id)) results.push(summarize(m));
            if (results.length >= limit) break;
          }
          if (list.length < 100) break;
          const last = list[list.length - 1];
          if (!last?.logged_at_utc || !last?.id) break;
          cursor = { at: last.logged_at_utc, id: last.id };
        }

        return ok({
          total: results.length,
          truncated: scanned >= MAX_SCAN && results.length < limit,
          results,
        });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "create_entry",
    `Create a new journal entry. The "${REQUIRED_TAG}" tag is applied automatically so the entry is visible to you afterward and clearly marked as AI-authored in the Journiv UI.`,
    {
      content: z.string().min(1).describe("The body text of the entry."),
      title: z.string().optional().describe("Optional title for the entry."),
      note: z.string().max(500).optional().describe("Optional short note (max 500 chars)."),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Optional date (YYYY-MM-DD) to log the entry under. Defaults to now."),
    },
    async ({ content, title, note, date }) => {
      if (!journivConfigured()) return notConfigured();
      try {
        const body: Record<string, unknown> = {
          entry: {
            ...(title ? { title } : {}),
            content_delta: textToDelta(content),
          },
        };
        if (note) body.note = note;
        if (date) {
          body.logged_date_tz = date;
          body.logged_at_utc = `${date}T12:00:00Z`;
        }

        const created = await jfetch("/moments", { method: "POST", body: JSON.stringify(body) });
        const id = created?.id;
        if (!id) return errorResponse("Journiv did not return an id for the new entry.");

        // Apply the allowlist tag. Body is a bare JSON array of tag names.
        await jfetch(`/moments/${id}/tags`, {
          method: "POST",
          body: JSON.stringify([REQUIRED_TAG]),
        });

        // Confirm the tag actually landed, so a silent tagging failure surfaces.
        cachedTagId = null; // force re-resolve in case this created the tag
        const check = await jgetOrNull(`/moments/${id}`);
        const tagged = check ? isVisible(check) : false;
        return ok({
          created: true,
          id,
          tagged,
          tag: REQUIRED_TAG,
          entry: check ? summarize(check) : { id },
          ...(tagged ? {} : { warning: `Entry created but the "${REQUIRED_TAG}" tag did not apply — it will be invisible to future reads until tagged in the Journiv UI.` }),
        });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "append_to_entry",
    `Append text to the end of an existing visible entry, preserving what's already there. Returns "not found" if the entry isn't tagged "${REQUIRED_TAG}".`,
    {
      entry_id: z.string().describe("The entry (moment) id to append to."),
      text: z.string().min(1).describe("Text to append."),
    },
    async ({ entry_id, text }) => {
      if (!journivConfigured()) return notConfigured();
      try {
        const m = await jgetOrNull(`/moments/${entry_id}`);
        if (!m || !isVisible(m)) return notFound();
        const entryId = m.entry?.id;
        if (!entryId) {
          return errorResponse("This entry has no text body to append to. Use create_entry instead.");
        }
        const full = await jget(`/entries/${entryId}`);
        const newDelta = appendTextToDelta(full?.content_delta, text);
        // PUT /entries touches body/title only — it structurally cannot alter tags.
        await jfetch(`/entries/${entryId}`, {
          method: "PUT",
          body: JSON.stringify({ content_delta: newDelta }),
        });
        const updated = await jgetOrNull(`/moments/${entry_id}`);
        return ok({ updated: true, id: entry_id, entry: updated ? summarize(updated) : undefined });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "update_entry",
    `Replace the body text (and optionally title) of an existing visible entry. Cannot change tags. Returns "not found" if the entry isn't tagged "${REQUIRED_TAG}".`,
    {
      entry_id: z.string().describe("The entry (moment) id to update."),
      content: z.string().min(1).describe("The new body text. Replaces the existing body."),
      title: z.string().optional().describe("Optional new title."),
    },
    async ({ entry_id, content, title }) => {
      if (!journivConfigured()) return notConfigured();
      try {
        const m = await jgetOrNull(`/moments/${entry_id}`);
        if (!m || !isVisible(m)) return notFound();
        const entryId = m.entry?.id;
        if (!entryId) {
          return errorResponse("This entry has no text body to update. Use create_entry instead.");
        }
        // Body-only update. We never send a tags field, and PUT /entries has no
        // tags field to send even if we did — tag changes happen in the UI only.
        const body: Record<string, unknown> = { content_delta: textToDelta(content) };
        if (title !== undefined) body.title = title;
        await jfetch(`/entries/${entryId}`, { method: "PUT", body: JSON.stringify(body) });
        const updated = await jgetOrNull(`/moments/${entry_id}`);
        return ok({ updated: true, id: entry_id, entry: updated ? summarize(updated) : undefined });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  return server;
}

// ── Express App ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!OAUTH_CLIENT_SECRET) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${OAUTH_CLIENT_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mcp-journiv",
    configured: { journiv: journivConfigured() },
    requiredTag: REQUIRED_TAG,
    hostHeaderOverride: JOURNIV_HOST_HEADER || null,
    oauth: !!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET),
  });
});

// In-memory store for authorization codes (expire after 60 seconds)
const authCodes = new Map<string, {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}>();

// OAuth Authorization Server Metadata (RFC 8414)
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const base = `https://${_req.headers.host}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
});

// Authorization endpoint — auto-approves and redirects back with a code
app.get("/authorize", (req: Request, res: Response) => {
  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } =
    req.query as Record<string, string>;

  if (response_type !== "code") {
    res.status(400).send("unsupported_response_type");
    return;
  }
  if (client_id !== OAUTH_CLIENT_ID) {
    res.status(401).send("Unknown client_id");
    return;
  }

  const code = crypto.randomBytes(16).toString("hex");
  authCodes.set(code, {
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    expiresAt: Date.now() + 60_000,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// Token endpoint — authorization_code and client_credentials grants
app.post("/oauth/token", express.urlencoded({ extended: false }), (req: Request, res: Response) => {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    res.status(501).json({ error: "OAuth not configured on this server" });
    return;
  }
  const { grant_type, client_id, client_secret, code, code_verifier } = req.body;

  if (grant_type === "authorization_code") {
    const stored = authCodes.get(code);
    if (!stored || stored.expiresAt < Date.now()) {
      res.status(401).json({ error: "invalid_grant" });
      return;
    }

    // Verify PKCE if the authorization request included a code_challenge
    if (stored.codeChallenge) {
      if (!code_verifier) {
        res.status(401).json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }
      const method = stored.codeChallengeMethod ?? "plain";
      const derived = method === "S256"
        ? crypto.createHash("sha256").update(code_verifier).digest("base64url")
        : code_verifier;
      if (derived !== stored.codeChallenge) {
        res.status(401).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    authCodes.delete(code);
    res.json({ access_token: OAUTH_CLIENT_SECRET, token_type: "Bearer", expires_in: 86400 });
    return;
  }

  if (grant_type === "client_credentials") {
    if (client_id !== OAUTH_CLIENT_ID || client_secret !== OAUTH_CLIENT_SECRET) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    res.json({ access_token: OAUTH_CLIENT_SECRET, token_type: "Bearer", expires_in: 86400 });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

// MCP endpoint — stateless Streamable HTTP transport
async function handleMcp(req: Request, res: Response) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("finish", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", requireAuth, handleMcp);
app.get("/mcp", requireAuth, handleMcp);
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Journiv MCP Server running on port ${PORT}`);
  console.log(`Journiv:     ${journivConfigured() ? `✓ ${JOURNIV_URL}` : "✗ not configured"}`);
  console.log(`Host header: ${JOURNIV_HOST_HEADER ? `override -> ${JOURNIV_HOST_HEADER}` : "(default from URL)"}`);
  console.log(`Visible tag: "${REQUIRED_TAG}" (allowlist)`);
  console.log(`OAuth:       ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET) ? "enabled" : "disabled"}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
