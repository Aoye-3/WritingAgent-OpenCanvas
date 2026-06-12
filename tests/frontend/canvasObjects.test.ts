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
  assert.deepEqual(createCanvasObjectDraft("text", { x: 12, y: 34 }), {
    kind: "text",
    geometry: { x: 12, y: 34, width: 320, height: 40 },
    data: { text: "", fontSize: 16, color: "#1f2937" },
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
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "text", geometry: { x: 0, y: 0, width: 320, height: 40 }, data: { text: "x", fontSize: 18, color: "#1f2937" } }),
    /font size/i,
  );
  assert.throws(
    () => validateCanvasObjectWrite({ kind: "text", geometry: { x: 0, y: 0, width: 320, height: 40 }, data: { text: "x", fontSize: 16, color: "red" } }),
    /color/i,
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

  const text = normalizeStoredCanvasObject({
    id: "object_3",
    threadId: "thread_1",
    kind: "text",
    geometry: { x: 4, y: 5 },
    data: { text: 4, fontSize: 18, color: "red" },
    createdAt: "",
    updatedAt: "",
  });
  assert.equal(text.kind, "text");
  assert.deepEqual(text.geometry, { x: 4, y: 5, width: 320, height: 40 });
  assert.deepEqual(text.data, { text: "", fontSize: 16, color: "#1f2937" });
});
