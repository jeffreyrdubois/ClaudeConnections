// Markdown -> Quill Delta conversion for the write path.
//
// Journiv stores entry bodies as a Quill Delta and its API accepts ONLY
// content_delta (no markdown/format field). Any client — Claude especially —
// naturally emits markdown into a "body text" field, so without this the
// asterisks etc. get stored as literal characters and render as punctuation.
// We parse the common subset into real Delta formatting; anything we don't
// recognize falls through as plain text (never corrupted).
//
// Delta model: inline formatting is an attribute on a text op
// ({insert:"x", attributes:{bold:true}}); block formatting is an attribute on
// the newline that TERMINATES the block ({insert:"\n", attributes:{header:2}}).
// Side-effect-free so it can be unit-tested without the server.

export interface Op {
  insert: string;
  attributes?: Record<string, unknown>;
}
export interface Delta {
  ops: Op[];
}

interface InlinePattern {
  re: RegExp;
  attr?: Record<string, unknown>;
  link?: boolean;
  boundary?: boolean; // require word-boundary around the match (for _ / __)
}

// Order matters: code first (its content is literal), then bold before italic
// so `**` is consumed before a single `*`.
const INLINE: InlinePattern[] = [
  { re: /^`([^`]+)`/, attr: { code: true } },
  { re: /^\*\*([^*]+)\*\*/, attr: { bold: true } },
  { re: /^__([^_]+)__/, attr: { bold: true }, boundary: true },
  { re: /^\[([^\]]+)\]\(([^)\s]+)\)/, link: true },
  { re: /^\*([^*]+)\*/, attr: { italic: true } },
  { re: /^_([^_]+)_/, attr: { italic: true }, boundary: true },
];

// Parse one line of inline markdown into ops. Unmatched markers stay literal.
export function parseInline(text: string): Op[] {
  const ops: Op[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      ops.push({ insert: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let matched = false;
    for (const p of INLINE) {
      const m = rest.match(p.re);
      if (!m) continue;
      if (p.boundary) {
        const prev = i === 0 ? "" : text[i - 1];
        const after = text[i + m[0].length] ?? "";
        const prevOk = prev === "" || /\W/.test(prev);
        const afterOk = after === "" || /\W/.test(after);
        if (!prevOk || !afterOk) continue; // e.g. snake_case — leave literal
      }
      flush();
      if (p.link) {
        ops.push({ insert: m[1], attributes: { link: m[2] } });
      } else {
        ops.push({ insert: m[1], attributes: { ...p.attr } });
      }
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      buffer += text[i];
      i++;
    }
  }
  flush();
  return ops;
}

function endsWithNewline(ops: Op[]): boolean {
  if (ops.length === 0) return false;
  const last = ops[ops.length - 1];
  return typeof last.insert === "string" && last.insert.endsWith("\n");
}

// Convert a markdown string into a Quill Delta.
export function markdownToDelta(md: string): Delta {
  const src = (md ?? "").toString().replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const ops: Op[] = [];

  const pushBlock = (inlineOps: Op[], attrs?: Record<string, unknown>) => {
    for (const op of inlineOps) ops.push(op);
    ops.push(attrs ? { insert: "\n", attributes: attrs } : { insert: "\n" });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ``` ... ```
    if (/^\s*```/.test(line)) {
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        ops.push({ insert: lines[i] });
        ops.push({ insert: "\n", attributes: { "code-block": true } });
        i++;
      }
      i++; // skip closing fence (if present)
      continue;
    }

    // Blank line -> paragraph spacing
    if (line.trim() === "") {
      ops.push({ insert: "\n" });
      i++;
      continue;
    }

    // Horizontal rule -> treat as a blank separator (no literal dashes)
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      ops.push({ insert: "\n" });
      i++;
      continue;
    }

    // ATX heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      pushBlock(parseInline(h[2].trim()), { header: h[1].length });
      i++;
      continue;
    }

    // Blockquote
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      pushBlock(parseInline(bq[1]), { blockquote: true });
      i++;
      continue;
    }

    // Unordered list item
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      pushBlock(parseInline(ul[1]), { list: "bullet" });
      i++;
      continue;
    }

    // Ordered list item
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      pushBlock(parseInline(ol[1]), { list: "ordered" });
      i++;
      continue;
    }

    // Plain paragraph line
    pushBlock(parseInline(line));
    i++;
  }

  // A Quill Delta must end with a newline.
  if (!endsWithNewline(ops)) ops.push({ insert: "\n" });
  return { ops };
}

// Append markdown text to an existing Delta, preserving the existing ops (and
// their formatting) and separating cleanly with a newline.
export function appendMarkdownToDelta(existing: any, text: string): Delta {
  const base: Op[] = existing
    ? Array.isArray(existing)
      ? [...existing]
      : [...(existing.ops ?? [])]
    : [];
  if (base.length > 0 && !endsWithNewline(base)) base.push({ insert: "\n" });
  const added = markdownToDelta(text).ops;
  return { ops: [...base, ...added] };
}
