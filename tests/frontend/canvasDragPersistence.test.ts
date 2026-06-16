import test from "node:test";
import assert from "node:assert/strict";
import { collectDraggedNodePositionPatches } from "../../src/features/workspace/components/canvas/dragPersistence.js";

test("persists every selected node position when dragging a selected group", () => {
  const patches = collectDraggedNodePositionPatches({
    draggedNodeId: "node_1",
    selectedNodeIds: ["node_1", "node_2"],
    flowNodes: [
      { id: "node_1", position: { x: 12.4, y: 20.6 } },
      { id: "node_2", position: { x: 100.2, y: 210.8 } },
      { id: "node_3", position: { x: 300, y: 400 } }
    ]
  });

  assert.deepEqual(patches, [
    { nodeId: "node_1", patch: { x: 12, y: 21 } },
    { nodeId: "node_2", patch: { x: 100, y: 211 } }
  ]);
});

test("persists only the dragged node when it is not part of a selected group", () => {
  const patches = collectDraggedNodePositionPatches({
    draggedNodeId: "node_3",
    selectedNodeIds: ["node_1", "node_2"],
    flowNodes: [
      { id: "node_1", position: { x: 12, y: 20 } },
      { id: "node_2", position: { x: 100, y: 210 } },
      { id: "node_3", position: { x: 302.7, y: 404.2 } }
    ]
  });

  assert.deepEqual(patches, [
    { nodeId: "node_3", patch: { x: 303, y: 404 } }
  ]);
});
