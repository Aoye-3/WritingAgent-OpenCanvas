import assert from "node:assert/strict";
import test from "node:test";
import { completeCanvasToolAction, isCanvasCreationTool } from "../../src/features/workspace/components/canvas/toolState.js";

test("creation tools return to select after one action", () => {
  assert.equal(completeCanvasToolAction("document"), "select");
  assert.equal(completeCanvasToolAction("reference"), "select");
  assert.equal(completeCanvasToolAction("arrow"), "select");
});

test("navigation tools remain active until explicitly changed", () => {
  assert.equal(completeCanvasToolAction("select"), "select");
  assert.equal(completeCanvasToolAction("pan"), "pan");
});

test("identifies tools that create canvas content", () => {
  assert.equal(isCanvasCreationTool("note"), true);
  assert.equal(isCanvasCreationTool("agent"), false);
  assert.equal(isCanvasCreationTool("pan"), false);
});
