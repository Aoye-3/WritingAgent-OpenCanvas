import test from "node:test";
import assert from "node:assert/strict";
import { removeCanvasNodeFromState } from "../../src/app/hooks/canvasActions/state.js";

test("removing a Canvas node also removes attached edges and clears selection", () => {
  const next = removeCanvasNodeFromState({
    nodeId: "node_1",
    nodes: [
      node("node_1"),
      node("node_2")
    ],
    edges: [
      edge("edge_1", "node_1", "node_2"),
      edge("edge_2", "node_2", "node_3")
    ],
    selectedNodeId: "node_1"
  });

  assert.deepEqual(next.nodes.map((item) => item.id), ["node_2"]);
  assert.deepEqual(next.edges.map((item) => item.id), ["edge_2"]);
  assert.equal(next.selectedNodeId, undefined);
});

function node(id: string) {
  return {
    id,
    threadId: "thread_1",
    kind: "document" as const,
    title: id,
    content: "",
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    metadata: {},
    createdAt: "",
    updatedAt: ""
  };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string) {
  return {
    id,
    threadId: "thread_1",
    sourceNodeId,
    targetNodeId,
    label: "",
    createdAt: "",
    updatedAt: ""
  };
}
