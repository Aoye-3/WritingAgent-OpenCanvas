import test from "node:test";
import assert from "node:assert/strict";
import { createProgressiveTextGate, splitIntoUiChunks, splitProgressiveTextForTest } from "./services/generation/progressiveTextGate.js";

test("progressive gate releases small UI chunks that preserve the full text", () => {
  const text = "This opening paragraph is long enough to pass the initial safety buffer. It keeps adding useful context so the browser can begin rendering before the whole answer is done.\n\nThe second paragraph should also arrive as smaller pieces instead of one large block.";
  const chunks = splitProgressiveTextForTest(text, "en");

  assert.ok(chunks.length > 2);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("progressive gate releases bullet and numbered content without dropping text", () => {
  const text = "The answer starts with enough context to pass the safety buffer before listing concrete items.\n- First item explains the background and key facts.\n- Second item explains risks and next steps.\n1. Third item adds an implementation recommendation.\n";
  const chunks = splitProgressiveTextForTest(text, "en");

  assert.equal(chunks.join(""), text);
  assert.ok(chunks.some((chunk) => chunk.includes("- First")));
  assert.ok(chunks.some((chunk) => chunk.includes("1. Third")));
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("progressive gate splits very long sentences instead of waiting for the final response", () => {
  const longText = "This is a very long generated sentence with no friendly paragraph boundary ".repeat(35);
  const chunks = splitProgressiveTextForTest(longText, "en");

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), longText);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("progressive gate flush splits a final large remainder into UI chunks", () => {
  const text = "Final-only output can arrive after the upstream runtime buffered everything, but the UI still needs small chunks for a visible typewriter effect. ".repeat(4);
  const chunks: string[] = [];
  const gate = createProgressiveTextGate("en", (chunk) => chunks.push(chunk));

  gate.push(text.slice(0, 40));
  gate.push(text.slice(40));
  gate.flush();

  assert.equal(chunks.join(""), text);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("progressive gate blocks internal runtime output", () => {
  const chunks: string[] = [];
  const gate = createProgressiveTextGate("zh", (chunk) => chunks.push(chunk));

  gate.push("FacetWrite runtime context\n# AgentCard\n# Output Contract\n");
  gate.flush();

  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /内部运行信息|blocked/);
});

test("splitIntoUiChunks never returns a single large chunk for long text", () => {
  const chunks = splitIntoUiChunks("A final response can be large even when it is not truly streamed. ".repeat(6));

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("progressive gate blocks AgentBackend provider-unavailable messages", () => {
  const chunks = splitProgressiveTextForTest(
    "The configured LLM provider is temporarily unavailable after multiple retries. Please wait a moment and continue the conversation.",
    "en"
  );

  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /blocked/i);
});
