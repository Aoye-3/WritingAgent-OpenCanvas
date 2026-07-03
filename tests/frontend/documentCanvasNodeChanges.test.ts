import test from "node:test";
import assert from "node:assert/strict";
import { applyNodeChanges } from "@xyflow/react";
import { filterCanvasNodeChanges, sameFlowNodeViewArray } from "../../src/features/workspace/components/canvas/nodeChanges.js";

test("Canvas node changes keep dimensions measurements while blocking active resize positions", () => {
  const changes = [
    { id: "node_1", type: "dimensions", dimensions: { width: 320, height: 220 }, setAttributes: true },
    { id: "node_1", type: "position", position: { x: 40, y: 50 }, dragging: true },
    { id: "node_2", type: "select", selected: true },
    { id: "node_3", type: "remove" }
  ] as Parameters<typeof filterCanvasNodeChanges>[0];

  const allowed = filterCanvasNodeChanges(changes, "node_1");

  assert.deepEqual(allowed.map((change) => change.type), ["dimensions", "select"]);
});

test("Canvas node changes write React Flow measured dimensions into controlled nodes", () => {
  const nodes = [{
    id: "node_1",
    type: "canvasNode",
    position: { x: 0, y: 0 },
    data: {},
    width: 300,
    height: 180,
    style: { width: 300, height: 180 }
  }];
  const changes = filterCanvasNodeChanges([
    { id: "node_1", type: "dimensions", dimensions: { width: 300, height: 180 }, setAttributes: true }
  ] as Parameters<typeof filterCanvasNodeChanges>[0], null);

  const nextNodes = applyNodeChanges(changes, nodes);

  assert.deepEqual(nextNodes[0].measured, { width: 300, height: 180 });
});

test("Canvas flow view comparison detects measured dimension changes", () => {
  const baseNode = {
    id: "node_1",
    position: { x: 0, y: 0 },
    selected: true,
    dragging: false,
    width: 300,
    height: 180,
    style: { width: 300, height: 180 }
  };

  assert.equal(sameFlowNodeViewArray([baseNode] as never, [{ ...baseNode, measured: { width: 300, height: 180 } }] as never), false);
  assert.equal(
    sameFlowNodeViewArray(
      [{ ...baseNode, measured: { width: 300, height: 180 } }] as never,
      [{ ...baseNode, measured: { width: 300, height: 180 } }] as never
    ),
    true
  );
});
