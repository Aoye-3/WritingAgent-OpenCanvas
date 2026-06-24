import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Canvas binds Ctrl/Cmd+Z to the existing undo action outside editable fields", () => {
  const source = readFileSync("src/features/workspace/components/DocumentCanvas.tsx", "utf8");

  assert.match(source, /handleUndoShortcut/);
  assert.match(source, /event\.key\.toLowerCase\(\) !== "z"/);
  assert.match(source, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(source, /HTMLInputElement/);
  assert.match(source, /HTMLTextAreaElement/);
  assert.match(source, /isContentEditable/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*void onUndo\(\);/);
});
