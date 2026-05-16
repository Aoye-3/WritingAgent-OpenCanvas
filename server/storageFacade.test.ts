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
    finishReason: "mock_fallback"
  });

  assert.match(saved.runId, /^run_/);
  assert.equal(storage.getThread(threadId)?.agentCardId, agentCard.id);
  assert.deepEqual(storage.listMessages(threadId).map((message) => message.role), ["user", "assistant"]);
  assert.equal(storage.listOutputVersions(threadId)[0].content, "Output text");
  assert.ok(storage.listToolEvents(threadId).some((event) => event.eventType === "tool_call_completed"));
  assert.ok(storage.listProjects(agentCards).some((project) => project.id === threadId && project.assetCount >= 1));

  const renamed = storage.renameThread(threadId, "Renamed project");
  assert.equal(renamed?.title, "Renamed project");
  assert.ok(storage.getThread(threadId)?.updatedAt);
  assert.ok(storage.listRecentThreads().some((thread) => thread.id === threadId && thread.title === "Renamed project"));
  assert.ok(storage.listProjects(agentCards).some((project) => project.id === threadId && project.title === "Renamed project"));
  assert.throws(() => storage.renameThread(threadId, "   "), /required/);

  assert.equal(storage.moveThreadToTrash(threadId), true);
  assert.ok(storage.listProjects(agentCards, true).some((project) => project.id === threadId));
  assert.equal(storage.renameThread(threadId, "Hidden rename"), undefined);
  assert.equal(storage.restoreThread(threadId), true);
  assert.equal(storage.moveThreadToTrash(threadId), true);
  assert.equal(await storage.hardDeleteThread(threadId), true);
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
    quickMessages: ["Shorten this", "Make it clearer"]
  });

  const saved = storage.getAgentSettings(agentCardId);
  assert.equal(saved?.model?.providerId, "deepseek");
  assert.deepEqual(saved?.quickMessages, ["Shorten this", "Make it clearer"]);
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
    provider: "deerflow",
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
