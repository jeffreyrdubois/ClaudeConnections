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
  vaultDir?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

function loadConfig(): SavedConfig {
  const fromEnv: SavedConfig = {
    vaultDir: process.env.VAULT_DIR || undefined,
    oauthClientId: process.env.OAUTH_CLIENT_ID || undefined,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || undefined,
  };

  // If env vars supply OAuth creds, persist them to disk so future restarts work
  // even if the container is recreated without env vars (e.g. Unraid updates).
  if (fromEnv.oauthClientSecret) {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const toSave: SavedConfig = {};
      if (fromEnv.vaultDir) toSave.vaultDir = fromEnv.vaultDir;
      if (fromEnv.oauthClientId) toSave.oauthClientId = fromEnv.oauthClientId;
      if (fromEnv.oauthClientSecret) toSave.oauthClientSecret = fromEnv.oauthClientSecret;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 });
      console.log(`Config saved to ${CONFIG_FILE}`);
    } catch (e) {
      console.warn("Warning: Could not save config to file:", e);
    }
    return fromEnv;
  }

  // No secret in env — try the persisted config file, falling back to env values.
  try {
    const saved: SavedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    console.log(`Config loaded from ${CONFIG_FILE}`);
    return {
      vaultDir: fromEnv.vaultDir || saved.vaultDir,
      oauthClientId: fromEnv.oauthClientId || saved.oauthClientId,
      oauthClientSecret: fromEnv.oauthClientSecret || saved.oauthClientSecret,
    };
  } catch {
    // No file yet — env vars were also empty.
    return fromEnv;
  }
}

const config = loadConfig();

const VAULT_DIR = path.resolve(config.vaultDir || "/vault");
const OAUTH_CLIENT_ID = config.oauthClientId;
const OAUTH_CLIENT_SECRET = config.oauthClientSecret;
const PORT = parseInt(process.env.PORT || "3004");

// Extensions that may be created / edited / deleted. Reading is allowed for any
// file inside the vault, but write operations are restricted to note files so a
// misbehaving client can't clobber arbitrary data.
const NOTE_EXTENSIONS = (process.env.NOTE_EXTENSIONS || ".md,.markdown,.txt,.canvas")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Directories to skip when listing/searching (internal / hidden state).
const SKIP_DIRS = new Set([".git", "node_modules", ".trash", ".obsidian", ".silverbullet"]);

try {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
} catch (e) {
  console.error(`ERROR: Could not access vault directory ${VAULT_DIR}:`, e);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// Resolve a vault-relative path to an absolute path, guaranteeing it stays
// inside VAULT_DIR (defeats `../` traversal and absolute-path escapes).
function resolveInVault(relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new Error("A note path is required");
  }
  // Treat the path as vault-relative even if it starts with "/".
  const cleaned = relPath.replace(/^[/\\]+/, "");
  const full = path.resolve(VAULT_DIR, cleaned);
  if (full !== VAULT_DIR && !full.startsWith(VAULT_DIR + path.sep)) {
    throw new Error(`Path escapes the vault directory: ${relPath}`);
  }
  return full;
}

