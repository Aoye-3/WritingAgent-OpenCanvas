import test from "node:test";
import assert from "node:assert/strict";
import {
  createInverseCanvasNodePatch,
  pushCanvasHistoryEntry,
  type CanvasHistoryEdge,
  type CanvasHistoryNode
} from "../shared/canvasHistory.js";

const node: CanvasHistoryNode = {
  id: "node_1",
  kind: "document",
  title: "Before",
  content: "Old content",
  x: 10,
  y: 20,
  width: 300,
  height: 180,
  metadata: { canvasLayout: { sizeMode: "auto" } }
};

test("limits canvas history to configured depth", () => {
  const first = pushCanvasHistoryEntry([], { kind: "deleteNode", nodeId: "node_1" }, 2);
  const second = pushCanvasHistoryEntry(first, { kind: "deleteEdge", edgeId: "edge_1" }, 2);
  const third = pushCanvasHistoryEntry(second, { kind: "deleteNode", nodeId: "node_2" }, 2);

  assert.deepEqual(third, [
    { kind: "deleteNode", nodeId: "node_2" },
    { kind: "deleteEdge", edgeId: "edge_1" }
  ]);
});

test("creates inverse canvas node patch only for changed fields", () => {
  const inverse = createInverseCanvasNodePatch(node, {
    title: "After",
    x: 40,
    metadata: { canvasLayout: { sizeMode: "manual" } }
  });

  assert.deepEqual(inverse, {
    title: "Before",
    x: 10,
    metadata: { canvasLayout: { sizeMode: "auto" } }
  });
});

test("keeps restore edge entries structurally serializable", () => {
  const edge: CanvasHistoryEdge = {
    id: "edge_1",
    sourceNodeId: "node_1",
    targetNodeId: "node_2",
    label: ""
  };
  const history = pushCanvasHistoryEntry([], { kind: "restoreEdge", edge }, 20);

  assert.equal(history[0]?.kind, "restoreEdge");
  assert.deepEqual(history[0], { kind: "restoreEdge", edge });
});
