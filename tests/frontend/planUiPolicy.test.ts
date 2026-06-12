import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestToolState, visibleComposerTools } from "../../src/features/workspace/planUiPolicy.js";

test("composer hides internal orchestration tools and keeps one dedicated Plan entry", () => {
  assert.deepEqual(
    visibleComposerTools(["web_search", "plan_update", "artifact_stage", "canvas_write", "clear_context"]),
    ["web_search"]
  );
});

test("ordinary chat preserves Agent-configured Plan orchestration tools", () => {
  assert.deepEqual(buildRequestToolState({ plan_update: true, artifact_stage: true, web_search: true }, { kind: "chat" }), {
    plan_update: true,
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
    plan_update: true
  });
  assert.deepEqual(buildRequestToolState({}, { kind: "execution" }), {
    quick_messages: false,
    canvas_write: false,
    plan_update: true,
    artifact_stage: true,
    web_search: true
  });
});
