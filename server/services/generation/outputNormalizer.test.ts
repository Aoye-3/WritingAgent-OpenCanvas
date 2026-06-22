import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentRunOutput, sanitizeVisibleText } from "./outputNormalizer.js";

test("blocks internal prompt output from visible assistant text", () => {
  const result = normalizeAgentRunOutput({
    text: "You are FacetWrite's writing assistant.\n\n# AgentCard\nAgent: Blog Post\n# Output Contract\nReturn article.",
    locale: "en",
    source: "agent-backend"
  });

  assert.equal(result.text.includes("FacetWrite's writing assistant"), false);
  assert.match(result.text, /internal runtime information/i);
  assert.equal(result.events[0]?.eventType, "internal_output_blocked");
});

test("blocks provider reasoning_content protocol errors from visible output", () => {
  const result = normalizeAgentRunOutput({
    text: "LLM request failed: Error code: 400 - {'error': {'message': 'The reasoning_content in the thinking mode must be passed back to the API'}}",
    locale: "en",
    source: "agent-backend"
  });

  assert.match(result.text, /internal runtime information/i);
  assert.ok(result.events.some((event) => event.eventType === "internal_output_blocked"));
});

test("blocks leaked Agent Runtime DSML tool calls from skill runs", () => {
  const result = normalizeAgentRunOutput({
    text: '< | | DSML | | toolcalls> < / | / DSML | / invoke name="readfile"> < | | DSML | | parameter name="filepath" string="true">/mnt/skills/public/systematic-literature-review/SKILL.md</ / | / DSML | / parameter> < / | / DSML | / invoke> < / | / DSML | / toolcalls>',
    locale: "zh",
    source: "agent-backend"
  });

  assert.equal(result.text.includes("readfile"), false);
  assert.equal(result.text.includes("SKILL.md"), false);
  assert.match(result.text, /内部运行信息/);
  assert.ok(result.events.some((event) => event.eventType === "internal_output_blocked"));
});

test("blocks AgentBackend provider-unavailable fallback messages", () => {
  const result = normalizeAgentRunOutput({
    text: "The configured LLM provider is temporarily unavailable after multiple retries. Please wait a moment and continue the conversation.",
    locale: "en",
    source: "agent-backend"
  });

  assert.match(result.text, /internal runtime information/i);
  assert.ok(result.events.some((event) => event.eventType === "internal_output_blocked"));
});

test("strips pasted tool search JSON from visible assistant text", () => {
  const result = normalizeAgentRunOutput({
    text: '好的，我来搜索一下最近中美两国的主要新闻。\n{"query":"2026年5月 美国 重大新闻","total_results":5,"results":[{"title":"raw"}]}\n下面是整理后的摘要。',
    locale: "zh",
    source: "agent-backend"
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

test("corrects false Canvas success claims when the write is still pending", () => {
  const result = normalizeAgentRunOutput({
    text: "The Canvas node was created successfully.",
    locale: "en",
    source: "agent-backend",
    events: [{ eventType: "agent_backend_canvas_write_pending_approval", payload: { requestId: "write_1" } }]
  });

  assert.match(result.text, /waiting for your approval/i);
  assert.doesNotMatch(result.text, /created successfully/i);
});

test("corrects false Canvas success claims when the mutation failed", () => {
  const result = normalizeAgentRunOutput({
    text: "已创建画布节点。",
    locale: "zh",
    source: "agent-backend",
    events: [{ eventType: "agent_backend_canvas_mutation_failed", payload: { reason: "request_failed" } }]
  });

  assert.match(result.text, /未完成/);
  assert.doesNotMatch(result.text, /已创建/);
});

test("creates an authoritative visible summary from a committed Canvas event", () => {
  const result = normalizeAgentRunOutput({
    text: "",
    locale: "en",
    source: "agent-backend",
    events: [{ eventType: "agent_backend_canvas_mutation_committed", payload: { nodeId: "node_1", status: "committed" } }]
  });

  assert.match(result.text, /created or updated/i);
});

test("appends source links when web search was used and the answer omitted citations", () => {
  const result = normalizeAgentRunOutput({
    text: "OpenAI publishes product and research updates on its official site.",
    locale: "en",
    source: "agent-backend",
    events: [{
      eventType: "agent_backend_tool_completed",
      payload: {
        toolName: "web_search",
        sources: [{ title: "OpenAI", url: "https://openai.com" }]
      }
    }]
  });

  assert.match(result.text, /## Sources/);
  assert.match(result.text, /\[OpenAI\]\(https:\/\/openai\.com\)/);
  assert.ok(result.events.some((event) => event.eventType === "web_search_sources_appended"));
});

test("blocks web search answers when no source URLs are available", () => {
  const result = normalizeAgentRunOutput({
    text: "Here is a current-events summary from search.",
    locale: "en",
    source: "agent-backend",
    events: [{
      eventType: "agent_backend_tool_completed",
      payload: { toolName: "web_search", sources: [] }
    }]
  });

  assert.match(result.text, /source links were not available/i);
  assert.ok(result.events.some((event) => event.eventType === "web_search_sources_missing"));
});
