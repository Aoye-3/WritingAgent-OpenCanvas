import assert from "node:assert/strict";
import test from "node:test";
import { createInverseCanvasObjectPatch } from "../../shared/canvasHistory.js";

test("object update history restores kind, geometry, and data", () => {
  const previous = {
    id: "object_1",
    kind: "shape" as const,
    geometry: { x: 1, y: 2, width: 220, height: 140 },
    data: { shapeId: "star" as const },
  };

  assert.deepEqual(createInverseCanvasObjectPatch(previous, {
    kind: "table",
    geometry: { x: 8, y: 9, width: 360, height: 180 },
    data: { rows: [["changed"]] },
  }), {
    kind: "shape",
    geometry: previous.geometry,
    data: previous.data,
  });
});
