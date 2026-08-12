// Tests for markdown -> Quill Delta conversion. The failing real-world case was
// bold labels like **Verbatim:** and blockquotes being stored as literal
// asterisks; these lock in that they become real Delta formatting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, markdownToDelta, appendMarkdownToDelta } from "./markdown.js";

test("bold label (the reported failure) becomes a bold op, no literal asterisks", () => {
  const ops = parseInline("**Verbatim:** he said");
  assert.deepEqual(ops, [
    { insert: "Verbatim:", attributes: { bold: true } },
    { insert: " he said" },
  ]);
  // no op contains raw ** markers
  assert.ok(ops.every((o) => !o.insert.includes("*")));
});

test("italic, inline code, and links", () => {
  assert.deepEqual(parseInline("an *emphasis* word"), [
    { insert: "an " },
    { insert: "emphasis", attributes: { italic: true } },
    { insert: " word" },
  ]);
  assert.deepEqual(parseInline("use `npm test` now"), [
    { insert: "use " },
    { insert: "npm test", attributes: { code: true } },
    { insert: " now" },
  ]);
  assert.deepEqual(parseInline("see [docs](https://x.io)"), [
    { insert: "see " },
    { insert: "docs", attributes: { link: "https://x.io" } },
  ]);
});

test("snake_case and unmatched markers stay literal", () => {
  // underscores inside a word must NOT become italic
  assert.deepEqual(parseInline("content_delta and foo_bar_baz"), [
    { insert: "content_delta and foo_bar_baz" },
  ]);
  // a dangling ** with no closer stays literal
  assert.deepEqual(parseInline("2 ** 3 = 8"), [{ insert: "2 ** 3 = 8" }]);
  // standalone underscores at boundaries still italicize
  assert.deepEqual(parseInline("_hi_"), [{ insert: "hi", attributes: { italic: true } }]);
});

test("heading becomes header attribute on the terminating newline", () => {
  assert.deepEqual(markdownToDelta("### Context").ops, [
    { insert: "Context" },
    { insert: "\n", attributes: { header: 3 } },
  ]);
});

test("blockquote becomes a blockquote block (the verbatim section)", () => {
  assert.deepEqual(markdownToDelta("> quoted advice").ops, [
    { insert: "quoted advice" },
    { insert: "\n", attributes: { blockquote: true } },
  ]);
});

test("bullet and ordered lists", () => {
  assert.deepEqual(markdownToDelta("- one\n- two").ops, [
    { insert: "one" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "two" },
    { insert: "\n", attributes: { list: "bullet" } },
  ]);
  assert.deepEqual(markdownToDelta("1. first\n2. second").ops, [
    { insert: "first" },
    { insert: "\n", attributes: { list: "ordered" } },
    { insert: "second" },
    { insert: "\n", attributes: { list: "ordered" } },
  ]);
});

test("fenced code block", () => {
  assert.deepEqual(markdownToDelta("```\nline1\nline2\n```").ops, [
    { insert: "line1" },
    { insert: "\n", attributes: { "code-block": true } },
    { insert: "line2" },
    { insert: "\n", attributes: { "code-block": true } },
  ]);
});

test("mixed document combines inline + block formatting and ends with newline", () => {
  const { ops } = markdownToDelta("# Title\n\n**Context:** did a thing");
  assert.deepEqual(ops, [
    { insert: "Title" },
    { insert: "\n", attributes: { header: 1 } },
    { insert: "\n" }, // blank line
    { insert: "Context:", attributes: { bold: true } },
    { insert: " did a thing" },
    { insert: "\n" },
  ]);
});

test("plain text with no markdown is preserved and newline-terminated", () => {
  assert.deepEqual(markdownToDelta("just prose").ops, [
    { insert: "just prose" },
    { insert: "\n" },
  ]);
  assert.deepEqual(markdownToDelta("").ops, [{ insert: "\n" }]);
});

test("appendMarkdownToDelta preserves existing ops and separates with a newline", () => {
  const existing = { ops: [{ insert: "first line\n" }] };
  const out = appendMarkdownToDelta(existing, "**bold** add");
  assert.deepEqual(out.ops, [
    { insert: "first line\n" },
    { insert: "bold", attributes: { bold: true } },
    { insert: " add" },
    { insert: "\n" },
  ]);
  // existing not mutated
  assert.deepEqual(existing.ops, [{ insert: "first line\n" }]);
  // adds a trailing newline to base when missing
  const out2 = appendMarkdownToDelta({ ops: [{ insert: "no newline" }] }, "x");
  assert.deepEqual(out2.ops, [
    { insert: "no newline" },
    { insert: "\n" },
    { insert: "x" },
    { insert: "\n" },
  ]);
});
