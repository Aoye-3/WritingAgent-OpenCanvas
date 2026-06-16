import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStorage } from "./storage.js";

test("stores canvas nodes and applies approved write requests", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  const original = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Original",
    content: "First paragraph",
    x: 10,
    y: 20
  });

  assert.equal(storage.listCanvasNodes(threadId).length, 1);
  assert.equal(original.kind, "document");

  const append = storage.createCanvasWriteRequest(threadId, {
    operation: "append",
    targetNodeId: original.id,
    content: "Second paragraph",
    rationale: "Add detail"
  });
  const appendResult = storage.approveCanvasWriteRequest(threadId, append.id);
  assert.match(appendResult?.node?.content ?? "", /First paragraph\n\nSecond paragraph/);

  const replace = storage.createCanvasWriteRequest(threadId, {
    operation: "replace",
    targetNodeId: original.id,
    title: "Replaced",
    content: "Replacement"
  });
  const replaceResult = storage.approveCanvasWriteRequest(threadId, replace.id);
  assert.equal(replaceResult?.node?.title, "Replaced");
  assert.equal(replaceResult?.node?.content, "Replacement");

  const create = storage.createCanvasWriteRequest(threadId, {
    operation: "create",
    nodeKind: "reference",
    title: "Reference",
    content: "Source note"
  });
  const createResult = storage.approveCanvasWriteRequest(threadId, create.id);
  assert.equal(createResult?.node?.kind, "reference");
  assert.equal(storage.listCanvasNodes(threadId).length, 2);
});

test("rejecting a canvas write request leaves nodes unchanged", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, { kind: "note", title: "Note", content: "Keep me" });
  const request = storage.createCanvasWriteRequest(threadId, {
    operation: "replace",
    targetNodeId: node.id,
    content: "Do not apply"
  });

  const rejected = storage.rejectCanvasWriteRequest(threadId, request.id);
  assert.equal(rejected?.status, "rejected");
  assert.equal(storage.listCanvasNodes(threadId)[0].content, "Keep me");
});

test("deleting a Canvas node through Agent write requests requires approval", async () => {
  const storage = await createStorage();
  const projectId = `project_${randomUUID().replace(/-/g, "_")}`;
  storage.createProject(projectId, "Delete approval");
  const node = storage.createCanvasNode(projectId, {
    kind: "document",
    title: "Delete me",
    content: "Obsolete"
  });
  const request = storage.createCanvasWriteRequest(projectId, {
    operation: "delete",
    targetNodeId: node.id,
    content: "",
    rationale: "Remove obsolete content"
  });

  assert.equal(storage.listCanvasNodes(projectId).length, 1);
  storage.approveCanvasWriteRequest(projectId, request.id);
  assert.equal(storage.listCanvasNodes(projectId).length, 0);
});

test("approves a range replacement only while the source node is unchanged", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Draft",
    content: "Keep this sentence. Rewrite this sentence."
  });
  const start = node.content.indexOf("Rewrite");
  const originalText = "Rewrite this sentence.";
  const request = storage.createCanvasWriteRequest(threadId, {
    operation: "replace_range",
    targetNodeId: node.id,
    content: "This sentence is clearer.",
    rangeStart: start,
    rangeEnd: start + originalText.length,
    originalText,
    baseNodeUpdatedAt: node.updatedAt
  });

  const approved = storage.approveCanvasWriteRequest(threadId, request.id);
  assert.equal(approved?.request.status, "approved");
  assert.equal(approved?.node?.content, "Keep this sentence. This sentence is clearer.");

  const staleNode = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Changed",
    content: "Original paragraph"
  });
  const staleRequest = storage.createCanvasWriteRequest(threadId, {
    operation: "replace_range",
    targetNodeId: staleNode.id,
    content: "Replacement",
    rangeStart: 0,
    rangeEnd: 8,
    originalText: "Original",
    baseNodeUpdatedAt: staleNode.updatedAt
  });
  storage.updateCanvasNode(threadId, staleNode.id, { content: "Edited paragraph" });

  const stale = storage.approveCanvasWriteRequest(threadId, staleRequest.id);
  assert.equal(stale?.request.status, "stale");
  assert.equal(stale?.node?.content, "Edited paragraph");
});

test("allows only one pending range replacement per document node", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, { kind: "document", title: "Draft", content: "Rewrite this" });
  const draft = {
    operation: "replace_range" as const,
    targetNodeId: node.id,
    content: "Replace this",
    rangeStart: 0,
    rangeEnd: 7,
    originalText: "Rewrite",
    baseNodeUpdatedAt: node.updatedAt
  };

  storage.createCanvasWriteRequest(threadId, draft);
  assert.throws(() => storage.createCanvasWriteRequest(threadId, draft), /pending range replacement/i);
});

