import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────
// Config is read from env vars first, then persisted to /config/config.json so
// that settings survive container recreation (e.g. Unraid auto-updates).

const CONFIG_DIR = process.env.CONFIG_DIR || "/config";
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface SavedConfig {
  sonarrUrl?: string;
  sonarrApiKey?: string;
  radarrUrl?: string;
  radarrApiKey?: string;
  tautulliUrl?: string;
  tautulliApiKey?: string;
  overseerrUrl?: string;
  overseerrApiKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

function loadConfig(): SavedConfig {
  const fromEnv: SavedConfig = {
    sonarrUrl: process.env.SONARR_URL || undefined,
    sonarrApiKey: process.env.SONARR_API_KEY || undefined,
    radarrUrl: process.env.RADARR_URL || undefined,
    radarrApiKey: process.env.RADARR_API_KEY || undefined,
    tautulliUrl: process.env.TAUTULLI_URL || undefined,
    tautulliApiKey: process.env.TAUTULLI_API_KEY || undefined,
    overseerrUrl: process.env.OVERSEERR_URL || undefined,
    overseerrApiKey: process.env.OVERSEERR_API_KEY || undefined,
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

const SONARR_URL = (config.sonarrUrl ?? "").replace(/\/$/, "");
const SONARR_API_KEY = config.sonarrApiKey ?? "";
const RADARR_URL = (config.radarrUrl ?? "").replace(/\/$/, "");
const RADARR_API_KEY = config.radarrApiKey ?? "";
const TAUTULLI_URL = (config.tautulliUrl ?? "").replace(/\/$/, "");
const TAUTULLI_API_KEY = config.tautulliApiKey ?? "";
const OVERSEERR_URL = (config.overseerrUrl ?? "").replace(/\/$/, "");
const OVERSEERR_API_KEY = config.overseerrApiKey ?? "";
const OAUTH_CLIENT_ID = config.oauthClientId;
const OAUTH_CLIENT_SECRET = config.oauthClientSecret;
const PORT = parseInt(process.env.PORT || "3000");

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

async function arrGet(baseUrl: string, apiKey: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function arrPost(baseUrl: string, apiKey: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function tautulliGet(cmd: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${TAUTULLI_URL}/api/v2`);
  url.searchParams.set("apikey", TAUTULLI_API_KEY);
  url.searchParams.set("cmd", cmd);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.response?.result !== "success") {
    throw new Error(data.response?.message ?? "Tautulli API error");
  }
  return data.response.data;
}

async function overseerrGet(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${OVERSEERR_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": OVERSEERR_API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function overseerrPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${OVERSEERR_URL}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": OVERSEERR_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Response Helpers ──────────────────────────────────────────────────────────

function notConfigured(service: string) {
  const upper = service.toUpperCase();
  return {
    content: [{
      type: "text" as const,
      text: `${service} is not configured. Set ${upper}_URL and ${upper}_API_KEY environment variables.`,
    }],
    isError: true,
  };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function overseerrStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    1: "pending", 2: "approved", 3: "declined", 4: "available", 5: "partially_available",
  };
  return labels[status] ?? String(status);
}

// ── MCP Server Factory ────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "mcp-mediamanager", version: "1.0.0" });

  // ══════════════════════════════════════════════════════════════════════════════
  // SONARR — TV Show Management
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    "sonarr_get_library",
    "Get all TV series in your Sonarr library with their status, episode counts, and download progress.",
    {
      status: z.enum(["all", "continuing", "ended"]).optional()
        .describe("Filter by series status. Defaults to 'all'."),
    },
    async ({ status = "all" }) => {
      if (!SONARR_URL || !SONARR_API_KEY) return notConfigured("sonarr");
      try {
        const series: any[] = await arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/series");
        const filtered = status === "all" ? series : series.filter((s) => s.status === status);
        const result = filtered.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          year: s.year,
          seasonCount: s.seasons?.length ?? 0,
          episodeCount: s.statistics?.episodeCount ?? 0,
          episodeFileCount: s.statistics?.episodeFileCount ?? 0,
          percentComplete: `${(s.statistics?.percentOfEpisodes ?? 0).toFixed(1)}%`,
          monitored: s.monitored,
          network: s.network,
          genres: s.genres,
        }));
        return ok({ total: result.length, series: result });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "sonarr_lookup_series",
    "Search for a TV series by name to find its TVDB ID and details before adding it to Sonarr.",
    { term: z.string().describe("Series title to search for.") },
    async ({ term }) => {
      if (!SONARR_URL || !SONARR_API_KEY) return notConfigured("sonarr");
      try {
        const results: any[] = await arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/series/lookup", { term });
        const mapped = results.slice(0, 10).map((s) => ({
          title: s.title,
          tvdbId: s.tvdbId,
          year: s.year,
          status: s.status,
          overview: s.overview?.slice(0, 200),
          network: s.network,
          genres: s.genres,
          alreadyInLibrary: !!s.id,
        }));
        return ok(mapped);
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "sonarr_add_series",
    "Add a TV series to Sonarr by its TVDB ID. Use sonarr_lookup_series first to find the TVDB ID. Automatically uses the first available quality profile and root folder.",
    {
      tvdb_id: z.number().describe("TVDB ID of the series (from sonarr_lookup_series)."),
      title: z.string().describe("Title of the series."),
      monitored: z.boolean().optional().describe("Monitor the series for new episodes. Defaults to true."),
      search_on_add: z.boolean().optional().describe("Search for missing episodes immediately after adding. Defaults to true."),
      quality_profile_id: z.number().optional().describe("Quality profile ID to use. Omit to auto-select the first available."),
    },
    async ({ tvdb_id, title, monitored = true, search_on_add = true, quality_profile_id }) => {
      if (!SONARR_URL || !SONARR_API_KEY) return notConfigured("sonarr");
      try {
        const [profiles, rootFolders]: [any[], any[]] = await Promise.all([
          arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/qualityprofile"),
          arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/rootfolder"),
        ]);
        if (!profiles.length) throw new Error("No quality profiles configured in Sonarr");
        if (!rootFolders.length) throw new Error("No root folders configured in Sonarr");
        const profileId = quality_profile_id ?? profiles[0].id;
        const rootPath = rootFolders[0].path;
        const result = await arrPost(SONARR_URL, SONARR_API_KEY, "/api/v3/series", {
          tvdbId: tvdb_id,
          title,
          qualityProfileId: profileId,
          rootFolderPath: rootPath,
          monitored,
          addOptions: { searchForMissingEpisodes: search_on_add },
          seasons: [],
        });
        return ok({ added: true, id: result.id, title: result.title, path: result.path });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "sonarr_get_calendar",
    "Get upcoming TV episodes airing within the next N days.",
    {
      days_ahead: z.number().optional().describe("Number of days ahead to look. Defaults to 7."),
    },
    async ({ days_ahead = 7 }) => {
      if (!SONARR_URL || !SONARR_API_KEY) return notConfigured("sonarr");
      try {
        const start = new Date().toISOString().split("T")[0];
        const end = new Date(Date.now() + days_ahead * 86_400_000).toISOString().split("T")[0];
        const episodes: any[] = await arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/calendar", { start, end });
        const result = episodes.map((e) => ({
          series: e.series?.title,
          episode: `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`,
          title: e.title,
          airDate: e.airDateUtc,
          hasFile: e.hasFile,
          monitored: e.monitored,
        }));
        return ok({ count: result.length, upcoming: result });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "sonarr_get_wanted",
    "Get monitored episodes that are missing (not yet downloaded).",
    {
      page_size: z.number().optional().describe("Number of results to return. Defaults to 25."),
    },
    async ({ page_size = 25 }) => {
      if (!SONARR_URL || !SONARR_API_KEY) return notConfigured("sonarr");
      try {
        const data: any = await arrGet(SONARR_URL, SONARR_API_KEY, "/api/v3/wanted/missing", {
          pageSize: String(page_size),
          sortKey: "airDateUtc",
          sortDirection: "descending",
        });
        const result = (data.records ?? []).map((e: any) => ({
          series: e.series?.title,
          episode: `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`,
          title: e.title,
          airDate: e.airDateUtc,
          monitored: e.monitored,
        }));
        return ok({ total: data.totalRecords, shown: result.length, missing: result });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // RADARR — Movie Management
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    "radarr_get_library",
    "Get all movies in your Radarr library with their availability and download status.",
    {
      filter: z.enum(["all", "available", "missing"]).optional()
        .describe("'missing' = monitored but not downloaded. Defaults to 'all'."),
    },
    async ({ filter = "all" }) => {
      if (!RADARR_URL || !RADARR_API_KEY) return notConfigured("radarr");
      try {
        const movies: any[] = await arrGet(RADARR_URL, RADARR_API_KEY, "/api/v3/movie");
        const filtered =
          filter === "available" ? movies.filter((m) => m.hasFile) :
          filter === "missing"   ? movies.filter((m) => m.monitored && !m.hasFile) :
          movies;
        const result = filtered.map((m) => ({
          id: m.id,
          title: m.title,
          year: m.year,
          status: m.status,
          hasFile: m.hasFile,
          monitored: m.monitored,
          genres: m.genres,
          tmdbId: m.tmdbId,
          imdbId: m.imdbId,
        }));
        return ok({ total: result.length, movies: result });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "radarr_lookup_movie",
    "Search for a movie by name to find its TMDB ID and details before adding it to Radarr.",
    { term: z.string().describe("Movie title to search for.") },
    async ({ term }) => {
      if (!RADARR_URL || !RADARR_API_KEY) return notConfigured("radarr");
      try {
        const results: any[] = await arrGet(RADARR_URL, RADARR_API_KEY, "/api/v3/movie/lookup", { term });
        const mapped = results.slice(0, 10).map((m) => ({
          title: m.title,
          tmdbId: m.tmdbId,
          imdbId: m.imdbId,
          year: m.year,
          status: m.status,
          overview: m.overview?.slice(0, 200),
          genres: m.genres,
          alreadyInLibrary: !!m.id,
        }));
        return ok(mapped);
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "radarr_add_movie",
    "Add a movie to Radarr by its TMDB ID. Use radarr_lookup_movie first to find the TMDB ID. Automatically uses the first available quality profile and root folder.",
    {
      tmdb_id: z.number().describe("TMDB ID of the movie (from radarr_lookup_movie)."),
      title: z.string().describe("Title of the movie."),
      monitored: z.boolean().optional().describe("Monitor the movie for downloads. Defaults to true."),
      search_on_add: z.boolean().optional().describe("Search for the movie immediately after adding. Defaults to true."),
      quality_profile_id: z.number().optional().describe("Quality profile ID to use. Omit to auto-select the first available."),
    },
    async ({ tmdb_id, title, monitored = true, search_on_add = true, quality_profile_id }) => {
      if (!RADARR_URL || !RADARR_API_KEY) return notConfigured("radarr");
      try {
        const [profiles, rootFolders]: [any[], any[]] = await Promise.all([
          arrGet(RADARR_URL, RADARR_API_KEY, "/api/v3/qualityprofile"),
          arrGet(RADARR_URL, RADARR_API_KEY, "/api/v3/rootfolder"),
        ]);
        if (!profiles.length) throw new Error("No quality profiles configured in Radarr");
        if (!rootFolders.length) throw new Error("No root folders configured in Radarr");
        const profileId = quality_profile_id ?? profiles[0].id;
        const rootPath = rootFolders[0].path;
        const result = await arrPost(RADARR_URL, RADARR_API_KEY, "/api/v3/movie", {
          tmdbId: tmdb_id,
          title,
          qualityProfileId: profileId,
          rootFolderPath: rootPath,
          monitored,
          addOptions: { searchForMovie: search_on_add },
        });
        return ok({ added: true, id: result.id, title: result.title, path: result.path });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "radarr_get_wanted",
    "Get monitored movies that are missing (not yet downloaded).",
    {
      page_size: z.number().optional().describe("Number of results to return. Defaults to 25."),
    },
    async ({ page_size = 25 }) => {
      if (!RADARR_URL || !RADARR_API_KEY) return notConfigured("radarr");
      try {
        const data: any = await arrGet(RADARR_URL, RADARR_API_KEY, "/api/v3/wanted/missing", {
          pageSize: String(page_size),
          sortKey: "physicalRelease",
          sortDirection: "descending",
        });
        const result = (data.records ?? []).map((m: any) => ({
          title: m.title,
          year: m.year,
          tmdbId: m.tmdbId,
          status: m.status,
          physicalRelease: m.physicalRelease ?? null,
          digitalRelease: m.digitalRelease ?? null,
        }));
        return ok({ total: data.totalRecords, shown: result.length, missing: result });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // TAUTULLI — Plex Analytics
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    "tautulli_get_activity",
    "Get current Plex streaming activity — who is watching what right now, with quality and progress info.",
    {},
    async () => {
      if (!TAUTULLI_URL || !TAUTULLI_API_KEY) return notConfigured("tautulli");
      try {
        const data = await tautulliGet("get_activity");
        const sessions = (data.sessions ?? []).map((s: any) => ({
          user: s.friendly_name,
          title: s.grandparent_title ? `${s.grandparent_title} — ${s.title}` : s.title,
          mediaType: s.media_type,
          state: s.state,
          progress: `${s.progress_percent}%`,
          player: s.player,
          quality: s.quality_profile,
          transcodeDecision: s.transcode_decision,
          bandwidthMbps: (s.bandwidth / 1024).toFixed(2),
        }));
        return ok({ streamCount: data.stream_count ?? 0, streams: sessions });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "tautulli_get_history",
    "Get recent Plex watch history across all users with completion and playback details.",
    {
      length: z.number().optional().describe("Number of records to return. Defaults to 25."),
      user: z.string().optional().describe("Filter by Plex username."),
      media_type: z.enum(["movie", "episode", "track"]).optional().describe("Filter by media type."),
    },
    async ({ length = 25, user, media_type }) => {
      if (!TAUTULLI_URL || !TAUTULLI_API_KEY) return notConfigured("tautulli");
      try {
        const params: Record<string, string> = { length: String(length) };
        if (user) params.user = user;
        if (media_type) params.media_type = media_type;
        const data = await tautulliGet("get_history", params);
        const records = (data.data ?? []).map((r: any) => ({
          user: r.friendly_name,
          title: r.grandparent_title ? `${r.grandparent_title} — ${r.title}` : r.title,
          mediaType: r.media_type,
          watchedAt: new Date(r.started * 1000).toISOString(),
          durationMin: Math.round(r.duration / 60),
          percentComplete: `${r.percent_complete}%`,
          player: r.player,
        }));
        return ok({ total: data.recordsFiltered, shown: records.length, history: records });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "tautulli_get_stats",
    "Get Plex play statistics: top users, most-watched shows/movies, and most active time periods.",
    {
      time_range: z.number().optional().describe("Number of days to look back. Defaults to 30."),
      stats_count: z.number().optional().describe("Number of top items per stat category. Defaults to 5."),
    },
    async ({ time_range = 30, stats_count = 5 }) => {
      if (!TAUTULLI_URL || !TAUTULLI_API_KEY) return notConfigured("tautulli");
      try {
        const data = await tautulliGet("get_home_stats", {
          time_range: String(time_range),
          stats_count: String(stats_count),
        });
        return ok(data);
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "tautulli_get_recently_added",
    "Get media recently added to Plex libraries.",
    {
      count: z.number().optional().describe("Number of items to return. Defaults to 15."),
      media_type: z.enum(["movie", "show", "artist"]).optional().describe("Filter by media type."),
    },
    async ({ count = 15, media_type }) => {
      if (!TAUTULLI_URL || !TAUTULLI_API_KEY) return notConfigured("tautulli");
      try {
        const params: Record<string, string> = { count: String(count) };
        if (media_type) params.media_type = media_type;
        const data = await tautulliGet("get_recently_added", params);
        const items = (data.recently_added ?? []).map((item: any) => ({
          title: item.grandparent_title ? `${item.grandparent_title} — ${item.title}` : item.title,
          mediaType: item.media_type,
          year: item.year,
          addedOn: new Date(item.added_at * 1000).toISOString().split("T")[0],
          rating: item.rating,
          summary: item.summary?.slice(0, 150),
        }));
        return ok({ count: items.length, recentlyAdded: items });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // OVERSEERR — Media Request Management
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    "overseerr_get_requests",
    "Get media requests submitted to Overseerr, with their approval status and who requested them.",
    {
      filter: z.enum(["all", "pending", "approved", "declined", "available"]).optional()
        .describe("Filter by request status. Defaults to 'all'."),
      take: z.number().optional().describe("Number of requests to return. Defaults to 20."),
    },
    async ({ filter = "all", take = 20 }) => {
      if (!OVERSEERR_URL || !OVERSEERR_API_KEY) return notConfigured("overseerr");
      try {
        const data = await overseerrGet("/api/v1/request", {
          take: String(take),
          skip: "0",
          filter,
          sort: "added",
        });
        const requests = (data.results ?? []).map((r: any) => ({
          id: r.id,
          status: overseerrStatusLabel(r.status),
          type: r.type,
          tmdbId: r.media?.tmdbId,
          requestedBy: r.requestedBy?.displayName ?? r.requestedBy?.username,
          createdAt: r.createdAt,
          seasons: r.seasons?.map((s: any) => s.seasonNumber) ?? null,
        }));
        return ok({ total: data.pageInfo?.results, shown: requests.length, requests });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "overseerr_search",
    "Search for movies or TV shows in Overseerr (backed by TMDB). Shows whether items are already requested or available.",
    {
      query: z.string().describe("Title to search for."),
      media_type: z.enum(["movie", "tv", "all"]).optional().describe("Limit results to movies or TV. Defaults to 'all'."),
    },
    async ({ query, media_type = "all" }) => {
      if (!OVERSEERR_URL || !OVERSEERR_API_KEY) return notConfigured("overseerr");
      try {
        const data = await overseerrGet("/api/v1/search", { query, page: "1", language: "en" });
        let results = data.results ?? [];
        if (media_type !== "all") results = results.filter((r: any) => r.mediaType === media_type);
        const mapped = results.slice(0, 10).map((r: any) => ({
          title: r.title ?? r.name,
          mediaType: r.mediaType,
          tmdbId: r.id,
          year: r.releaseDate?.slice(0, 4) ?? r.firstAirDate?.slice(0, 4),
          overview: r.overview?.slice(0, 200),
          mediaStatus: overseerrStatusLabel(r.mediaInfo?.status ?? 0),
        }));
        return ok(mapped);
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "overseerr_request_media",
    "Submit a request for a movie or TV show in Overseerr. Use overseerr_search first to find the TMDB ID.",
    {
      media_type: z.enum(["movie", "tv"]).describe("Type of media to request."),
      tmdb_id: z.number().describe("TMDB ID of the movie or show (from overseerr_search)."),
      seasons: z.array(z.number()).optional()
        .describe("For TV shows: specific season numbers to request. Omit to request all seasons."),
    },
    async ({ media_type, tmdb_id, seasons }) => {
      if (!OVERSEERR_URL || !OVERSEERR_API_KEY) return notConfigured("overseerr");
      try {
        const body: Record<string, unknown> = { mediaType: media_type, mediaId: tmdb_id };
        if (media_type === "tv") {
          body.seasons = seasons ?? "all";
        }
        const result = await overseerrPost("/api/v1/request", body);
        return ok({
          requested: true,
          requestId: result.id,
          status: overseerrStatusLabel(result.status),
          type: result.type,
        });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  server.tool(
    "overseerr_update_request",
    "Approve or decline a pending media request in Overseerr.",
    {
      request_id: z.number().describe("The request ID (from overseerr_get_requests)."),
      action: z.enum(["approve", "decline"]).describe("Whether to approve or decline the request."),
    },
    async ({ request_id, action }) => {
      if (!OVERSEERR_URL || !OVERSEERR_API_KEY) return notConfigured("overseerr");
      try {
        const result = await overseerrPost(`/api/v1/request/${request_id}/${action}`, {});
        return ok({ success: true, requestId: result.id, status: overseerrStatusLabel(result.status) });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  return server;
}

// ── Express App ───────────────────────────────────────────────────────────────

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
    service: "mcp-mediamanager",
    configured: {
      sonarr: !!(SONARR_URL && SONARR_API_KEY),
      radarr: !!(RADARR_URL && RADARR_API_KEY),
      tautulli: !!(TAUTULLI_URL && TAUTULLI_API_KEY),
      overseerr: !!(OVERSEERR_URL && OVERSEERR_API_KEY),
    },
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
  console.log(`Media MCP Server running on port ${PORT}`);
  console.log(`Sonarr:    ${SONARR_URL   ? `✓ ${SONARR_URL}`   : "✗ not configured"}`);
  console.log(`Radarr:    ${RADARR_URL   ? `✓ ${RADARR_URL}`   : "✗ not configured"}`);
  console.log(`Tautulli:  ${TAUTULLI_URL ? `✓ ${TAUTULLI_URL}` : "✗ not configured"}`);
  console.log(`Overseerr: ${OVERSEERR_URL? `✓ ${OVERSEERR_URL}`: "✗ not configured"}`);
  console.log(`OAuth:     ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET) ? "enabled" : "disabled"}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
