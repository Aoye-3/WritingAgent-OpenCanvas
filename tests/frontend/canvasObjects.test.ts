import assert from "node:assert/strict";
import test from "node:test";
import {
  createCanvasObjectDraft,
  normalizeStoredCanvasObject,
  validateCanvasObjectWrite,
} from "../../shared/canvasObjects.js";

test("creates typed default drafts for visual Canvas tools", () => {
  assert.deepEqual(createCanvasObjectDraft("shape", { x: 12, y: 34 }, "star"), {
    kind: "shape",
    geometry: { x: 12, y: 34, width: 220, height: 140 },
    data: { shapeId: "star" },
  });
  assert.deepEqual(createCanvasObjectDraft("table", { x: 12, y: 34 }), {
    kind: "table",
    geometry: { x: 12, y: 34, width: 360, height: 180 },
    data: { rows: [["", "", ""], ["", "", ""], ["", "", ""]] },
  });
});

test("strict writes reject invalid geometry and type-specific data", () => {
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "arrow", geometry: { startX: 0, startY: 0, endX: Number.NaN, endY: 1 }, data: {} }),
    /finite number/i,
  );
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "shape", geometry: { x: 0, y: 0, width: 10, height: 10 }, data: { shapeId: "missing" } }),
    /shape/i,
  );
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "table", geometry: { x: 0, y: 0, width: 10, height: 10 }, data: { rows: [["ok", 4]] } }),
    /table/i,
  );
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "asset", geometry: { x: 0, y: 0, width: 10, height: 10 }, data: { name: "x", relativePath: "uploads/x" } }),
    /asset/i,
  );
});

test("compatible reads normalize legacy objects and safely fall back", () => {
  const legacyShape = normalizeStoredCanvasObject({
    id: "object_1",
    threadId: "thread_1",
    kind: "shape",
    geometry: { x: 4, y: 5 },
    data: { shape: "star" },
    createdAt: "",
    updatedAt: "",
  });
  assert.deepEqual(legacyShape.geometry, { x: 4, y: 5, width: 220, height: 140 });
  assert.deepEqual(legacyShape.data, { shapeId: "star" });

  const invalid = normalizeStoredCanvasObject({
    id: "object_2",
    threadId: "thread_1",
    kind: "unknown",
    geometry: "bad",
    data: null,
    createdAt: "",
    updatedAt: "",
  });
  assert.equal(invalid.kind, "shape");
  assert.deepEqual(invalid.data, { shapeId: "rectangle" });
});
