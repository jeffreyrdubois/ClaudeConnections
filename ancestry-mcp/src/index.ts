import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import { existsSync, readFileSync, watchFile } from "fs";
import { z } from "zod";

// ── Config ─────────────────────────────────────────────────────────────────────

const DATA_PATH         = process.env.DATA_PATH         || "/data/ancestry.json";
const OAUTH_CLIENT_ID   = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const PORT              = parseInt(process.env.PORT || "3000");

// ── Data Types ─────────────────────────────────────────────────────────────────

interface Individual {
  id:          string;
  name:        string | null;
  birth_year:  number | null;
  birth_date:  string | null;
  birth_place: string | null;
  death_year:  number | null;
  death_date:  string | null;
  death_place: string | null;
  sex:         string | null;
  fams:        string[];  // family IDs where this person is a spouse
  famc:        string[];  // family IDs where this person is a child
}

interface Family {
  id:         string;
  husb:       string | null;
  wife:       string | null;
  chil:       string[];
  marr_date:  string | null;
  marr_place: string | null;
}

interface AncestryData {
  individuals: Record<string, Individual>;
  families:    Record<string, Family>;
  metadata: {
    source_file:         string;
    total_before_filter: number;
    total_after_filter:  number;
    filter:              string;
  };
}

// ── In-Memory Store ────────────────────────────────────────────────────────────

let data: AncestryData = {
  individuals: {},
  families:    {},
  metadata: { source_file: "", total_before_filter: 0, total_after_filter: 0, filter: "" },
};

function loadData(): void {
  if (!existsSync(DATA_PATH)) {
    console.warn(`Data file not found: ${DATA_PATH}`);
    console.warn("Place your Ancestry.com GEDCOM export at /data/ancestry.ged and restart the container.");
    return;
  }
  try {
    data = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as AncestryData;
    const indCount = Object.keys(data.individuals).length;
    const famCount = Object.keys(data.families).length;
    console.log(`Loaded ${indCount} individuals and ${famCount} families from ${DATA_PATH}`);
  } catch (e: any) {
    console.error(`Failed to load ${DATA_PATH}: ${e.message}`);
  }
}

loadData();

