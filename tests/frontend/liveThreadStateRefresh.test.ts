import test from "node:test";
import assert from "node:assert/strict";
import { createLiveThreadStateRefreshScheduler } from "../../src/app/hooks/useGenerationRun";
import { resolveCanvasSelectedNodeId, upsertCanvasNodeSnapshot } from "../../src/app/hooks/useCanvasState";
import type { CanvasNode, ThreadStateResponse } from "../../src/features/agents/types";

test("live thread-state refresh queues one follow-up refresh while a refresh is in flight", async () => {
  const scheduler = createLiveThreadStateRefreshScheduler();
  const applied: ThreadStateResponse[] = [];
  let calls = 0;
  let resolveFirst: (state: ThreadStateResponse) => void = () => undefined;
  let resolveSecond: (state: ThreadStateResponse) => void = () => undefined;
  let secondStarted: () => void = () => undefined;
  const secondStartedPromise = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });

  const fetchAndApply = async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise<ThreadStateResponse>((resolve) => {
        resolveFirst = resolve;
      });
    }
    secondStarted();
    return new Promise<ThreadStateResponse>((resolve) => {
      resolveSecond = resolve;
    });
  };
  const request = {
    threadId: "thread_1",
    operationId: 7,
    currentOperationId: () => 7,
    fetchAndApply,
    apply: (state: ThreadStateResponse) => applied.push(state)
  };

  scheduler.request(request);
  scheduler.request(request);
  assert.equal(calls, 1);

  resolveFirst(threadState("placeholder"));
  await secondStartedPromise;
  resolveSecond(threadState("working body draft"));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(calls, 2);
  assert.deepEqual(applied.map((state) => state.canvasNodes[0]?.content), ["placeholder", "working body draft"]);
});

test("live thread-state refresh notifies when a slow refresh settles", async () => {
  const scheduler = createLiveThreadStateRefreshScheduler();
  const settled: string[] = [];
  let resolveRefresh: (state: ThreadStateResponse) => void = () => undefined;

  scheduler.request({
    threadId: "thread_1",
    operationId: 7,
    currentOperationId: () => 7,
    fetchAndApply: async () => new Promise<ThreadStateResponse>((resolve) => {
      resolveRefresh = resolve;
    }),
    apply: () => undefined,
    onSettled: () => settled.push("done")
  });

  assert.deepEqual(settled, []);
  resolveRefresh(threadState("synced body"));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(settled, ["done"]);
});

test("live thread-state refresh coalesces deferred refresh requests", async () => {
  const scheduler = createLiveThreadStateRefreshScheduler();
  const applied: ThreadStateResponse[] = [];
  let calls = 0;
  const request = (content: string) => ({
    threadId: "thread_1",
    operationId: 7,
    currentOperationId: () => 7,
    fetchAndApply: async () => {
      calls += 1;
      return threadState(content);
    },
    apply: (state: ThreadStateResponse) => applied.push(state)
  });

  scheduler.requestDeferred(request("research 1"), 20);
  scheduler.requestDeferred(request("research 2"), 20);
  assert.equal(calls, 0);

  await new Promise((resolve) => setTimeout(resolve, 40));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(calls, 1);
  assert.deepEqual(applied.map((state) => state.canvasNodes[0]?.content), ["research 2"]);
});

test("immediate live thread-state refresh can cancel a deferred refresh", async () => {
  const scheduler = createLiveThreadStateRefreshScheduler();
  const applied: ThreadStateResponse[] = [];
  let calls = 0;
  const request = (content: string) => ({
    threadId: "thread_1",
    operationId: 7,
    currentOperationId: () => 7,
    fetchAndApply: async () => {
      calls += 1;
      return threadState(content);
    },
    apply: (state: ThreadStateResponse) => applied.push(state)
  });

  scheduler.requestDeferred(request("research 1"), 40);
  scheduler.cancelDeferred();
  scheduler.request(request("final body"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(calls, 1);
  assert.deepEqual(applied.map((state) => state.canvasNodes[0]?.content), ["final body"]);
});

test("live Canvas node snapshots replace matching nodes without reordering the board", () => {
  const overview = canvasNode("overview", "Overview");
  const draft = canvasNode("body_draft", "Draft 1");
  const updatedDraft = { ...draft, content: "Draft 2", updatedAt: "2026-06-23T00:00:02.000Z" };

  const updated = upsertCanvasNodeSnapshot([overview, draft], updatedDraft);
  assert.deepEqual(updated.map((node) => node.id), ["overview", "body_draft"]);
  assert.equal(updated[1]?.content, "Draft 2");

  const reconciled = upsertCanvasNodeSnapshot(updated, { ...updatedDraft, content: "Draft 3" });
  assert.equal(reconciled[1]?.content, "Draft 3");
});

test("live Canvas node snapshots skip unchanged updates", () => {
  const overview = canvasNode("overview", "Overview");
  const draft = canvasNode("body_draft", "Draft 1");
  const current = [overview, draft];

  const updated = upsertCanvasNodeSnapshot(current, { ...draft });

  assert.equal(updated, current);
  assert.deepEqual(updated, [overview, draft]);
});

test("Canvas state refresh preserves the selected node when it still exists", () => {
  const overview = canvasNode("overview", "Overview");
  const draft = canvasNode("body_draft", "Draft 1");

  assert.equal(resolveCanvasSelectedNodeId("body_draft", [overview, draft]), "body_draft");
  assert.equal(resolveCanvasSelectedNodeId("missing", [overview, draft]), "overview");
  assert.equal(resolveCanvasSelectedNodeId(undefined, [overview, draft]), "overview");
  assert.equal(resolveCanvasSelectedNodeId("missing", []), undefined);
});

function threadState(bodyContent: string): ThreadStateResponse {
  return {
    thread: { id: "thread_1", projectId: "project_1", title: "Thread", createdAt: "", updatedAt: "" },
    project: { id: "project_1", title: "Project", summary: "", updatedAt: "" },
    messages: [],
    outputVersions: [],
    toolEvents: [],
    canvasNodes: [{ id: "body", projectId: "project_1", kind: "document", title: "Body", content: bodyContent, x: 0, y: 0, width: 1, height: 1, metadata: {}, includeInProjectContext: true, createdAt: "", updatedAt: "" }],
    canvasEdges: [],
    canvasObjects: [],
    canvasWriteRequests: [],
    canvasWriteSuggestions: [],
    canvasWorkflowSuggestions: [],
    plans: [],
    runTimelineEvents: [],
    planActivities: [],
    projectBrief: { brief: {}, revision: 0 },
    taskBrief: { brief: {}, revision: 0 }
  } as unknown as ThreadStateResponse;
}

function canvasNode(id: string, content: string): CanvasNode {
  return {
    id,
    projectId: "project_1",
    kind: "document",
    title: id,
    content,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    metadata: {},
    includeInProjectContext: true,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:01.000Z"
  };
}
