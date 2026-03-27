import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import * as ynab from "ynab";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────
// Config is read from env vars first, then persisted to /config/config.json so
// that settings survive container recreation (e.g. Unraid auto-updates).

const CONFIG_DIR = process.env.CONFIG_DIR || "/config";
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface SavedConfig {
  ynabApiToken?: string;
  ynabBudgetId?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

function loadConfig(): SavedConfig {
  const fromEnv: SavedConfig = {
    ynabApiToken: process.env.YNAB_API_TOKEN || undefined,
    ynabBudgetId: process.env.YNAB_BUDGET_ID || undefined,
    oauthClientId: process.env.OAUTH_CLIENT_ID || undefined,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || undefined,
  };

  // If env vars supply the token, persist them to disk so future restarts work
  // even if the container is recreated without env vars (e.g. Unraid updates).
  if (fromEnv.ynabApiToken) {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const toSave: SavedConfig = {};
      if (fromEnv.ynabApiToken) toSave.ynabApiToken = fromEnv.ynabApiToken;
      if (fromEnv.ynabBudgetId) toSave.ynabBudgetId = fromEnv.ynabBudgetId;
      if (fromEnv.oauthClientId) toSave.oauthClientId = fromEnv.oauthClientId;
      if (fromEnv.oauthClientSecret) toSave.oauthClientSecret = fromEnv.oauthClientSecret;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 });
      console.log(`Config saved to ${CONFIG_FILE}`);
    } catch (e) {
      console.warn("Warning: Could not save config to file:", e);
    }
    return fromEnv;
  }

  // No token in env — try the persisted config file.
  try {
    const saved: SavedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    console.log(`Config loaded from ${CONFIG_FILE}`);
    return {
      ynabApiToken: saved.ynabApiToken,
      ynabBudgetId: saved.ynabBudgetId,
      oauthClientId: saved.oauthClientId,
      oauthClientSecret: saved.oauthClientSecret,
    };
  } catch {
    // No file yet — env vars were also empty.
    return fromEnv;
  }
}

const config = loadConfig();

const YNAB_API_TOKEN = config.ynabApiToken;
const YNAB_BUDGET_ID = config.ynabBudgetId || "last-used";
const OAUTH_CLIENT_ID = config.oauthClientId;
const OAUTH_CLIENT_SECRET = config.oauthClientSecret;
const PORT = parseInt(process.env.PORT || "3000");

if (!YNAB_API_TOKEN) {
  console.error("ERROR: YNAB_API_TOKEN is required. Set it via the Unraid template or YNAB_API_TOKEN env var.");
  process.exit(1);
}

const ynabAPI = new ynab.API(YNAB_API_TOKEN);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(milliunits: number): string {
  return (milliunits / 1000).toFixed(2);
}

function currentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ── MCP Server Factory ────────────────────────────────────────────────────────
// A new server instance is created per request (stateless mode).

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-ynab",
    version: "1.0.0",
  });

  // ── Tool: get_accounts ──────────────────────────────────────────────────────
  server.tool(
    "get_accounts",
    "Get all budget accounts and their current balances (checking, savings, credit cards, loans, etc.)",
    {},
    async () => {
      try {
        const response = await ynabAPI.accounts.getAccounts(YNAB_BUDGET_ID);
        const accounts = response.data.accounts.filter((a) => !a.deleted && !a.closed);

        const formatted = accounts.map((a) => ({
          name: a.name,
          type: a.type,
          balance: `$${formatCurrency(a.balance)}`,
          cleared_balance: `$${formatCurrency(a.cleared_balance)}`,
          uncleared_balance: `$${formatCurrency(a.uncleared_balance)}`,
          on_budget: a.on_budget,
        }));

        const onBudget = accounts.filter((a) => a.on_budget);
        const offBudget = accounts.filter((a) => !a.on_budget);
        const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0);

        const summary = {
          net_worth: `$${formatCurrency(netWorth)}`,
          on_budget_accounts: formatted.filter((a) => a.on_budget),
          off_budget_accounts: formatted.filter((a) => !a.on_budget),
          totals: {
            on_budget_count: onBudget.length,
            off_budget_count: offBudget.length,
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (e: any) {
        return errorResponse(e?.error?.detail ?? e.message ?? "Unknown YNAB error");
      }
    }
  );

  // ── Tool: get_budget_month ──────────────────────────────────────────────────
  server.tool(
    "get_budget_month",
    "Get income, spending, and category-level budget vs actual for a given month. Defaults to the current month.",
    {
      month: z
        .string()
        .optional()
        .describe("Month in YYYY-MM-DD format (use the 1st of the month). Defaults to current month."),
    },
    async ({ month }) => {
      try {
        const targetMonth = month || currentMonthString();
        const response = await ynabAPI.months.getBudgetMonth(YNAB_BUDGET_ID, targetMonth);
        const m = response.data.month;

        const categories = m.categories
          .filter((c) => !c.deleted && !c.hidden)
          .map((c) => ({
            category_group: c.category_group_name,
            name: c.name,
            budgeted: `$${formatCurrency(c.budgeted)}`,
            activity: `$${formatCurrency(c.activity)}`,
            balance: `$${formatCurrency(c.balance)}`,
            goal_type: c.goal_type ?? null,
            goal_percentage_complete: c.goal_percentage_complete ?? null,
          }));

        const result = {
          month: m.month,
          income: `$${formatCurrency(m.income)}`,
          budgeted: `$${formatCurrency(m.budgeted)}`,
          activity: `$${formatCurrency(m.activity)}`,
          to_be_budgeted: `$${formatCurrency(m.to_be_budgeted)}`,
          categories,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return errorResponse(e?.error?.detail ?? e.message ?? "Unknown YNAB error");
      }
    }
  );

  // ── Tool: get_transactions ──────────────────────────────────────────────────
  server.tool(
    "get_transactions",
    "Get transactions from the budget with optional filters by date range, account name, or category name.",
    {
      since_date: z
        .string()
        .optional()
        .describe("Only return transactions on or after this date (YYYY-MM-DD). Defaults to start of current month."),
      until_date: z
        .string()
        .optional()
        .describe("Only return transactions on or before this date (YYYY-MM-DD)."),
      account_name: z
        .string()
        .optional()
        .describe("Filter to transactions from a specific account (partial match)."),
      category_name: z
        .string()
        .optional()
        .describe("Filter to transactions in a specific category (partial match)."),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of transactions to return. Defaults to 50."),
    },
    async ({ since_date, until_date, account_name, category_name, limit }) => {
      try {
        const sinceDate = since_date || currentMonthString();
        const response = await ynabAPI.transactions.getTransactions(
          YNAB_BUDGET_ID,
          sinceDate
        );

        let transactions = response.data.transactions.filter((t) => !t.deleted);

        if (until_date) {
          transactions = transactions.filter((t) => t.date <= until_date);
        }
        if (account_name) {
          const lower = account_name.toLowerCase();
          transactions = transactions.filter((t) =>
            t.account_name.toLowerCase().includes(lower)
          );
        }
        if (category_name) {
          const lower = category_name.toLowerCase();
          transactions = transactions.filter(
            (t) => t.category_name?.toLowerCase().includes(lower)
          );
        }

        // Sort newest first
        transactions.sort((a, b) => b.date.localeCompare(a.date));
        transactions = transactions.slice(0, limit ?? 50);

        const formatted = transactions.map((t) => ({
          date: t.date,
          payee: t.payee_name,
          category: t.category_name ?? "Uncategorized",
          account: t.account_name,
          amount: `$${formatCurrency(t.amount)}`,
          memo: t.memo ?? null,
          cleared: t.cleared,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { count: formatted.length, transactions: formatted },
                null,
                2
              ),
            },
          ],
        };
      } catch (e: any) {
        return errorResponse(e?.error?.detail ?? e.message ?? "Unknown YNAB error");
      }
    }
  );

  // ── Tool: get_category_groups ───────────────────────────────────────────────
  server.tool(
    "get_category_groups",
    "Get all budget category groups and their categories with current month budgeted/activity/balance figures.",
    {},
    async () => {
      try {
        const [catResponse, monthResponse] = await Promise.all([
          ynabAPI.categories.getCategories(YNAB_BUDGET_ID),
          ynabAPI.months.getBudgetMonth(YNAB_BUDGET_ID, currentMonthString()),
        ]);

        // Build a quick lookup for current month category data
        const monthCats = new Map(
          monthResponse.data.month.categories.map((c) => [c.id, c])
        );

        const groups = catResponse.data.category_groups
          .filter((g) => !g.deleted && g.name !== "Internal Master Category")
          .map((g) => ({
            group: g.name,
            categories: g.categories
              .filter((c) => !c.deleted && !c.hidden)
              .map((c) => {
                const mc = monthCats.get(c.id);
                return {
                  name: c.name,
                  budgeted: mc ? `$${formatCurrency(mc.budgeted)}` : "$0.00",
                  activity: mc ? `$${formatCurrency(mc.activity)}` : "$0.00",
                  balance: mc ? `$${formatCurrency(mc.balance)}` : "$0.00",
                  goal_type: c.goal_type ?? null,
                };
              }),
          }));

        return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
      } catch (e: any) {
        return errorResponse(e?.error?.detail ?? e.message ?? "Unknown YNAB error");
      }
    }
  );

  // ── Tool: get_budget_summary ────────────────────────────────────────────────
  server.tool(
    "get_budget_summary",
    "Get a high-level overview of the budget: name, currency, current month income vs spending, and net worth.",
    {},
    async () => {
      try {
        const [budgetResponse, accountResponse, monthResponse] = await Promise.all([
          ynabAPI.budgets.getBudgetById(YNAB_BUDGET_ID),
          ynabAPI.accounts.getAccounts(YNAB_BUDGET_ID),
          ynabAPI.months.getBudgetMonth(YNAB_BUDGET_ID, currentMonthString()),
        ]);

        const budget = budgetResponse.data.budget;
        const accounts = accountResponse.data.accounts.filter(
          (a) => !a.deleted && !a.closed
        );
        const month = monthResponse.data.month;

        const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0);

        const summary = {
          budget_name: budget.name,
          currency: budget.currency_format?.iso_code ?? "USD",
          current_month: month.month,
          income_this_month: `$${formatCurrency(month.income)}`,
          spending_this_month: `$${formatCurrency(Math.abs(month.activity))}`,
          net_this_month: `$${formatCurrency(month.income + month.activity)}`,
          to_be_budgeted: `$${formatCurrency(month.to_be_budgeted)}`,
          net_worth: `$${formatCurrency(netWorth)}`,
          account_count: accounts.length,
        };

        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (e: any) {
        return errorResponse(e?.error?.detail ?? e.message ?? "Unknown YNAB error");
      }
    }
  );

  return server;
}

// ── Express App ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

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
  res.json({ status: "ok", service: "mcp-ynab" });
});

// ── OAuth 2.0 ─────────────────────────────────────────────────────────────────

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

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`YNAB MCP Server running on port ${PORT}`);
  console.log(`Budget ID: ${YNAB_BUDGET_ID}`);
  console.log(`OAuth enabled: ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET)}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
