// Pure, side-effect-free helpers for the visibility allowlist and the Quill Delta
// <-> plain-text boundary. Kept separate from index.ts so they can be unit-tested
// without starting the HTTP server, and so the "single choke point" for
// visibility lives in one small, auditable file.

export interface Delta {
  ops: Array<{ insert: any; attributes?: Record<string, unknown> }>;
}

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

// ── Quill Delta <-> plain text ──────────────────────────────────────────────────

export function textToDelta(text: string): Delta {
  const t = (text ?? "").toString();
  return { ops: [{ insert: t.endsWith("\n") ? t : t + "\n" }] };
}

export function deltaToText(delta: any): string {
  if (!delta) return "";
  const ops = Array.isArray(delta) ? delta : delta.ops ?? [];
  return ops
    .map((o: any) => (typeof o?.insert === "string" ? o.insert : "")) // drop media/embeds
    .join("")
    .trim();
}

// Append text while preserving the existing Delta's ops (and thus formatting).
export function appendTextToDelta(delta: any, text: string): Delta {
  const ops: Delta["ops"] = delta
    ? Array.isArray(delta)
      ? [...delta]
      : [...(delta.ops ?? [])]
    : [];
  let sep = "\n\n";
  if (ops.length === 0) {
    sep = "";
  } else {
    const last = ops[ops.length - 1];
    if (typeof last.insert === "string" && last.insert.endsWith("\n")) sep = "\n";
  }
  const add = (text ?? "").toString();
  ops.push({ insert: sep + (add.endsWith("\n") ? add : add + "\n") });
  return { ops };
}
