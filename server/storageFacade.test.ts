import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { agentCards, defaultAgentSettings } from "./agentCards.js";
import { createStorage } from "./storage.js";

test("storage facade records thread runs, messages, versions, events, projects, and thread dirs", async () => {
  const storage = await createStorage();
  const threadId = `thread_facade_${Date.now()}`;
  const agentCard = agentCards[0];

  await storage.ensureThread(threadId, agentCard.id);
  await access(path.resolve(process.cwd(), ".facetwrite", "threads", threadId, "user-data", "workspace"));

  const saved = storage.recordRun({
    threadId,
    agentCardId: agentCard.id,
    mode: "structured",
    prompt: "Prompt text",
    output: "Output text",
    provider: "mock",
    usedMock: true,
    userMessage: "User request",
    toolState: { knowledge_base: true },
    events: [{ eventType: "tool_call_completed", payload: { tool: "knowledge_base" } }],
    finishReason: "mock_fallback",
    runtimeRunId: "runtime_run_1",
    runtimeThreadId: "runtime_thread_1"
  });

  assert.match(saved.runId, /^run_/);
  assert.equal(storage.getThread(threadId)?.projectId, agentCard.id);
  assert.deepEqual(storage.listMessages(threadId).map((message) => message.role), ["user", "assistant"]);
  assert.equal(storage.listOutputVersions(threadId)[0].content, "Output text");
  assert.ok(storage.listToolEvents(threadId).some((event) => event.eventType === "tool_call_completed"));
  assert.deepEqual(storage.findRuntimeRunMetadata(threadId, saved.runId), {
    runtimeRunId: "runtime_run_1",
    runtimeThreadId: "runtime_thread_1"
  });
  assert.ok(storage.listProjects(agentCards).some((project) => project.id === agentCard.id && project.assetCount >= 1));

  const renamed = storage.renameThread(threadId, "Renamed project");
  assert.equal(renamed?.title, "Renamed project");
  assert.ok(storage.getThread(threadId)?.updatedAt);
  assert.ok(storage.listRecentThreads().some((thread) => thread.id === threadId && thread.title === "Renamed project"));
  assert.ok(storage.listProjects(agentCards).some((project) => project.id === agentCard.id));
  assert.throws(() => storage.renameThread(threadId, "   "), /required/);

  assert.equal(storage.moveThreadToTrash(threadId), true);
  assert.equal(storage.renameThread(threadId, "Hidden rename"), undefined);
  assert.equal(storage.restoreThread(threadId), true);
  assert.equal(storage.moveThreadToTrash(threadId), true);
  assert.equal(await storage.hardDeleteThread(threadId), true);
});

test("storage facade stores runtime resume context when clarification events duplicate", async () => {
  const storage = await createStorage();
  const threadId = `thread_runtime_resume_${Date.now()}`;
  const agentCard = agentCards[0];
  const question = "Which time range should the review cover?";
  const options = [
    { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: true },
    { id: "recent_10", label: "Recent 10 years", detail: "2016-2026" }
  ];

  await storage.ensureThread(threadId, agentCard.id);
  storage.recordRun({
    threadId,
    agentCardId: agentCard.id,
    mode: "chat",
    prompt: "Prompt text",
    output: "",
    provider: "agent-backend",
    usedMock: false,
    events: [{
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        source: "ask_clarification",
        toolName: "ask_clarification",
        toolCallId: "call_reused",
        question,
        options
      }
    }, {
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        source: "runtime_interrupt",
        toolName: "ask_clarification",
        toolCallId: "interrupt_1",
        question,
        options,
        resumeContext: {
          runtimeResume: {
            runtimeThreadId: "runtime_thread_1",
            runtimeRunId: "runtime_run_1",
            interruptId: "interrupt_1",
            checkpointId: "checkpoint_1"
          }
        }
      }
    }],
    finishReason: "clarification_required"
  });

  const clarifications = storage.listAgentClarifications(threadId);
  const resumeContext = clarifications[0]?.resumeContext as Record<string, unknown> | undefined;
  assert.equal(clarifications.length, 1);
  assert.deepEqual(resumeContext?.runtimeResume, {
    runtimeThreadId: "runtime_thread_1",
    runtimeRunId: "runtime_run_1",
    interruptId: "interrupt_1",
    checkpointId: "checkpoint_1"
  });

  assert.equal(storage.moveThreadToTrash(threadId), true);
  assert.equal(await storage.hardDeleteThread(threadId), true);
});

test("project summaries include lightweight Canvas previews without node content", async () => {
  const storage = await createStorage();
  const projectId = `project_preview_${Date.now()}`;
  storage.createProject(projectId, "Preview project");

  for (let index = 0; index < 10; index += 1) {
    storage.createCanvasNode(projectId, {
      kind: index % 2 === 0 ? "document" : "note",
      title: `Node ${index}`,
      content: `Sensitive content ${index}`,
      x: index * 40,
      y: index * 24,
      width: 220,
      height: 140
    });
  }

  storage.createCanvasObject(projectId, {
    kind: "shape",
    geometry: { x: 120, y: 260, width: 160, height: 80 },
    data: { shapeId: "rectangle" }
  });

  const project = storage.listProjects(agentCards).find((item) => item.id === projectId);
  assert.ok(project?.canvasPreview);
  assert.equal(project.canvasPreview.nodes.length, 8);
  assert.equal(project.canvasPreview.objects.length, 1);
  assert.equal("content" in (project.canvasPreview.nodes[0] as Record<string, unknown>), false);
  assert.equal(project.canvasPreview.objects[0].kind, "shape");

  const emptyProjectId = `project_empty_preview_${Date.now()}`;
  storage.createProject(emptyProjectId, "Empty preview project");
  const emptyProject = storage.listProjects(agentCards).find((item) => item.id === emptyProjectId);
  assert.equal(emptyProject?.canvasPreview, undefined);
});