function assertWritableExt(relPath: string): void {
  const ext = path.extname(relPath).toLowerCase();
  if (!NOTE_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Refusing to write/delete '${relPath}': extension must be one of ${NOTE_EXTENSIONS.join(", ")}`
    );
  }
}

function toRel(full: string): string {
  return path.relative(VAULT_DIR, full).split(path.sep).join("/");
}

// Recursively collect files under `dir`, skipping hidden/internal directories.
function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (entry.name.startsWith(".")) continue;
      out.push(full);
    }
  }
  return out;
}

function isNoteFile(file: string): boolean {
  return NOTE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

// ── MCP Server Factory ───────────────────────────────────────────────────────
// A new server instance is created per request (stateless mode).

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-obsidian",
    version: "1.0.0",
  });

  // ── Tool: list_notes ─────────────────────────────────────────────────────────
  server.tool(
    "list_notes",
    "List markdown notes in the vault. Optionally restrict to a sub-folder and/or filter by a substring matched against the note path.",
    {
      folder: z
        .string()
        .optional()
        .describe("Vault-relative sub-folder to list (e.g. 'projects'). Defaults to the whole vault."),
      filter: z
        .string()
        .optional()
        .describe("Only return notes whose path contains this substring (case-insensitive)."),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of notes to return. Defaults to 500."),
    },
    async ({ folder, filter, limit }) => {
      try {
        const root = folder ? resolveInVault(folder) : VAULT_DIR;
        const files = walk(root)
          .filter(isNoteFile)
          .map(toRel);
        let notes = files;
        if (filter) {
          const lower = filter.toLowerCase();
          notes = notes.filter((p) => p.toLowerCase().includes(lower));
        }
        notes.sort((a, b) => a.localeCompare(b));
        const total = notes.length;
        notes = notes.slice(0, limit ?? 500);
        return textResponse(
          JSON.stringify({ count: notes.length, total, notes }, null, 2)
        );
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: read_note ──────────────────────────────────────────────────────────
  server.tool(
    "read_note",
    "Read the full contents of a note (or any text file) in the vault by its vault-relative path.",
    {
      path: z.string().describe("Vault-relative path, e.g. 'projects/ideas.md'."),
    },
    async ({ path: relPath }) => {
      try {
        const full = resolveInVault(relPath);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
          return errorResponse(`Note not found: ${relPath}`);
        }
        const content = fs.readFileSync(full, "utf8");
        return textResponse(content);
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: create_note ────────────────────────────────────────────────────────
  server.tool(
    "create_note",
    "Create a new note with the given content. Fails if the note already exists (use update_note to overwrite). Parent folders are created automatically.",
    {
      path: z.string().describe("Vault-relative path for the new note, e.g. 'inbox/2026-05-31.md'."),
      content: z.string().describe("Markdown content for the note."),
    },
    async ({ path: relPath, content }) => {
      try {
        const full = resolveInVault(relPath);
        assertWritableExt(relPath);
        if (fs.existsSync(full)) {
          return errorResponse(`Note already exists: ${relPath}. Use update_note to overwrite.`);
        }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
        return textResponse(`Created note: ${toRel(full)} (${content.length} chars)`);
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: update_note ────────────────────────────────────────────────────────
  server.tool(
    "update_note",
    "Overwrite a note's entire contents. Creates the note (and parent folders) if it does not exist.",
    {
      path: z.string().describe("Vault-relative path of the note to write."),
      content: z.string().describe("New full markdown content (replaces everything)."),
    },
    async ({ path: relPath, content }) => {
      try {
        const full = resolveInVault(relPath);
        assertWritableExt(relPath);
        const existed = fs.existsSync(full);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
        return textResponse(
          `${existed ? "Updated" : "Created"} note: ${toRel(full)} (${content.length} chars)`
        );
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: append_note ────────────────────────────────────────────────────────
  server.tool(
    "append_note",
    "Append text to the end of an existing note. Creates the note if it does not exist.",
    {
      path: z.string().describe("Vault-relative path of the note."),
      content: z.string().describe("Text to append."),
      newline: z
        .boolean()
        .optional()
        .describe("Prepend a newline before the appended text. Defaults to true."),
    },
    async ({ path: relPath, content, newline }) => {
      try {
        const full = resolveInVault(relPath);
        assertWritableExt(relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const prefix = (newline ?? true) && fs.existsSync(full) && fs.statSync(full).size > 0 ? "\n" : "";
        fs.appendFileSync(full, prefix + content, "utf8");
        return textResponse(`Appended ${content.length} chars to ${toRel(full)}`);
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: edit_note ──────────────────────────────────────────────────────────
  server.tool(
    "edit_note",
    "Edit a note by replacing an exact string. By default replaces the first occurrence; set replace_all to replace every occurrence. The old_string must match exactly (including whitespace).",
    {
      path: z.string().describe("Vault-relative path of the note to edit."),
      old_string: z.string().describe("Exact text to find."),
      new_string: z.string().describe("Text to replace it with."),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace all occurrences instead of just the first. Defaults to false."),
    },
    async ({ path: relPath, old_string, new_string, replace_all }) => {
      try {
        const full = resolveInVault(relPath);
        assertWritableExt(relPath);
        if (!fs.existsSync(full)) {
          return errorResponse(`Note not found: ${relPath}`);
        }
        const original = fs.readFileSync(full, "utf8");
        const occurrences = original.split(old_string).length - 1;
        if (occurrences === 0) {
          return errorResponse(`old_string not found in ${relPath}`);
        }
        if (occurrences > 1 && !replace_all) {
          return errorResponse(
            `old_string appears ${occurrences} times in ${relPath}. Provide a more specific string or set replace_all=true.`
          );
        }
        const updated = replace_all
          ? original.split(old_string).join(new_string)
          : original.replace(old_string, new_string);
        fs.writeFileSync(full, updated, "utf8");
        return textResponse(
          `Edited ${toRel(full)} (${replace_all ? occurrences : 1} replacement${
            (replace_all ? occurrences : 1) === 1 ? "" : "s"
          })`
        );
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: delete_note ────────────────────────────────────────────────────────
  server.tool(
    "delete_note",
    "Delete a note from the vault by its vault-relative path.",
    {
      path: z.string().describe("Vault-relative path of the note to delete."),
    },
    async ({ path: relPath }) => {
      try {
        const full = resolveInVault(relPath);
        assertWritableExt(relPath);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
          return errorResponse(`Note not found: ${relPath}`);
        }
        fs.unlinkSync(full);
        return textResponse(`Deleted note: ${toRel(full)}`);
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: move_note ──────────────────────────────────────────────────────────
  server.tool(
    "move_note",
    "Move or rename a note. Parent folders of the destination are created automatically.",
    {
      from: z.string().describe("Current vault-relative path."),
      to: z.string().describe("New vault-relative path."),
    },
    async ({ from, to }) => {
      try {
        const src = resolveInVault(from);
        const dest = resolveInVault(to);
        assertWritableExt(to);
        if (!fs.existsSync(src)) {
          return errorResponse(`Note not found: ${from}`);
        }
        if (fs.existsSync(dest)) {
          return errorResponse(`Destination already exists: ${to}`);
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(src, dest);
        return textResponse(`Moved ${toRel(src)} -> ${toRel(dest)}`);
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  // ── Tool: search_notes ───────────────────────────────────────────────────────
  server.tool(
    "search_notes",
    "Full-text search across all markdown notes. Returns matching notes with the line numbers and text of each match.",
    {
      query: z.string().describe("Text to search for (case-insensitive)."),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of notes to return. Defaults to 30."),
    },
    async ({ query, max_results }) => {
      try {
        const lower = query.toLowerCase();
        const files = walk(VAULT_DIR).filter(isNoteFile);
        const results: { note: string; matches: { line: number; text: string }[] }[] = [];
        for (const file of files) {
          let content: string;
          try {
            content = fs.readFileSync(file, "utf8");
          } catch {
            continue;
          }
          if (!content.toLowerCase().includes(lower)) continue;
          const matches: { line: number; text: string }[] = [];
          content.split("\n").forEach((line, i) => {
            if (line.toLowerCase().includes(lower)) {
              matches.push({ line: i + 1, text: line.trim().slice(0, 200) });
            }
          });
          results.push({ note: toRel(file), matches: matches.slice(0, 10) });
          if (results.length >= (max_results ?? 30)) break;
        }
        return textResponse(
          JSON.stringify({ query, count: results.length, results }, null, 2)
        );
      } catch (e: any) {
        return errorResponse(e?.message ?? "Unknown error");
      }
    }
  );

  return server;
}

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "25mb" }));

// Auth middleware
function requireAuth(req: Request, res: Response, next: () => void) {
  if (!OAUTH_CLIENT_SECRET) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${OAUTH_CLIENT_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mcp-obsidian", vault: VAULT_DIR });
});

// ── OAuth 2.0 ────────────────────────────────────────────────────────────────

// In-memory store for authorization codes (expire after 60 seconds)
const authCodes = new Map<
  string,
  {
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    expiresAt: number;
  }
>();

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
      const derived =
        method === "S256"
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
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("finish", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", requireAuth, handleMcp);
app.get("/mcp", requireAuth, handleMcp);
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Obsidian/Markdown MCP Server running on port ${PORT}`);
  console.log(`Vault directory: ${VAULT_DIR}`);
  console.log(`Writable extensions: ${NOTE_EXTENSIONS.join(", ")}`);
  console.log(`OAuth enabled: ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET)}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
