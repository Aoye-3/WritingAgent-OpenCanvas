import assert from "node:assert/strict";
import test from "node:test";
import { filterCanvasShapes, getCanvasShape } from "../../src/features/workspace/components/canvas/shapeCatalog.js";

test("filters shapes by localized label and category", () => {
  assert.deepEqual(filterCanvasShapes("decision", "en").map((shape) => shape.id), ["diamond"]);
  assert.equal(filterCanvasShapes("流程", "zh").some((shape) => shape.id === "process"), true);
});

test("looks up a shape definition and falls back to rectangle", () => {
  assert.equal(getCanvasShape("star").id, "star");
  assert.equal(getCanvasShape("missing").id, "rectangle");
});
