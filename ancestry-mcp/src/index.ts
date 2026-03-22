import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import { existsSync, readFileSync, watchFile, writeFileSync } from "fs";
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

interface EditRecord {
  type:        "added" | "updated" | "deleted";
  entity_type: "individual" | "family";
  timestamp:   string;
  changes?:    Record<string, { from: unknown; to: unknown }>;
  snapshot?:   Individual | Family;  // preserved copy of deleted records
}

interface AncestryData {
  individuals: Record<string, Individual>;
  families:    Record<string, Family>;
  metadata: {
    source_file:       string;
    total_individuals: number;
    total_families:    number;
  };
  _edits: Record<string, EditRecord>;
}

// ── In-Memory Store ────────────────────────────────────────────────────────────

let data: AncestryData = {
  individuals: {},
  families:    {},
  metadata: { source_file: "", total_individuals: 0, total_families: 0 },
  _edits:      {},
};

function loadData(): void {
  if (!existsSync(DATA_PATH)) {
    console.warn(`Data file not found: ${DATA_PATH}`);
    console.warn("Place your Ancestry.com GEDCOM export (.ged file) in the /data directory and restart the container.");
    return;
  }
  try {
    const loaded = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as AncestryData;
    // Ensure _edits always exists even in older JSON files
    data = { _edits: {}, ...loaded };
    const indCount = Object.keys(data.individuals).length;
    const famCount = Object.keys(data.families).length;
    const editCount = Object.keys(data._edits).length;
    console.log(`Loaded ${indCount} individuals, ${famCount} families, ${editCount} pending edits from ${DATA_PATH}`);
  } catch (e: any) {
    console.error(`Failed to load ${DATA_PATH}: ${e.message}`);
  }
}

loadData();

// Prevent reload loop when we write the file ourselves
let selfWrite = false;

// Reload automatically when the JSON file is updated (e.g. after re-running the Python script)
watchFile(DATA_PATH, { interval: 10_000 }, () => {
  if (selfWrite) { selfWrite = false; return; }
  console.log("Data file changed — reloading...");
  loadData();
});

function saveData(): void {
  selfWrite = true;
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ── Edit Helpers ───────────────────────────────────────────────────────────────

function extractYear(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/\b(\d{4})\b/);
  return m ? parseInt(m[1]) : null;
}

function nextIndividualId(): string {
  const nums = Object.keys(data.individuals)
    .map(id => parseInt(id.replace(/[^0-9]/g, "")))
    .filter(n => !isNaN(n));
  return `@I${nums.length > 0 ? Math.max(...nums) + 1 : 1}@`;
}

function nextFamilyId(): string {
  const nums = Object.keys(data.families)
    .map(id => parseInt(id.replace(/[^0-9]/g, "")))
    .filter(n => !isNaN(n));
  return `@F${nums.length > 0 ? Math.max(...nums) + 1 : 1}@`;
}

