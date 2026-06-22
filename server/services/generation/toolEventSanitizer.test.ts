import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolEventPayload } from "./toolEventSanitizer.js";

test("removes secret and private reasoning fields from tool event payloads", () => {
  const sanitized = sanitizeToolEventPayload({
    toolName: "web_search",
    status: "completed",
    prompt: "private prompt",
    reasoning: "private chain",
    authorization: "Bearer secret",
    nested: { apiKey: "secret", result: "safe result" }
  }) as Record<string, unknown>;
  assert.equal(sanitized.toolName, "web_search");
  assert.equal(sanitized.status, "completed");
  assert.equal("prompt" in sanitized, false);
  assert.equal("reasoning" in sanitized, false);
  assert.equal("authorization" in sanitized, false);
  assert.deepEqual(sanitized.nested, { result: "safe result" });
});

test("redacts DSML tool protocol from tool event payload strings", () => {
  const payload = sanitizeToolEventPayload({
    toolName: "web_search",
    summary: '< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">',
    sources: [{
      title: "Paper",
      url: "https://example.com/paper",
      snippet: '< | | DSML | | parameter name="maxcontentlength">5000'
    }]
  }) as Record<string, unknown>;

  assert.equal(payload.summary, "[redacted internal runtime protocol]");
  assert.equal(JSON.stringify(payload).includes("DSML"), false);
  assert.equal(JSON.stringify(payload).includes("webfetch"), false);
});
