// Lightweight assertions for the security-critical, side-effect-free logic.
// Run with: npm test  (uses `node --test` on the compiled output).
import { test } from "node:test";
import assert from "node:assert/strict";
import { asList, isVisible, tagNames, deltaToText } from "./visibility.js";

const TAG = "ai";

// Acceptance: an entry tagged `ai` is readable.
test("tagged entry is visible", () => {
  assert.equal(isVisible({ tags: [{ name: "ai" }] }, TAG), true);
  assert.equal(isVisible({ tags: [{ name: "AI" }] }, TAG), true); // case-insensitive
  assert.equal(isVisible({ tags: ["ai"] }, TAG), true); // string tags
  assert.equal(isVisible({ tags: [{ name: "work" }, { name: "ai" }] }, TAG), true);
});

// Acceptance: an entry with no tags is invisible.
test("untagged / other-tagged entry is invisible", () => {
  assert.equal(isVisible({ tags: [] }, TAG), false);
  assert.equal(isVisible({ tags: [{ name: "private" }] }, TAG), false);
});

// Acceptance: simulating a renamed `tags` field returns nothing (fails closed),
// not everything.
test("renamed / missing tags field fails closed", () => {
  assert.equal(isVisible({}, TAG), false); // field missing
  assert.equal(isVisible({ labels: [{ name: "ai" }] }, TAG), false); // renamed
  assert.equal(isVisible({ tags: null }, TAG), false);
  assert.equal(isVisible({ tags: { name: "ai" } }, TAG), false); // restructured to object
  assert.equal(isVisible(null, TAG), false);
  assert.equal(isVisible(undefined, TAG), false);
});

test("asList normalizes arrays and envelopes", () => {
  assert.deepEqual(asList([1, 2]), [1, 2]);
  assert.deepEqual(asList({ items: [1] }), [1]);
  assert.deepEqual(asList({ moments: [2] }), [2]);
  assert.deepEqual(asList({ results: [3] }), [3]);
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList("nope"), []);
});

test("tagNames extracts names from both shapes", () => {
  assert.deepEqual(tagNames({ tags: [{ name: "ai" }, { name: "x" }] }), ["ai", "x"]);
  assert.deepEqual(tagNames({ tags: ["ai", "x"] }), ["ai", "x"]);
  assert.deepEqual(tagNames({}), []);
});

test("deltaToText flattens ops and drops media/embed inserts", () => {
  assert.equal(deltaToText({ ops: [{ insert: "hello world\n" }] }), "hello world");
  // drops non-string (media/embed) inserts, keeps surrounding text
  assert.equal(
    deltaToText({ ops: [{ insert: "a" }, { insert: { image: "x" } }, { insert: "b" }] }),
    "ab"
  );
  assert.equal(deltaToText([{ insert: "array form\n" }]), "array form");
  assert.equal(deltaToText(null), "");
});