test("storage facade stores local project thumbnail cache", async () => {
  const storage = await createStorage();
  const projectId = `project_thumbnail_${Date.now()}`;
  storage.createProject(projectId, "Thumbnail project");
  const imageBase64 = Buffer.from("fake-webp-image").toString("base64");

  const saved = await storage.saveProjectThumbnail(projectId, { imageBase64, mimeType: "image/webp" });
  const thumbnail = await storage.readProjectThumbnail(projectId);

  assert.equal(saved?.mimeType, "image/webp");
  assert.ok(saved?.updatedAt);
  assert.equal(thumbnail?.mimeType, "image/webp");
  assert.equal(thumbnail?.content.toString(), "fake-webp-image");
  assert.equal(thumbnail?.updatedAt, saved?.updatedAt);
  await assert.rejects(
    () => storage.saveProjectThumbnail(projectId, { imageBase64, mimeType: "text/plain" }),
    /thumbnail image type/i
  );
  assert.equal(await storage.saveProjectThumbnail("project_missing_thumbnail", { imageBase64, mimeType: "image/webp" }), undefined);

  assert.equal(storage.moveProjectToTrash(projectId), true);
  assert.equal(await storage.hardDeleteProject(projectId), true);
  assert.equal(await storage.readProjectThumbnail(projectId), undefined);
});

test("storage facade preserves Canvas write approval semantics", async () => {
  const storage = await createStorage();
  const threadId = `thread_canvas_facade_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  const node = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Draft",
    content: "Initial"
  });
  assert.equal(storage.listCanvasNodes(threadId).length, 1);

  const updated = storage.updateCanvasNode(threadId, node.id, { content: "Updated" });
  assert.equal(updated?.content, "Updated");

  const appendRequest = storage.createCanvasWriteRequest(threadId, {
    operation: "append",
    targetNodeId: node.id,
    content: "Appendix",
    rationale: "Add detail"
  });
  assert.equal(storage.listCanvasWriteRequests(threadId, "pending").length, 1);

  const approved = storage.approveCanvasWriteRequest(threadId, appendRequest.id);
  assert.match(approved?.node?.content ?? "", /Appendix/);
  assert.equal(storage.listCanvasWriteRequests(threadId, "pending").length, 0);

  const rejectRequest = storage.createCanvasWriteRequest(threadId, {
    operation: "create",
    nodeKind: "note",
    title: "Reject me",
    content: "No write"
  });
  const rejected = storage.rejectCanvasWriteRequest(threadId, rejectRequest.id);
  assert.equal(rejected?.status, "rejected");

  assert.equal(storage.deleteCanvasNode(threadId, node.id), true);
  assert.equal(storage.listCanvasNodes(threadId).length, 0);

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("storage facade saves and returns Agent settings", async () => {
  const storage = await createStorage();
  const settings = defaultAgentSettings(agentCards[0]);
  const agentCardId = `agent_facade_${Date.now()}`;

  storage.saveAgentSettings(agentCardId, {
    ...settings,
    memory: { enabled: true }
  });

  const saved = storage.getAgentSettings(agentCardId);
  assert.equal("model" in (saved as Record<string, unknown>), false);
  assert.deepEqual(saved?.memory, { enabled: true });
});

test("storage facade sanitizes historical leaked assistant messages and output versions", async () => {
  const storage = await createStorage();
  const threadId = `thread_sanitize_facade_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  storage.recordRun({
    threadId,
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Prompt text",
    output: "You are FacetWrite's writing assistant.\n\n# AgentCard\nAgent: Blog Post",
    provider: "agent-backend",
    usedMock: false,
    userMessage: "Hello"
  });

  const assistant = storage.listMessages(threadId).find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.equal(assistant.text.includes("# AgentCard"), false);
  assert.equal(assistant.text.includes("FacetWrite's writing assistant"), false);
  assert.equal(storage.listOutputVersions(threadId)[0].content.includes("# AgentCard"), false);

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("storage facade dedupes replayed runs by client request id", async () => {
  const storage = await createStorage();
  const threadId = `thread_run_replay_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  const first = storage.recordRun({
    threadId,
    clientRequestId: "request_1",
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Prompt text",
    output: "First answer",
    provider: "agent-backend",
    usedMock: false,
    userMessage: "Hello"
  });
  const replay = storage.recordRun({
    threadId,
    clientRequestId: "request_1",
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Prompt text replay",
    output: "Replay answer",
    provider: "agent-backend",
    usedMock: false,
    userMessage: "Hello again"
  });

  assert.deepEqual(replay, first);
  assert.deepEqual(storage.listMessages(threadId).map((message) => message.text), ["Hello", "First answer"]);

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("storage facade sanitizes leaked Canvas node content at read time", async () => {
  const storage = await createStorage();
  const threadId = `thread_canvas_sanitize_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Leaked",
    content: "You are FacetWrite's writing assistant.\n\n# AgentCard\nAgent: Blog Post"
  });

  const node = storage.listCanvasNodes(threadId)[0];
  assert.equal(node.content.includes("You are FacetWrite"), false);
  assert.equal(node.content.includes("# AgentCard"), false);

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});
