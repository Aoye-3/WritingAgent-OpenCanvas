import test from "node:test";
import assert from "node:assert/strict";
import {
  createLiveToolEventState,
  reduceLiveToolEvent,
  shouldRefreshThreadStateForToolEvent
} from "../../src/app/hooks/toolEventPresentation";

test("repeated tool events update one streaming status instead of chat activity lines", () => {
  let state = createLiveToolEventState();
  const first = reduceLiveToolEvent(state, {
    eventType: "agent_backend_tool_started",
    payload: { toolName: "web_search" }
  }, "en");
  assert.equal(first.chatActivityText, undefined);
  assert.equal(first.statusLabel, "Web search running");

  state = first.state;
  const second = reduceLiveToolEvent(state, {
    eventType: "agent_backend_tool_started",
    payload: { toolName: "web_search" }
  }, "en");
  assert.equal(second.chatActivityText, undefined);
  assert.equal(second.statusLabel, "Web search running (2 calls)");

  state = second.state;
  const completed = reduceLiveToolEvent(state, {
    eventType: "agent_backend_tool_completed",
    payload: { toolName: "web_search" }
  }, "en");
  assert.equal(completed.chatActivityText, undefined);
  assert.equal(completed.statusLabel, "Web search completed (2 calls)");
});

test("tool event presentation uses readable Chinese labels", () => {
  const result = reduceLiveToolEvent(createLiveToolEventState(), {
    eventType: "agent_backend_tool_started",
    payload: { toolName: "web_search" }
  }, "zh");

  assert.equal(result.statusLabel, "联网搜索运行中");
  assert.equal(JSON.stringify(result).includes("�"), false);
  assert.equal(JSON.stringify(result).includes("杩"), false);
});

test("Canvas and artifact lifecycle events request live thread-state refresh", () => {
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_canvas_mutation_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_artifact_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_canvas_write_pending_approval", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_canvas_mutation_failed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_tool_completed", payload: { toolName: "web_search" } }), false);
});
