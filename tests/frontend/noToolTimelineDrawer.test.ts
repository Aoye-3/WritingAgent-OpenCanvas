import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("AI collaboration drawer does not mount the tool timeline drawer", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.doesNotMatch(source, /ToolEventDrawer/);
  assert.doesNotMatch(source, /toolEvents=\{/);
  assert.doesNotMatch(source, /runTimelineEvents=\{/);
});
