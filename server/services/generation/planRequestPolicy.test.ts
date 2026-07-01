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
    clear_context: false,
    canvas_write: false,
    plan_clarification_submit: true,
    plan_revision_submit: false
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
  assert.equal(policy.toolState.artifact_stage, true);
  assert.equal(policy.toolState.web_search, true);
  assert.equal(policy.toolState.knowledge_base, true);
  assert.equal(policy.toolState.canvas_write, false);
});

test("server lets preflight submit a Plan or Plan clarification only", () => {
  const policy = resolvePlanRequestPolicy({
    chatInstruction: "Research agent planning",
    planPhase: "preflight",
    planId: "plan_1",
    toolState: { web_search: true, canvas_write: true, plan_revision_submit: true }
  });
  assert.equal(policy.phase, "planning");
  assert.equal(policy.stage, "preflight");
  assert.deepEqual(policy.toolState, {
    web_search: false,
    artifact_stage: false,
    knowledge_base: false,
    clear_context: false,
    canvas_write: false,
    plan_clarification_submit: true,
    plan_revision_submit: true
  });
});

test("ordinary chat does not expose Plan lifecycle tools", () => {
  const policy = resolvePlanRequestPolicy({ chatInstruction: "Hello", toolState: { artifact_stage: true, web_search: true } });
  assert.equal(policy.phase, "chat");
  assert.equal(policy.toolState.artifact_stage, false);
  assert.equal(policy.toolState.web_search, true);
});
