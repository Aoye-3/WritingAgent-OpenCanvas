import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStorage } from "../storage.js";
import { canvasRectsOverlap } from "./canvasNodePlacement.js";
import { commitLowRiskCanvasWrite } from "./canvasWriteCommit.js";

test("commits automatic Agent canvas creates without overlap", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");

  const first = commitLowRiskCanvasWrite(storage, threadId, { operation: "create", nodeKind: "document", title: "First", content: "One" });
  const second = commitLowRiskCanvasWrite(storage, threadId, { operation: "create", nodeKind: "document", title: "Second", content: "Two" });

  assert.equal(canvasRectsOverlap(first, second), false);
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
});

test("commits automatic Agent canvas creates near the selected anchor", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, "blog-post");
  const anchor = storage.createCanvasNode(threadId, {
    kind: "document",
    title: "Anchor",
    content: "Existing",
    x: 300,
    y: 200,
    width: 320,
    height: 220
  });

  const created = commitLowRiskCanvasWrite(
    storage,
    threadId,
    { operation: "create", nodeKind: "document", title: "Anchored", content: "Near anchor" },
    { selectedCanvasNodeId: anchor.id }
  );

  assert.equal(canvasRectsOverlap(anchor, created), false);
  assert.ok(created.x > anchor.x);
  assert.equal(created.y, anchor.y);
});

test("updates stable short-progress Agent nodes instead of creating new positions", async () => {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  const stableNodeId = `node_short_progress_${threadId}`;
  await storage.ensureThread(threadId, "blog-post");

  const first = commitLowRiskCanvasWrite(
    storage,
    threadId,
    { operation: "create", nodeKind: "document", title: "Progress", content: "First" },
    { shortProgressStableNodeId: stableNodeId }
  );
  const second = commitLowRiskCanvasWrite(
    storage,
    threadId,
    { operation: "create", nodeKind: "document", title: "Progress", content: "Second" },
    { shortProgressStableNodeId: stableNodeId }
  );

  assert.equal(first.id, second.id);
  assert.equal(storage.listCanvasNodes(threadId).length, 1);
  assert.equal(second.content, "Second");
  assert.deepEqual({ x: second.x, y: second.y }, { x: first.x, y: first.y });
});
