import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createLiveToolEventState,
  readLiveCanvasNodeSnapshot,
  reduceLiveToolEvent,
  shouldRefreshThreadStateForToolEvent,
  threadStateRefreshModeForToolEvent
} from "../../src/app/hooks/toolEventPresentation";
import { looksUnsafeForReasoningStream } from "../../src/app/hooks/useGenerationRun";

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
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_research_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_outline_started", payload: {} }), false);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_body_started", payload: {} }), false);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_body_checkpoint_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_synthesis_started", payload: {} }), false);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_body_final_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "canvas_delivery_failed_summary_committed", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_plan_waiting_for_user", payload: {} }), true);
  assert.equal(shouldRefreshThreadStateForToolEvent({ eventType: "agent_backend_tool_completed", payload: { toolName: "web_search" } }), false);
});

test("Canvas delivery committed events classify strong and deferred refreshes", () => {
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_research_committed", payload: {} }), "deferred");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_body_checkpoint_committed", payload: {} }), "deferred");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_body_final_committed", payload: {} }), "immediate");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_file_document_committed", payload: {} }), "immediate");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_sources_committed", payload: {} }), "immediate");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_failed_summary_committed", payload: {} }), "immediate");
  assert.equal(threadStateRefreshModeForToolEvent({ eventType: "canvas_delivery_outline_started", payload: {} }), "none");
});

test("Canvas delivery progress labels include evidence and draft progress", () => {
  assert.equal(reduceLiveToolEvent(createLiveToolEventState(), {
    eventType: "canvas_delivery_research_committed",
    payload: { evidenceCount: 4, nextPhaseHint: "synthesis_ready" }
  }, "zh").statusLabel, "已收集 4 条参考资料，Agent 正在整理交付...");

  assert.equal(reduceLiveToolEvent(createLiveToolEventState(), {
    eventType: "canvas_delivery_body_checkpoint_committed",
    payload: { draftIndex: 2, evidenceCount: 2 }
  }, "zh").statusLabel, "已生成第 2 版正文草稿，继续筛选资料...");

  assert.equal(reduceLiveToolEvent(createLiveToolEventState(), {
    eventType: "agent_backend_tool_started",
    payload: { toolName: "write_file" }
  }, "zh").statusLabel, "正在写入 Markdown 文档...");

  assert.equal(reduceLiveToolEvent(createLiveToolEventState(), {
    eventType: "agent_backend_tool_completed",
    payload: { toolName: "present_files" }
  }, "zh").statusLabel, "文档已展示，正在生成最终回复...");
});

test("Canvas delivery committed events expose live node snapshots for checkpoint and final nodes", () => {
  const node = canvasNode("body_draft", "Working draft 2");
  assert.deepEqual(readLiveCanvasNodeSnapshot({
    eventType: "canvas_delivery_body_checkpoint_committed",
    payload: { node }
  }), node);

  assert.deepEqual(readLiveCanvasNodeSnapshot({
    eventType: "canvas_delivery_body_final_committed",
    payload: { node }
  }), node);

  assert.equal(readLiveCanvasNodeSnapshot({
    eventType: "canvas_delivery_synthesis_started",
    payload: { node }
  }), undefined);

  assert.equal(readLiveCanvasNodeSnapshot({
    eventType: "canvas_delivery_body_checkpoint_committed",
    payload: { node: { id: "body_draft", title: "Body draft" } }
  }), undefined);
});

test("Canvas synced status communicates that the final response is still pending", () => {
  const source = readFileSync("src/app/hooks/useGenerationRun.ts", "utf8");

  assert.match(source, /Canvas preview synced; agent is still preparing the final response\.\.\./);
  assert.match(source, /Canvas 预览已同步，Agent 仍在生成最终回复\.\.\./);
  assert.doesNotMatch(source, /Canvas synced; waiting for final response\.\.\./);
  assert.doesNotMatch(source, /Canvas state synced\./);
  assert.match(source, /isStreaming:\s*false,[\s\S]*statusLabel:\s*undefined/);
});

test("reasoning stream blocks leaked Agent Runtime DSML", () => {
  assert.equal(looksUnsafeForReasoningStream('< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">'), true);
  assert.equal(looksUnsafeForReasoningStream("I will summarize the gathered sources next."), false);
});

function canvasNode(id: string, content: string) {
  return {
    id,
    projectId: "project_1",
    kind: "document" as const,
    title: "Body draft",
    content,
    x: 10,
    y: 20,
    width: 620,
    height: 520,
    metadata: { phase: "body_draft" },
    includeInProjectContext: true,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:01.000Z"
  };
}
