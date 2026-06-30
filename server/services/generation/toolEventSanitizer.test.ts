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

test("omits undefined object fields instead of stringifying them", () => {
  const payload = sanitizeToolEventPayload({
    title: "Progress",
    next: undefined,
    nested: { interventionHint: undefined, summary: "Visible" }
  }) as Record<string, unknown>;

  assert.equal(payload.title, "Progress");
  assert.equal("next" in payload, false);
  assert.deepEqual(payload.nested, { summary: "Visible" });
});

test("summarizes checkpoint canvas node payloads without full node content", () => {
  const payload = sanitizeToolEventPayload({
    eventType: "canvas_delivery_body_checkpoint_committed",
    nodeId: "node_body_draft",
    title: "Body draft",
    displayTitle: "Body draft 4",
    node: {
      id: "node_body_draft",
      title: "Body draft",
      content: "# Body draft\n\nWorking draft content",
      x: 10,
      y: 20
    }
  }) as Record<string, unknown>;

  const node = payload.node as Record<string, unknown>;
  assert.equal(node.id, "node_body_draft");
  assert.equal(node.title, "Body draft");
  assert.equal(node.content, undefined);
  assert.equal(node.contentPreview, "# Body draft\n\nWorking draft content");
  assert.match(String(node.contentHash), /^[a-f0-9]{64}$/);
});
