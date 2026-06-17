import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNode } from "../../src/features/agents/types.js";
import { createSplitCanvasNodeDraft } from "../../src/app/hooks/canvasActions/split.js";

test("creates a split node draft without promoting selected body text into the title", () => {
  const draft = createSplitCanvasNodeDraft(canvasNode({
    kind: "document",
    title: "Original",
    x: 100,
    y: 200,
    width: 640,
    height: 520,
  }), {
    nodeId: "node_1",
    rangeStart: 12,
    rangeEnd: 48,
    text: "## MacBook Pro comparison\n\n| Spec | Value |",
  });

  assert.equal(draft.kind, "document");
  assert.equal(draft.title, "Original");
  assert.equal(draft.content, "## MacBook Pro comparison\n\n| Spec | Value |");
  assert.equal(draft.x, 788);
  assert.equal(draft.y, 224);
  assert.equal(draft.width, 640);
  assert.equal(draft.height, 260);
  assert.deepEqual(draft.metadata, {
    splitFrom: {
      nodeId: "node_1",
      rangeStart: 12,
      rangeEnd: 48,
      sourceUpdatedAt: "2026-06-16T10:00:00.000Z",
    },
  });
});

test("creates a split node draft from plain selected text", () => {
  const draft = createSplitCanvasNodeDraft(canvasNode({
    kind: "note",
    title: "Note",
    x: 10,
    y: 20,
    width: 380,
    height: 190,
  }), {
    nodeId: "node_1",
    rangeStart: 0,
    rangeEnd: 20,
    text: "- **Key point** for later",
  });

  assert.equal(draft.kind, "note");
  assert.equal(draft.title, "Note");
  assert.equal(draft.content, "- **Key point** for later");
  assert.equal(draft.x, 438);
  assert.equal(draft.y, 44);
  assert.equal(draft.width, 380);
  assert.equal(draft.height, 190);
});

test("rejects unsupported source nodes and empty selections", () => {
  assert.throws(() => createSplitCanvasNodeDraft(canvasNode({ kind: "role" }), {
    nodeId: "node_1",
    rangeStart: 0,
    rangeEnd: 4,
    text: "Role",
  }), /text content nodes/);

  assert.throws(() => createSplitCanvasNodeDraft(canvasNode({ kind: "reference" }), {
    nodeId: "node_1",
    rangeStart: 0,
    rangeEnd: 4,
    text: "   ",
  }), /selection is required/);
});

function canvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "node_1",
    projectId: "project_1",
    kind: "document",
    title: "Source",
    content: "Source content",
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    metadata: {},
    includeInProjectContext: false,
    createdAt: "2026-06-16T09:00:00.000Z",
    updatedAt: "2026-06-16T10:00:00.000Z",
    ...overrides,
  };
}
