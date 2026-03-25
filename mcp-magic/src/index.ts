import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { createMcpServer } from "./mcp/tools.js";
import { collectionRouter } from "./routes/collection.js";
import { decksRouter } from "./routes/decks.js";
import { foldersRouter } from "./routes/folders.js";
import { importRouter } from "./routes/import.js";
import { scryfallRouter } from "./routes/scryfall.js";

// ── Config ─────────────────────────────────────────────────────────────────────

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const PORT = parseInt(process.env.PORT || "3000");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

// ── Express App ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Multer for CSV uploads (in-memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Auth Middleware ────────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!OAUTH_CLIENT_SECRET) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${OAUTH_CLIENT_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── Health Check ───────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mcp-magic" });
});

// ── OAuth 2.0 ──────────────────────────────────────────────────────────────────

const authCodes = new Map<string, {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}>();

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

app.get("/authorize", (req: Request, res: Response) => {
  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } =
    req.query as Record<string, string>;

  if (response_type !== "code") { res.status(400).send("unsupported_response_type"); return; }
  if (client_id !== OAUTH_CLIENT_ID) { res.status(401).send("Unknown client_id"); return; }

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

app.post("/oauth/token", express.urlencoded({ extended: false }), (req: Request, res: Response) => {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    res.status(501).json({ error: "OAuth not configured" });
    return;
  }

  const { grant_type, client_id, client_secret, code, code_verifier } = req.body;

  if (grant_type === "authorization_code") {
    const stored = authCodes.get(code);
    if (!stored || stored.expiresAt < Date.now()) { res.status(401).json({ error: "invalid_grant" }); return; }
    if (stored.codeChallenge) {
      if (!code_verifier) { res.status(401).json({ error: "invalid_grant", error_description: "code_verifier required" }); return; }
      const method = stored.codeChallengeMethod ?? "plain";
      const derived = method === "S256"
        ? crypto.createHash("sha256").update(code_verifier).digest("base64url")
        : code_verifier;
      if (derived !== stored.codeChallenge) { res.status(401).json({ error: "invalid_grant", error_description: "PKCE verification failed" }); return; }
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

// ── MCP Endpoint ───────────────────────────────────────────────────────────────

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

// ── REST API Routes ────────────────────────────────────────────────────────────

app.use("/api/collection", collectionRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/decks", decksRouter);
app.use("/api/scryfall", scryfallRouter);

// Import routes need multer attached
app.post("/api/import/csv",
  upload.single("file"),
  (req, res, next) => { importRouter(req, res, next); }
);
app.post("/api/import/text", (req, res, next) => { importRouter(req, res, next); });
app.use("/api/import", importRouter);

// ── Static Frontend ────────────────────────────────────────────────────────────

app.use(express.static(PUBLIC_DIR));

// SPA fallback — serve index.html for all non-API routes
app.get(/^(?!\/api|\/mcp|\/health|\/authorize|\/oauth|\/\.well-known)/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), (err) => {
    if (err) res.status(404).json({ error: "Frontend not built. Run npm run build:client first." });
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`mcp-magic running on port ${PORT}`);
  console.log(`Web UI:  http://localhost:${PORT}`);
  console.log(`MCP:     http://localhost:${PORT}/mcp`);
  console.log(`OAuth:   ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET)}`);
});
