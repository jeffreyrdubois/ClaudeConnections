import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter, verifySessionToken, getCookieValue } from "./routes/auth.js";
import { playersRouter } from "./routes/players.js";
import { gamesRouter } from "./routes/games.js";
import { matchesRouter } from "./routes/matches.js";
import { analyticsRouter } from "./routes/analytics.js";
import { instructionsRouter } from "./routes/instructions.js";

const PORT = parseInt(process.env.PORT || "3000");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── Auth Middleware ────────────────────────────────────────────────────────────
// Only require auth for mutating requests (POST, PATCH, PUT, DELETE)

function requireAuthForWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const token = getCookieValue(req, "session");
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
  const username = verifySessionToken(token);
  if (!username) { res.status(401).json({ error: "Session expired" }); return; }
  next();
}

// ── Health Check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── API Routes ────────────────────────────────────────────────────────────────

// Auth (no auth required for any methods)
app.use("/api/auth", authRouter);

// All other routes: read is public, write requires auth
app.use("/api/players", requireAuthForWrites, playersRouter);
app.use("/api/games", requireAuthForWrites, gamesRouter);
app.use("/api/matches", requireAuthForWrites, matchesRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/instructions", requireAuthForWrites, instructionsRouter);

// ── Static Files ──────────────────────────────────────────────────────────────

app.use(express.static(PUBLIC_DIR));
app.get("*path", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Board Game Tracker running on http://localhost:${PORT}`);
});
