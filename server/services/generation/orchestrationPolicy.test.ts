import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrchestrationPolicy } from "./orchestrationPolicy.js";

test("keeps ordinary questions direct and Canvas-free", () => {
  assert.deepEqual(resolveOrchestrationPolicy("What is a mutex?"), {
    mode: "direct", trigger: "ordinary", clarificationPolicy: "when_needed", deliveryPolicy: "conversation_only"
  });
});

test("uses guided decomposition for complex ordinary chat", () => {
  assert.equal(resolveOrchestrationPolicy("Analyze the options, compare tradeoffs, and recommend an approach").mode, "guided");
});

test("forces managed Plan policy for slash plan", () => {
  assert.deepEqual(resolveOrchestrationPolicy("/plan research and write a report"), {
    mode: "managed_plan", trigger: "explicit_plan", clarificationPolicy: "required_once", deliveryPolicy: "canvas_required"
  });
});
