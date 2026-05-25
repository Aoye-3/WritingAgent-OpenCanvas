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

test("saves canvas settings with default undo depth", async () => {
  const storage = await createStorage();

  assert.deepEqual(storage.saveCanvasSettings({ undoDepth: 20 }), { undoDepth: 20 });
  assert.deepEqual(storage.getCanvasSettings(), { undoDepth: 20 });
  assert.deepEqual(storage.saveCanvasSettings({ undoDepth: 32 }), { undoDepth: 32 });
  assert.deepEqual(storage.getCanvasSettings(), { undoDepth: 32 });
  assert.throws(() => storage.saveCanvasSettings({ undoDepth: 0 }), /undo depth/i);
});
