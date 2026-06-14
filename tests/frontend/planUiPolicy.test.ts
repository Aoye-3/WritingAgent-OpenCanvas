import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestToolState, visibleComposerTools } from "../../src/features/workspace/planUiPolicy.js";

test("composer hides internal orchestration tools and keeps one dedicated Plan entry", () => {
  assert.deepEqual(
    visibleComposerTools(["web_search", "knowledge_base", "quick_messages", "artifact_stage", "canvas_write", "clear_context"]),
    ["web_search", "knowledge_base"]
  );
});

test("ordinary chat preserves Agent-configured tools", () => {
  assert.deepEqual(buildRequestToolState({ artifact_stage: true, web_search: true }, { kind: "chat" }), {
    artifact_stage: true,
    web_search: true,
    quick_messages: true,
    canvas_write: true
  });
});

test("planning and execution expose only their phase-specific tools", () => {
  assert.deepEqual(buildRequestToolState({ knowledge_base: true }, { kind: "planning" }), {
    knowledge_base: false,
    quick_messages: false,
    canvas_write: false,
    web_search: false,
    artifact_stage: false,
    plan_clarification_submit: true,
    plan_revision_submit: true
  });
  assert.deepEqual(buildRequestToolState({}, { kind: "execution" }), {
    quick_messages: false,
    canvas_write: false,
    artifact_stage: true,
    web_search: true
  });
});
