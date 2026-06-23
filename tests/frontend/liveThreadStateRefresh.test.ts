import test from "node:test";
import assert from "node:assert/strict";
import { createLiveThreadStateRefreshScheduler } from "../../src/app/hooks/useGenerationRun";
import { upsertCanvasNodeSnapshot } from "../../src/app/hooks/useCanvasState";
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
