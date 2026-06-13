import test from "node:test";
import assert from "node:assert/strict";
import { extractTopLevelListItems, splitCanvasText } from "./canvasDelivery.js";

test("offers Canvas delivery only for three or more top-level points", () => {
  assert.equal(extractTopLevelListItems("- One\n- Two").length, 0);
  assert.deepEqual(extractTopLevelListItems("- One\n- Two\n- Three").map((item) => item.content), ["One", "Two", "Three"]);
});

test("splits long delivery text near the configured node target", () => {
  const chunks = splitCanvasText(`${"甲".repeat(1300)}\n\n${"乙".repeat(1300)}`);
  assert.equal(chunks.length, 4);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
});
