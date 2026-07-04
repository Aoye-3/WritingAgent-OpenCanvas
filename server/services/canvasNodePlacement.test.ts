import test from "node:test";
import assert from "node:assert/strict";
import { canvasRectsOverlap, findAvailableCanvasNodePosition } from "./canvasNodePlacement.js";

const baseNode = {
  projectId: "project_1",
  kind: "document",
  title: "Node",
  content: "",
  metadata: {},
  includeInProjectContext: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} as const;

test("places the first automatic canvas node at the default position", () => {
  assert.deepEqual(findAvailableCanvasNodePosition({ existingNodes: [] }), { x: 120, y: 120 });
});

test("places anchored automatic nodes beside the anchor without overlap", () => {
  const anchor = { ...baseNode, id: "node_anchor", x: 120, y: 120, width: 320, height: 220 };
  const position = findAvailableCanvasNodePosition({
    existingNodes: [anchor],
    anchorNodeId: anchor.id
  });

  assert.deepEqual(position, { x: 472, y: 120 });
  assert.equal(canvasRectsOverlap({ ...position, width: 320, height: 220 }, anchor), false);
});

test("uses the existing node group center when no anchor is available", () => {
  const existingNodes = [
    { ...baseNode, id: "node_a", x: 120, y: 120, width: 320, height: 220 },
    { ...baseNode, id: "node_b", x: 472, y: 120, width: 320, height: 220 }
  ];
  const position = findAvailableCanvasNodePosition({ existingNodes });

  assert.notDeepEqual(position, { x: 120, y: 120 });
  assert.equal(existingNodes.some((node) => canvasRectsOverlap({ ...position, width: 320, height: 220 }, node)), false);
});