test("stores directed canvas edges and removes edges when a node is deleted", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const source = storage.createCanvasNode(threadId, { kind: "reference", title: "Source", content: "A" });
  const target = storage.createCanvasNode(threadId, { kind: "document", title: "Target", content: "B" });

  const edge = storage.createCanvasEdge(threadId, { sourceNodeId: source.id, targetNodeId: target.id });

  assert.equal(edge.sourceNodeId, source.id);
  assert.equal(edge.targetNodeId, target.id);
  assert.equal(storage.listCanvasEdges(threadId).length, 1);

  assert.equal(storage.deleteCanvasNode(threadId, source.id), true);
  assert.deepEqual(storage.listCanvasEdges(threadId), []);
});

test("updates canvas node kind without losing content or geometry", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, {
    kind: "note",
    title: "Thinking",
    content: "Private note",
    x: 12,
    y: 34,
    width: 300,
    height: 200
  });

  const updated = storage.updateCanvasNode(threadId, node.id, { kind: "reference" });

  assert.equal(updated?.kind, "reference");
  assert.equal(updated?.title, "Thinking");
  assert.equal(updated?.content, "Private note");
  assert.equal(updated?.x, 12);
  assert.equal(updated?.y, 34);
  assert.equal(updated?.width, 300);
  assert.equal(updated?.height, 200);
});

test("updates multiple canvas node positions without changing content or size", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const first = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "First",
    content: "Keep first",
    x: 10,
    y: 20,
    width: 300,
    height: 200
  });
  const second = storage.createCanvasNode(threadId, {
    kind: "reference",
    title: "Second",
    content: "Keep second",
    x: 30,
    y: 40,
    width: 320,
    height: 220
  });

  const updated = storage.updateCanvasNodePositions(threadId, [
    { nodeId: first.id, x: 100.4, y: 200.6 },
    { nodeId: second.id, x: -20.2, y: 80.8 }
  ]);

  assert.deepEqual(updated.map((node) => ({ id: node.id, x: node.x, y: node.y })), [
    { id: first.id, x: 100.4, y: 200.6 },
    { id: second.id, x: -20.2, y: 80.8 }
  ]);
  assert.deepEqual(updated.map((node) => ({ title: node.title, content: node.content, width: node.width, height: node.height })), [
    { title: "First", content: "Keep first", width: 300, height: 200 },
    { title: "Second", content: "Keep second", width: 320, height: 220 }
  ]);
});

test("rejects batch position updates when any canvas node is missing", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, { kind: "document", title: "Only", content: "Text" });

  assert.throws(() => storage.updateCanvasNodePositions(threadId, [
    { nodeId: node.id, x: 10, y: 20 },
    { nodeId: "node_missing", x: 30, y: 40 }
  ]), /Canvas node not found/i);
});

test("saves canvas settings with default undo depth", async () => {
  const storage = await createStorage();

  assert.deepEqual(storage.saveCanvasSettings({ undoDepth: 20 }), { undoDepth: 20 });
  assert.deepEqual(storage.getCanvasSettings(), { undoDepth: 20 });
  assert.deepEqual(storage.saveCanvasSettings({ undoDepth: 32 }), { undoDepth: 32 });
  assert.deepEqual(storage.getCanvasSettings(), { undoDepth: 32 });
  assert.throws(() => storage.saveCanvasSettings({ undoDepth: 0 }), /undo depth/i);
});

test("stores and updates independent canvas objects without creating semantic edges", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  const arrow = storage.createCanvasObject(threadId, {
    kind: "arrow",
    geometry: { startX: 10, startY: 20, endX: 180, endY: 120 },
    data: {}
  });
  const updated = storage.updateCanvasObject(threadId, arrow.id, {
    geometry: { startX: 30, startY: 40, endX: 200, endY: 140 }
  });

  assert.equal(arrow.kind, "arrow");
  assert.deepEqual(updated?.geometry, { startX: 30, startY: 40, endX: 200, endY: 140 });
  assert.equal(storage.listCanvasObjects(threadId).length, 1);
  assert.deepEqual(storage.listCanvasEdges(threadId), []);
  assert.equal(await storage.deleteCanvasObject(threadId, arrow.id), true);
  assert.deepEqual(storage.listCanvasObjects(threadId), []);
});

test("rejects invalid Canvas object writes", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  assert.throws(() => storage.createCanvasObject(threadId, {
    kind: "shape",
    geometry: { x: 0, y: 0, width: 220, height: 140 },
    data: { shapeId: "not-a-shape" },
  }), /shape/i);
  assert.throws(() => storage.createCanvasObject(threadId, {
    kind: "asset",
    geometry: { x: 0, y: 0, width: 220, height: 140 },
    data: { name: "unsafe.txt", relativePath: "uploads/unsafe.txt" },
  }), /asset/i);
});