function recordEdit(id: string, record: EditRecord): void {
  const existing = data._edits[id];

  if (existing?.type === "added" && record.type === "updated") {
    // Newly added record edited further — keep "added" (get_changes returns current state anyway)
    data._edits[id] = { ...existing, timestamp: record.timestamp };
    return;
  }

  if (existing?.type === "updated" && record.type === "updated") {
    // Preserve the original "from" values; only advance the "to" values.
    // If a field is changed back to its original value, remove it from the diff.
    const merged: Record<string, { from: unknown; to: unknown }> = { ...(existing.changes ?? {}) };
    for (const [field, change] of Object.entries(record.changes ?? {})) {
      const prev = merged[field];
      if (prev) {
        if (prev.from === change.to) {
          delete merged[field]; // reverted to original — no net change
        } else {
          merged[field] = { from: prev.from, to: change.to };
        }
      } else {
        merged[field] = change;
      }
    }
    if (Object.keys(merged).length === 0) {
      delete data._edits[id]; // all changes cancelled out
    } else {
      data._edits[id] = { ...record, changes: merged };
    }
    return;
  }

  data._edits[id] = record;
}

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

      const marriages = person.fams.flatMap(famId => {
        const fam = data.families[famId];
        if (!fam) return [];
        const spouseId = person.sex === "M" ? fam.wife : fam.husb;
        return [{
          spouse:         spouseId && data.individuals[spouseId] ? formatPerson(data.individuals[spouseId]) : null,
          marriage_date:  fam.marr_date,
          marriage_place: fam.marr_place,
        }];
      });

      const result = { ...formatPerson(person), marriages };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
      const inds    = Object.values(data.individuals);
      const years   = inds.map(i => i.birth_year).filter((y): y is number => y != null);
      const males   = inds.filter(i => i.sex === "M").length;
      const females = inds.filter(i => i.sex === "F").length;
      const withMarriage = Object.values(data.families).filter(f => f.marr_date != null).length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_individuals:       inds.length,
            total_families:          Object.keys(data.families).length,
            families_with_marriage:  withMarriage,
            males,
            females,
            sex_unknown:             inds.length - males - females,
            birth_year_range:        years.length > 0
              ? { earliest: Math.min(...years), latest: Math.max(...years) }
              : null,
            metadata: data.metadata,
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool: update_person ────────────────────────────────────────────────────
  server.tool(
    "update_person",
    "Update an existing individual's details. Only the fields you provide will change. All edits are tracked so you can review them later.",
    {
      id:          z.string().describe("The individual's GEDCOM ID, e.g. @I123@."),
      name:        z.string().optional().describe("Full name."),
      sex:         z.enum(["M", "F"]).optional().describe("Sex: M or F."),
      birth_date:  z.string().optional().describe("Birth date, e.g. '15 MAR 1932'."),
      birth_place: z.string().optional().describe("Birth place."),
      death_date:  z.string().optional().describe("Death date, e.g. '22 JUN 1998'."),
      death_place: z.string().optional().describe("Death place."),
    },
    async ({ id, name, sex, birth_date, birth_place, death_date, death_place }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);

      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (name        !== undefined && name        !== person.name)        { changes.name        = { from: person.name,        to: name        }; person.name        = name;        }
      if (sex         !== undefined && sex         !== person.sex)         { changes.sex         = { from: person.sex,         to: sex         }; person.sex         = sex;         }
      if (birth_date  !== undefined && birth_date  !== person.birth_date)  { changes.birth_date  = { from: person.birth_date,  to: birth_date  }; person.birth_date  = birth_date;  person.birth_year  = extractYear(birth_date);  }
      if (birth_place !== undefined && birth_place !== person.birth_place) { changes.birth_place = { from: person.birth_place, to: birth_place }; person.birth_place = birth_place; }
      if (death_date  !== undefined && death_date  !== person.death_date)  { changes.death_date  = { from: person.death_date,  to: death_date  }; person.death_date  = death_date;  person.death_year  = extractYear(death_date);  }
      if (death_place !== undefined && death_place !== person.death_place) { changes.death_place = { from: person.death_place, to: death_place }; person.death_place = death_place; }

      if (Object.keys(changes).length === 0)
        return { content: [{ type: "text", text: "No changes made — provided values already match existing data." }] };

      recordEdit(id, { type: "updated", entity_type: "individual", timestamp: new Date().toISOString(), changes });
      saveData();
      return { content: [{ type: "text", text: JSON.stringify({ updated: id, changes }, null, 2) }] };
    }
  );

  // ── Tool: add_person ───────────────────────────────────────────────────────
  server.tool(
    "add_person",
    "Add a new individual to the family tree. Returns the new person's ID. Optionally link them as a child in an existing family.",
    {
      name:             z.string().describe("Full name of the person."),
      sex:              z.enum(["M", "F"]).optional().describe("Sex: M or F."),
      birth_date:       z.string().optional().describe("Birth date, e.g. '15 MAR 1932'."),
      birth_place:      z.string().optional().describe("Birth place."),
      death_date:       z.string().optional().describe("Death date, e.g. '22 JUN 1998'."),
      death_place:      z.string().optional().describe("Death place."),
      parent_family_id: z.string().optional().describe("Family ID to add this person as a child, e.g. @F12@."),
    },
    async ({ name, sex, birth_date, birth_place, death_date, death_place, parent_family_id }) => {
      const id = nextIndividualId();

      const person: Individual = {
        id,
        name:        name ?? null,
        sex:         sex ?? null,
        birth_date:  birth_date  ?? null,
        birth_year:  extractYear(birth_date ?? null),
        birth_place: birth_place ?? null,
        death_date:  death_date  ?? null,
        death_year:  extractYear(death_date ?? null),
        death_place: death_place ?? null,
        fams: [],
        famc: [],
      };

      data.individuals[id] = person;

      if (parent_family_id) {
        const fam = data.families[parent_family_id];
        if (fam) {
          fam.chil.push(id);
          person.famc.push(parent_family_id);
        }
      }

      recordEdit(id, { type: "added", entity_type: "individual", timestamp: new Date().toISOString() });
      saveData();
      return { content: [{ type: "text", text: JSON.stringify({ added: id, person: formatPerson(person) }, null, 2) }] };
    }
  );

  // ── Tool: update_marriage ──────────────────────────────────────────────────
  server.tool(
    "update_marriage",
    "Update the marriage date and/or place for an existing family record. Use get_family to find the family ID.",
    {
      family_id:   z.string().describe("The family's GEDCOM ID, e.g. @F12@."),
      marr_date:   z.string().optional().describe("Marriage date, e.g. '10 JUN 1945'."),
      marr_place:  z.string().optional().describe("Marriage place."),
    },
    async ({ family_id, marr_date, marr_place }) => {
      const fam = data.families[family_id];
      if (!fam) return errorResponse(`No family found with ID: ${family_id}`);

      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (marr_date  !== undefined && marr_date  !== fam.marr_date)  { changes.marr_date  = { from: fam.marr_date,  to: marr_date  }; fam.marr_date  = marr_date;  }
      if (marr_place !== undefined && marr_place !== fam.marr_place) { changes.marr_place = { from: fam.marr_place, to: marr_place }; fam.marr_place = marr_place; }

      if (Object.keys(changes).length === 0)
        return { content: [{ type: "text", text: "No changes made — provided values already match existing data." }] };

      recordEdit(family_id, { type: "updated", entity_type: "family", timestamp: new Date().toISOString(), changes });
      saveData();
      return { content: [{ type: "text", text: JSON.stringify({ updated: family_id, changes }, null, 2) }] };
    }
  );

  // ── Tool: add_marriage ─────────────────────────────────────────────────────
  server.tool(
    "add_marriage",
    "Create a new family record linking two people as spouses. Optionally include marriage date/place and children IDs.",
    {
      husb_id:    z.string().optional().describe("GEDCOM ID of the husband/spouse 1."),
      wife_id:    z.string().optional().describe("GEDCOM ID of the wife/spouse 2."),
      marr_date:  z.string().optional().describe("Marriage date, e.g. '10 JUN 1945'."),
      marr_place: z.string().optional().describe("Marriage place."),
      child_ids:  z.array(z.string()).optional().describe("GEDCOM IDs of children to include in this family."),
    },
    async ({ husb_id, wife_id, marr_date, marr_place, child_ids }) => {
      if (!husb_id && !wife_id) return errorResponse("Provide at least one of husb_id or wife_id.");

      if (husb_id && !data.individuals[husb_id]) return errorResponse(`No individual found with ID: ${husb_id}`);
      if (wife_id && !data.individuals[wife_id]) return errorResponse(`No individual found with ID: ${wife_id}`);

      const famId = nextFamilyId();
      const fam: Family = {
        id:         famId,
        husb:       husb_id  ?? null,
        wife:       wife_id  ?? null,
        chil:       child_ids ?? [],
        marr_date:  marr_date  ?? null,
        marr_place: marr_place ?? null,
      };
      data.families[famId] = fam;

      // Link spouses
      if (husb_id) data.individuals[husb_id].fams.push(famId);
      if (wife_id) data.individuals[wife_id].fams.push(famId);

      // Link children
      for (const childId of (child_ids ?? [])) {
        const child = data.individuals[childId];
        if (child && !child.famc.includes(famId)) child.famc.push(famId);
      }

      recordEdit(famId, { type: "added", entity_type: "family", timestamp: new Date().toISOString() });
      saveData();
      return { content: [{ type: "text", text: JSON.stringify({ added: famId, family: fam }, null, 2) }] };
    }
  );

  // ── Tool: add_child_to_family ──────────────────────────────────────────────
  server.tool(
    "add_child_to_family",
    "Link an existing individual as a child in an existing family record.",
    {
      family_id: z.string().describe("The family's GEDCOM ID, e.g. @F12@."),
      person_id: z.string().describe("The individual's GEDCOM ID to add as a child."),
    },
    async ({ family_id, person_id }) => {
      const fam    = data.families[family_id];
      const person = data.individuals[person_id];
      if (!fam)    return errorResponse(`No family found with ID: ${family_id}`);
      if (!person) return errorResponse(`No individual found with ID: ${person_id}`);
      if (fam.chil.includes(person_id)) return { content: [{ type: "text", text: `${person_id} is already a child in family ${family_id}.` }] };

      fam.chil.push(person_id);
      if (!person.famc.includes(family_id)) person.famc.push(family_id);

      recordEdit(family_id, { type: "updated", entity_type: "family", timestamp: new Date().toISOString(), changes: { chil: { from: fam.chil.filter(c => c !== person_id), to: fam.chil } } });
      saveData();
      return { content: [{ type: "text", text: `Linked ${person.name ?? person_id} as a child in family ${family_id}.` }] };
    }
  );

  // ── Tool: remove_person ────────────────────────────────────────────────────
  server.tool(
    "remove_person",
    "Remove an individual from the family tree. If they were newly added (not from the original GEDCOM), they vanish with no trace. If they came from the original GEDCOM, a 'deleted' entry is tracked so you know to remove them on Ancestry.com too.",
    {
      id: z.string().describe("The individual's GEDCOM ID to remove, e.g. @I123@."),
    },
    async ({ id }) => {
      const person = data.individuals[id];
      if (!person) return errorResponse(`No individual found with ID: ${id}`);

      const wasAdded = data._edits[id]?.type === "added";

      // Clean up family links
      for (const famId of person.fams) {
        const fam = data.families[famId];
        if (fam) {
          if (fam.husb === id) fam.husb = null;
          if (fam.wife === id) fam.wife = null;
        }
      }
      for (const famId of person.famc) {
        const fam = data.families[famId];
        if (fam) fam.chil = fam.chil.filter(c => c !== id);
      }

      delete data.individuals[id];

      if (wasAdded) {
        // Was newly added — remove all trace, nothing to sync
        delete data._edits[id];
      } else {
        // Came from original GEDCOM — track deletion for Ancestry.com sync
        data._edits[id] = {
          type:        "deleted",
          entity_type: "individual",
          timestamp:   new Date().toISOString(),
          snapshot:    person,
        };
      }

      saveData();
      const note = wasAdded ? "Was newly added — no sync needed." : "Deletion tracked for Ancestry.com sync.";
      return { content: [{ type: "text", text: `Removed ${person.name ?? id}. ${note}` }] };
    }
  );

  // ── Tool: get_changes ──────────────────────────────────────────────────────
  server.tool(
    "get_changes",
    "List all edits made to the family tree since the last GEDCOM import: added individuals/families and updated fields.",
    {},
    async () => {
      const edits   = data._edits ?? {};
      const added   = Object.entries(edits).filter(([, e]) => e.type === "added");
      const updated = Object.entries(edits).filter(([, e]) => e.type === "updated");
      const deleted = Object.entries(edits).filter(([, e]) => e.type === "deleted");

      const formatAdded = ([id, e]: [string, EditRecord]) => {
        const record = e.entity_type === "individual" ? data.individuals[id] : data.families[id];
        return { id, entity_type: e.entity_type, timestamp: e.timestamp, record };
      };
      const formatUpdated = ([id, e]: [string, EditRecord]) => ({
        id,
        entity_type: e.entity_type,
        timestamp:   e.timestamp,
        changes:     e.changes,
      });
      const formatDeleted = ([id, e]: [string, EditRecord]) => ({
        id,
        entity_type: e.entity_type,
        timestamp:   e.timestamp,
        snapshot:    e.snapshot,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_edits: Object.keys(edits).length,
            added:   added.map(formatAdded),
            updated: updated.map(formatUpdated),
            deleted: deleted.map(formatDeleted),
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool: clear_changes ────────────────────────────────────────────────────
  server.tool(
    "clear_changes",
    "Clear all tracked edits (added/updated flags). Use this after syncing changes back to Ancestry.com.",
    {},
    async () => {
      const count = Object.keys(data._edits ?? {}).length;
      data._edits = {};
      saveData();
      return { content: [{ type: "text", text: `Cleared ${count} tracked edit(s).` }] };
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
