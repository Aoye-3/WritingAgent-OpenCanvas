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
