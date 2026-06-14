import assert from "node:assert/strict";
import test from "node:test";
import { resizeHandles } from "../../src/features/workspace/components/canvas/CanvasNodeFrame.js";

test("Canvas node resize uses draggable edges instead of point handles", () => {
  assert.deepEqual(resizeHandles, ["n", "e", "s", "w"]);
});