// Reload automatically when the JSON file is updated (e.g. after re-running the Python script)
watchFile(DATA_PATH, { interval: 10_000 }, () => {
  console.log("Data file changed — reloading...");
  loadData();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPerson(ind: Individual) {
  return {
    id:          ind.id,
    name:        ind.name ?? "Unknown",
    sex:         ind.sex,
    birth:       ind.birth_date ?? (ind.birth_year != null ? String(ind.birth_year) : null),
    birth_place: ind.birth_place,
    death:       ind.death_date ?? (ind.death_year != null ? String(ind.death_year) : null),
    death_place: ind.death_place,
  };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ── MCP Server Factory ─────────────────────────────────────────────────────────
// A new McpServer instance is created per HTTP request (stateless transport).

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ancestry-mcp-server", version: "1.0.0" });

  // ── Tool: search_people ────────────────────────────────────────────────────
  server.tool(
    "search_people",
    "Search the family tree by name, birth-year range, and/or sex. Returns matching individuals with basic details.",
    {
      name: z.string().optional().describe(
        "Name fragment to search for (case-insensitive, partial match)."
      ),
      birth_year_min: z.number().optional().describe(
        "Minimum birth year (inclusive)."
      ),
      birth_year_max: z.number().optional().describe(
        "Maximum birth year (inclusive)."
      ),
      sex: z.enum(["M", "F"]).optional().describe(
        "Sex filter: M for male, F for female."
      ),
      limit: z.number().optional().describe(
        "Maximum results to return (default 20)."
      ),
    },
    async ({ name, birth_year_min, birth_year_max, sex, limit }) => {
      let results = Object.values(data.individuals);

      if (name) {
        const lower = name.toLowerCase();
        results = results.filter(p => p.name?.toLowerCase().includes(lower));
      }
      if (birth_year_min !== undefined) {
        results = results.filter(p => p.birth_year != null && p.birth_year >= birth_year_min);
      }
      if (birth_year_max !== undefined) {
        results = results.filter(p => p.birth_year != null && p.birth_year <= birth_year_max);
      }
      if (sex) {
        results = results.filter(p => p.sex === sex);
      }

      // Sort by birth year ascending, unknowns last
      results.sort((a, b) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999));
      results = results.slice(0, limit ?? 20);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: results.length, people: results.map(formatPerson) }, null, 2),
        }],
      };
    }
  );

  // ── Tool: get_person ───────────────────────────────────────────────────────
  server.tool(
    "get_person",
    "Get full details for a specific individual by their GEDCOM ID (e.g. @I123@). Use search_people first to find IDs.",
    {
      id: z.string().describe("The individual's GEDCOM ID, e.g. @I123@."),
    },
    async ({ id }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);
      return { content: [{ type: "text", text: JSON.stringify(formatPerson(person), null, 2) }] };
    }
  );

  // ── Tool: get_family ───────────────────────────────────────────────────────
  server.tool(
    "get_family",
    "Get the immediate family of a person: their parents, siblings, spouses (with marriage info), and children.",
    {
      id: z.string().describe("The individual's GEDCOM ID, e.g. @I123@."),
    },
    async ({ id }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);

      const result: {
        person: ReturnType<typeof formatPerson>;
        parents: ReturnType<typeof formatPerson>[];
        siblings: ReturnType<typeof formatPerson>[];
        spouses: (ReturnType<typeof formatPerson> & { marriage_date: string | null; marriage_place: string | null })[];
        children: ReturnType<typeof formatPerson>[];
      } = {
        person:   formatPerson(person),
        parents:  [],
        siblings: [],
        spouses:  [],
        children: [],
      };

      // Parents and siblings come from the family(-ies) in which this person is a child
      for (const famId of person.famc) {
        const fam = data.families[famId];
        if (!fam) continue;
        if (fam.husb && data.individuals[fam.husb]) result.parents.push(formatPerson(data.individuals[fam.husb]));
        if (fam.wife && data.individuals[fam.wife]) result.parents.push(formatPerson(data.individuals[fam.wife]));
        for (const sibId of fam.chil) {
          if (sibId !== id && data.individuals[sibId]) {
            result.siblings.push(formatPerson(data.individuals[sibId]));
          }
        }
      }

      // Spouses and children come from the family(-ies) in which this person is a spouse
      for (const famId of person.fams) {
        const fam = data.families[famId];
        if (!fam) continue;
        const spouseId = person.sex === "M" ? fam.wife : fam.husb;
        if (spouseId && data.individuals[spouseId]) {
          result.spouses.push({
            ...formatPerson(data.individuals[spouseId]),
            marriage_date:  fam.marr_date,
            marriage_place: fam.marr_place,
          });
        }
        for (const childId of fam.chil) {
          if (data.individuals[childId]) result.children.push(formatPerson(data.individuals[childId]));
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Tool: get_ancestors ────────────────────────────────────────────────────
  server.tool(
    "get_ancestors",
    "Get the ancestor tree of a person up to N generations back (default 3, max 6).",
    {
      id:          z.string().describe("The individual's GEDCOM ID."),
      generations: z.number().optional().describe("Generations to go back (default 3, max 6)."),
    },
    async ({ id, generations }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);

      const maxGen = Math.min(generations ?? 3, 6);

      interface Node { person: ReturnType<typeof formatPerson>; generation: number; father?: Node; mother?: Node }

      function buildTree(personId: string, gen: number): Node | null {
        const p = data.individuals[personId];
        if (!p) return null;
        const node: Node = { person: formatPerson(p), generation: gen };
        if (gen < maxGen && p.famc.length > 0) {
          const fam = data.families[p.famc[0]];
          if (fam) {
            if (fam.husb) { const f = buildTree(fam.husb, gen + 1); if (f) node.father = f; }
            if (fam.wife) { const m = buildTree(fam.wife, gen + 1); if (m) node.mother = m; }
          }
        }
        return node;
      }

      return { content: [{ type: "text", text: JSON.stringify(buildTree(id, 0), null, 2) }] };
    }
  );

  // ── Tool: get_descendants ──────────────────────────────────────────────────
  server.tool(
    "get_descendants",
    "Get the descendant tree of a person up to N generations forward (default 3, max 6).",
    {
      id:          z.string().describe("The individual's GEDCOM ID."),
      generations: z.number().optional().describe("Generations to go forward (default 3, max 6)."),
    },
    async ({ id, generations }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);

      const maxGen = Math.min(generations ?? 3, 6);
      const visited = new Set<string>();

      interface Node { person: ReturnType<typeof formatPerson>; generation: number; children?: Node[] }

      function buildTree(personId: string, gen: number): Node | null {
        if (visited.has(personId)) return null;
        visited.add(personId);
        const p = data.individuals[personId];
        if (!p) return null;
        const node: Node = { person: formatPerson(p), generation: gen };
        if (gen < maxGen) {
          const childNodes: Node[] = [];
          for (const famId of p.fams) {
            const fam = data.families[famId];
            if (fam) {
              for (const childId of fam.chil) {
                const child = buildTree(childId, gen + 1);
                if (child) childNodes.push(child);
              }
            }
          }
          if (childNodes.length > 0) node.children = childNodes;
        }
        return node;
      }

      return { content: [{ type: "text", text: JSON.stringify(buildTree(id, 0), null, 2) }] };
    }
  );

  // ── Tool: get_summary ─────────────────────────────────────────────────────
  server.tool(
    "get_summary",
    "Get a high-level summary of the loaded family tree: total people, date range, sex breakdown, and metadata.",
    {},
    async () => {
      const inds   = Object.values(data.individuals);
      const years  = inds.map(i => i.birth_year).filter((y): y is number => y != null);
      const males  = inds.filter(i => i.sex === "M").length;
      const females = inds.filter(i => i.sex === "F").length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_individuals: inds.length,
            total_families:    Object.keys(data.families).length,
            males,
            females,
            sex_unknown:       inds.length - males - females,
            birth_year_range:  years.length > 0
              ? { earliest: Math.min(...years), latest: Math.max(...years) }
              : null,
            metadata: data.metadata,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ── Express App ────────────────────────────────────────────────────────────────

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
    status:       "ok",
    service:      "ancestry-mcp-server",
    individuals:  Object.keys(data.individuals).length,
    families:     Object.keys(data.families).length,
  });
});

