import crypto from "crypto";
import { Router, Request, Response } from "express";
import {
  getUserByUsername, createUser, setUserPassword,
  getAppConfig, setAppConfig, hasAnyUsers, getAllUsers,
  approveUser, deleteUser,
} from "../db/index.js";

export const authRouter = Router();

// ── Session Helpers ─────────────────────────────────────────────────────────────

function getSessionSecret(): string {
  let secret = getAppConfig("session_secret");
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    setAppConfig("session_secret", secret);
  }
  return secret;
}

export function createSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + 7 * 24 * 3600 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let data: { u: string; exp: number };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number };
  } catch {
    return null;
  }
  if (data.exp < Date.now()) return null;
  return data.u;
}

export function getCookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader(
    "Set-Cookie",
    `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}; Path=/`
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/");
}

// ── Password Helpers ───────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const colonIdx = stored.indexOf(":");
  if (colonIdx < 0) return false;
  const salt = stored.slice(0, colonIdx);
  const storedHex = stored.slice(colonIdx + 1);
  return new Promise((resolve) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) { resolve(false); return; }
      try {
        const storedBuf = Buffer.from(storedHex, "hex");
        resolve(storedBuf.length === key.length && crypto.timingSafeEqual(key, storedBuf));
      } catch {
        resolve(false);
      }
    });
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/auth/me
authRouter.get("/me", (req: Request, res: Response) => {
  const token = getCookieValue(req, "session");
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
  const username = verifySessionToken(token);
  if (!username) { res.status(401).json({ error: "Session expired" }); return; }
  const user = getUserByUsername(username);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  res.json({ username, is_admin: !!user.is_admin, is_approved: !!user.is_approved });
});

// GET /api/auth/status — check if setup is needed
authRouter.get("/status", (_req: Request, res: Response) => {
  res.json({ needs_setup: !hasAnyUsers() });
});

// POST /api/auth/setup — first user registration (becomes admin)
authRouter.post("/setup", async (req: Request, res: Response) => {
  if (hasAnyUsers()) {
    res.status(403).json({ error: "Setup already completed" });
    return;
  }
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const hash = await hashPassword(password);
  createUser(username, hash, true);
  const token = createSessionToken(username);
  setSessionCookie(res, token);
  res.json({ username, is_admin: true, is_approved: true });
});

// POST /api/auth/register — new user registration (requires admin approval)
authRouter.post("/register", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  if (getUserByUsername(username)) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  const hash = await hashPassword(password);
  createUser(username, hash, false);
  res.json({ message: "Account created. Waiting for admin approval." });
});

// POST /api/auth/login
authRouter.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const user = getUserByUsername(username);
  if (!user || !user.password_hash) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (!user.is_approved) {
    res.status(403).json({ error: "Account not yet approved by admin" });
    return;
  }
  const token = createSessionToken(username);
  setSessionCookie(res, token);
  res.json({ username, is_admin: !!user.is_admin, is_approved: !!user.is_approved });
});

// POST /api/auth/logout
authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/users — admin only
authRouter.get("/users", (req: Request, res: Response) => {
  const token = getCookieValue(req, "session");
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
  const username = verifySessionToken(token);
  if (!username) { res.status(401).json({ error: "Session expired" }); return; }
  const user = getUserByUsername(username);
  if (!user?.is_admin) { res.status(403).json({ error: "Admin required" }); return; }
  res.json(getAllUsers());
});

// POST /api/auth/users/:id/approve — admin only
authRouter.post("/users/:id/approve", (req: Request, res: Response) => {
  const token = getCookieValue(req, "session");
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
  const username = verifySessionToken(token);
  if (!username) { res.status(401).json({ error: "Session expired" }); return; }
  const user = getUserByUsername(username);
  if (!user?.is_admin) { res.status(403).json({ error: "Admin required" }); return; }
  approveUser(parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/auth/users/:id — admin only
authRouter.delete("/users/:id", (req: Request, res: Response) => {
  const token = getCookieValue(req, "session");
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
  const username = verifySessionToken(token);
  if (!username) { res.status(401).json({ error: "Session expired" }); return; }
  const user = getUserByUsername(username);
  if (!user?.is_admin) { res.status(403).json({ error: "Admin required" }); return; }
  deleteUser(parseInt(req.params.id));
  res.json({ ok: true });
});
