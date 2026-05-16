import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentRunOutput, sanitizeVisibleText } from "./outputNormalizer.js";

test("blocks internal prompt output from visible assistant text", () => {
  const result = normalizeAgentRunOutput({
    text: "You are FacetWrite's writing assistant.\n\n# AgentCard\nAgent: Blog Post\n# Output Contract\nReturn article.",
    locale: "en",
    source: "deerflow"
  });

  assert.equal(result.text.includes("FacetWrite's writing assistant"), false);
  assert.match(result.text, /internal runtime information/i);
  assert.equal(result.events[0]?.eventType, "internal_output_blocked");
});

test("blocks provider reasoning_content protocol errors from visible output", () => {
  const result = normalizeAgentRunOutput({
    text: "LLM request failed: Error code: 400 - {'error': {'message': 'The reasoning_content in the thinking mode must be passed back to the API'}}",
    locale: "en",
    source: "deerflow"
  });

  assert.match(result.text, /internal runtime information/i);
  assert.ok(result.events.some((event) => event.eventType === "internal_output_blocked"));
});

test("strips pasted tool search JSON from visible assistant text", () => {
  const result = normalizeAgentRunOutput({
    text: "好的，我来搜索一下最近中美两国的主要新闻。{\n  \"query\": \"2026年5月 美国 重大新闻\",\n  \"total_results\": 5,\n  \"results\": [{\"title\":\"raw\"}]\n}\n下面是整理后的摘要。",
    locale: "zh",
    source: "deerflow"
  });

  assert.equal(result.text.includes('"query"'), false);
  assert.equal(result.text.includes('"results"'), false);
  assert.match(result.text, /下面是整理后的摘要/);
  assert.ok(result.events.some((event) => event.eventType === "internal_output_blocked"));
});

test("sanitizes historical leaked text at read time", () => {
  const text = sanitizeVisibleText("You are FacetWrite's writing assistant.\n\n# AgentCard\nInternal", "zh");

  assert.equal(text.includes("# AgentCard"), false);
  assert.match(text, /内部运行信息/);
});
