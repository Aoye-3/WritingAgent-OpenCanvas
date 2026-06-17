import test from "node:test";
import assert from "node:assert/strict";
import { buildCanvasFlowNodes } from "../../src/features/workspace/components/canvas/flowMapping.js";

const callbacks = {
  onAcceptSuggestion: async () => {},
  onConvertSuggestionToNode: async () => {},
  onDeleteNode: async () => {},
  onIgnoreSuggestion: async () => {},
  onResizeStateChange: () => {},
  onTextSelectionChange: () => {},
  onUpdateNode: async () => {}
};

test("Canvas flow mapping preserves live geometry while a node is resizing", () => {
  const nodes = [{
    id: "node_1",
    threadId: "thread_1",
    kind: "document" as const,
    title: "Draft",
    content: "Body",
    x: 10,
    y: 20,
    width: 300,
    height: 180,
    metadata: {},
    createdAt: "",
    updatedAt: ""
  }];
  const currentNodes = [{
    id: "node_1",
    position: { x: 55, y: 65 },
    style: { width: 420, height: 260 },
    dragging: false
  }];

  const flowNodes = buildCanvasFlowNodes({
    nodes,
    currentNodes,
    selectedNodeId: "node_1",
    resizingNodeId: "node_1",
    locale: "en",
    suggestions: [],
    callbacks
  });

  assert.equal(flowNodes[0].selected, true);
  assert.deepEqual(flowNodes[0].position, { x: 55, y: 65 });
  assert.equal(flowNodes[0].style.width, 420);
  assert.equal(flowNodes[0].data.isResizing, true);
});

test("Canvas flow mapping keeps unselected nodes draggable in select mode", () => {
  const nodes = [{
    id: "node_1",
    threadId: "thread_1",
    kind: "document" as const,
    title: "Draft",
    content: "Body",
    x: 10,
    y: 20,
    width: 300,
    height: 180,
    metadata: {},
    createdAt: "",
    updatedAt: ""
  }];

  const flowNodes = buildCanvasFlowNodes({
    nodes,
    currentNodes: [],
    selectedNodeId: undefined,
    resizingNodeId: null,
    locale: "en",
    suggestions: [],
    callbacks
  });

  assert.equal(flowNodes[0].selected, false);
  assert.equal(flowNodes[0].draggable, true);
});

test("Canvas flow mapping preserves multi-selected node state", () => {
  const nodes = [
    canvasNode("node_1", 10),
    canvasNode("node_2", 220),
    canvasNode("node_3", 430)
  ];

  const flowNodes = buildCanvasFlowNodes({
    nodes,
    currentNodes: [],
    selectedNodeId: "node_1",
    selectedNodeIds: ["node_1", "node_2"],
    resizingNodeId: null,
    locale: "en",
    suggestions: [],
    callbacks
  });

  assert.deepEqual(flowNodes.map((node) => node.selected), [true, true, false]);
});

function canvasNode(id: string, x: number) {
  return {
    id,
    threadId: "thread_1",
    kind: "document" as const,
    title: "Draft",
    content: "Body",
    x,
    y: 20,
    width: 300,
    height: 180,
    metadata: {},
    createdAt: "",
    updatedAt: ""
  };
}

test("Canvas flow mapping attaches only suggestions owned by the mapped node", () => {
  const nodes = [
    {
      id: "role_1",
      threadId: "thread_1",
      kind: "role" as const,
      title: "Style",
      content: "",
      x: 0,
      y: 0,
      width: 260,
      height: 180,
      metadata: {},
      createdAt: "",
      updatedAt: ""
    },
    {
      id: "node_1",
      threadId: "thread_1",
      kind: "document" as const,
      title: "Draft",
      content: "",
      x: 300,
      y: 0,
      width: 320,
      height: 220,
      metadata: {},
      createdAt: "",
      updatedAt: ""
    }
  ];

  const flowNodes = buildCanvasFlowNodes({
    nodes,
    currentNodes: [],
    selectedNodeId: undefined,
    resizingNodeId: null,
    locale: "en",
    suggestions: [
      suggestion("suggestion_1", "role_1"),
      suggestion("suggestion_2", "node_1")
    ],
    callbacks
  });

  assert.deepEqual(flowNodes.map((node) => node.data.suggestions.map((item) => item.id)), [["suggestion_1"], ["suggestion_2"]]);
});

function suggestion(id: string, nodeId: string) {
  return {
    id,
    threadId: "thread_1",
    nodeId,
    roleNodeId: nodeId,
    targetNodeId: "node_1",
    roleId: "style",
    content: "Tighten prose.",
    rationale: "",
    status: "pending" as const,
    createdAt: "",
    updatedAt: ""
  };
}