// ── OAuth 2.0 ──────────────────────────────────────────────────────────────────

const authCodes = new Map<string, {
  redirectUri:          string;
  codeChallenge?:       string;
  codeChallengeMethod?: string;
  expiresAt:            number;
}>();

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const base = `https://${_req.headers.host}`;
  res.json({
    issuer:                               base,
    authorization_endpoint:              `${base}/authorize`,
    token_endpoint:                       `${base}/oauth/token`,
    grant_types_supported:               ["authorization_code", "client_credentials"],
    response_types_supported:            ["code"],
    code_challenge_methods_supported:    ["S256", "plain"],
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
    redirectUri:         redirect_uri,
    codeChallenge:       code_challenge,
    codeChallengeMethod: code_challenge_method,
    expiresAt:           Date.now() + 60_000,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", express.urlencoded({ extended: false }), (req: Request, res: Response) => {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    res.status(501).json({ error: "OAuth not configured on this server" });
    return;
  }

  const { grant_type, client_id, client_secret, code, code_verifier } = req.body;

  if (grant_type === "authorization_code") {
    const stored = authCodes.get(code);
    if (!stored || stored.expiresAt < Date.now()) { res.status(401).json({ error: "invalid_grant" }); return; }

    if (stored.codeChallenge) {
      if (!code_verifier) {
        res.status(401).json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }
      const method  = stored.codeChallengeMethod ?? "plain";
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

// ── MCP Endpoint ───────────────────────────────────────────────────────────────

async function handleMcp(req: Request, res: Response) {
  const server    = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("finish", () => { transport.close(); server.close(); });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp",    requireAuth, handleMcp);
app.get("/mcp",     requireAuth, handleMcp);
app.delete("/mcp",  (_req, res) => res.status(405).json({ error: "Method not allowed" }));

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Ancestry MCP Server running on port ${PORT}`);
  console.log(`OAuth enabled: ${!!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET)}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
