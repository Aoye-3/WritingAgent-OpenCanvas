import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("AI collaboration drawer does not mount the tool timeline drawer", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.doesNotMatch(source, /ToolEventDrawer/);
  assert.doesNotMatch(source, /toolEvents=\{/);
  assert.doesNotMatch(source, /runTimelineEvents=\{/);
});

test("AI collaboration drawer filters Canvas delivery started timeline rows from raw logs", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /isCanvasDeliveryStartedTimelineEvent/);
  assert.match(source, /canvas_delivery_\.\*_started/);
  assert.match(source, /!isCanvasDeliveryStartedTimelineEvent\(event\)/);
});