test("stores supported canvas assets inside the thread upload directory", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  const asset = await storage.createCanvasAsset(threadId, {
    fileName: "notes.md",
    fileBase64: Buffer.from("# Notes").toString("base64")
  });

  assert.equal(asset.kind, "asset");
  assert.equal((asset.data as { name: string }).name, "notes.md");
  assert.match((asset.data as { relativePath: string }).relativePath, /^uploads\//);
  assert.equal(await storage.deleteCanvasObject(threadId, asset.id), true);
  assert.equal(await storage.readCanvasAsset(threadId, asset.id), undefined);
});

test("stores role nodes as first-class canvas nodes", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  const role = storage.createCanvasNode(threadId, {
    kind: "role",
    title: "Evidence",
    metadata: { workflowRole: { roleId: "evidence", label: "Evidence", prompt: "Check sources." } }
  });
  const draft = storage.createCanvasNode(threadId, { kind: "document", title: "Draft", content: "Body" });
  const edge = storage.createCanvasEdge(threadId, { sourceNodeId: role.id, targetNodeId: draft.id });

  assert.equal(role.kind, "role");
  assert.deepEqual((role.metadata as { workflowRole: unknown }).workflowRole, { roleId: "evidence", label: "Evidence", prompt: "Check sources." });
  assert.equal(edge.sourceNodeId, role.id);
  assert.equal(edge.targetNodeId, draft.id);
});

test("canvas workflow mode and stage are thread-scoped and inherited by new nodes", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  assert.equal(storage.getCanvasWorkflow(threadId).mode, "batch_delivery");
  assert.equal(storage.getCanvasWorkflow(threadId).stage, "inspiration");
  const workflow = storage.updateCanvasWorkflow(threadId, { mode: "batch_delivery", stage: "structure" });
  const node = storage.createCanvasNode(threadId, { kind: "document", title: "Outline", content: "Draft outline" });

  assert.equal(workflow.mode, "batch_delivery");
  assert.equal(storage.getCanvasWorkflow(threadId).mode, "batch_delivery");
  assert.equal(workflow.stage, "structure");
  assert.deepEqual((node.metadata as { workflow?: unknown }).workflow, { stage: "structure" });
});

test("legacy node role metadata migrates to role nodes and role edges", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  storage.updateCanvasWorkflow(threadId, {
    roles: [{ id: "claims", label: "Claims", prompt: "Challenge unsupported claims." }]
  });
  const node = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Draft",
    content: "Text",
    metadata: { workflow: { stage: "writing", roles: ["claims"] } }
  });

  const migrated = storage.migrateCanvasWorkflowRoleNodes(threadId);
  const nodes = storage.listCanvasNodes(threadId);
  const roleNode = nodes.find((candidate) => candidate.kind === "role");
  const migratedTarget = nodes.find((candidate) => candidate.id === node.id);

  assert.equal(migrated.createdRoleNodes, 1);
  assert.equal(roleNode?.title, "Claims");
  assert.deepEqual((roleNode?.metadata as { workflowRole: unknown }).workflowRole, { roleId: "claims", label: "Claims", prompt: "Challenge unsupported claims." });
  assert.deepEqual((migratedTarget?.metadata as { workflow: { stage: string; roles?: string[] } }).workflow, { stage: "writing" });
  assert.equal(storage.listCanvasEdges(threadId).some((edge) => edge.sourceNodeId === roleNode?.id && edge.targetNodeId === node.id), true);
});

test("canvas workflow suggestions are anchored to role nodes and retain target nodes", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const node = storage.createCanvasNode(threadId, { kind: "document", title: "Draft", content: "Opening" });
  const role = storage.createCanvasNode(threadId, {
    kind: "role",
    title: "Style",
    metadata: { workflowRole: { roleId: "style", label: "Style", prompt: "Improve wording." } }
  });
  storage.createCanvasEdge(threadId, { sourceNodeId: role.id, targetNodeId: node.id });
  const suggestion = storage.createCanvasWorkflowSuggestion(threadId, {
    roleNodeId: role.id,
    targetNodeId: node.id,
    roleId: "style",
    content: "Add a sharper hook.",
    rationale: "The first sentence is flat."
  });
  const accepted = storage.acceptCanvasWorkflowSuggestion(threadId, suggestion.id);
  const ignored = storage.createCanvasWorkflowSuggestion(threadId, { roleNodeId: role.id, targetNodeId: node.id, roleId: "style", content: "Cite the source." });
  const converted = storage.convertCanvasWorkflowSuggestionToNode(threadId, ignored.id, { kind: "note" });

  assert.equal(suggestion.nodeId, role.id);
  assert.equal(suggestion.roleNodeId, role.id);
  assert.equal(suggestion.targetNodeId, node.id);
  assert.equal(accepted?.status, "accepted");
  assert.match(storage.listCanvasNodes(threadId).find((candidate) => candidate.id === node.id)?.content ?? "", /Opening\n\nAdd a sharper hook\./);
  assert.equal(converted?.suggestion.status, "accepted");
  assert.equal(converted?.node.kind, "note");
  assert.equal(storage.ignoreCanvasWorkflowSuggestion(threadId, ignored.id)?.status, "ignored");
});
