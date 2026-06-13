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
