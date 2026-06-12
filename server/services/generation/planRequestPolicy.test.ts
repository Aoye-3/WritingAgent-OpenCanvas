import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";

test("server enforces planning-only tools for slash plan requests", () => {
  const policy = resolvePlanRequestPolicy({ chatInstruction: "/plan research phones", toolState: { web_search: true, artifact_stage: true } });
  assert.equal(policy.phase, "planning");
  assert.deepEqual(policy.toolState, {
    web_search: false,
    artifact_stage: false,
    knowledge_base: false,
    quick_messages: false,
    clear_context: false,
    canvas_write: false,
    plan_update: true
  });
});

test("server limits approved execution to the designated step", () => {
  const policy = resolvePlanRequestPolicy({
    chatInstruction: "Continue approved plan plan_1",
    contextValues: { planExecution: { planId: "plan_1", stepId: "sources" } },
    toolState: { knowledge_base: true }
  });
  assert.equal(policy.phase, "execution");
  assert.equal(policy.executionStepId, "sources");
  assert.equal(policy.toolState.plan_update, true);
  assert.equal(policy.toolState.artifact_stage, true);
  assert.equal(policy.toolState.web_search, true);
  assert.equal(policy.toolState.knowledge_base, true);
  assert.equal(policy.toolState.canvas_write, false);
});

test("ordinary chat preserves internal tools enabled in Agent settings", () => {
  const policy = resolvePlanRequestPolicy({ chatInstruction: "Hello", toolState: { plan_update: true, artifact_stage: true, web_search: true } });
  assert.equal(policy.phase, "chat");
  assert.equal(policy.toolState.plan_update, true);
  assert.equal(policy.toolState.artifact_stage, true);
  assert.equal(policy.toolState.web_search, true);
});
