// Pure, side-effect-free helpers for the visibility allowlist and reading Quill
// Deltas back to plain text. Kept separate from index.ts so they can be
// unit-tested without starting the HTTP server, and so the "single choke point"
// for visibility lives in one small, auditable file. (Markdown -> Delta for the
// write path lives in markdown.ts.)

// Journiv list endpoints have returned bare arrays and, in places, an envelope.
// Normalize both so one API-shape change doesn't silently break every tool.
export function asList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  return data.items ?? data.moments ?? data.results ?? data.data ?? [];
}

// The allowlist. Only entries carrying `requiredTag` (compared case-insensitively)
// are visible. Fails CLOSED: if the `tags` field is missing or is not an array
// — e.g. a Journiv upgrade renamed or restructured it — this returns false
// (private), never true. Better to show nothing than to leak everything.
export function isVisible(moment: any, requiredTag: string): boolean {
  const req = requiredTag.toLowerCase();
  const tags = moment?.tags;
  if (tags == null || !Array.isArray(tags)) return false;
  return tags.some((t: any) => {
    const name = typeof t === "string" ? t : t?.name;
    return typeof name === "string" && name.toLowerCase() === req;
  });
}

export function tagNames(moment: any): string[] {
  const tags = moment?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.map((t: any) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
}

// ── Quill Delta -> plain text ───────────────────────────────────────────────────

// Flatten a Quill Delta to plain text for display, dropping media/embed inserts.
export function deltaToText(delta: any): string {
  if (!delta) return "";
  const ops = Array.isArray(delta) ? delta : delta.ops ?? [];
  return ops
    .map((o: any) => (typeof o?.insert === "string" ? o.insert : "")) // drop media/embeds
    .join("")
    .trim();
}
