import test from "node:test";
import assert from "node:assert/strict";
import { workflowModeLabels } from "../../src/features/workspace/components/canvas/constants.js";

test("Canvas workflow mode labels expose diagram delivery entry points", () => {
  assert.equal(workflowModeLabels.batch_delivery.zh, "批次交付");
  assert.equal(workflowModeLabels.mind_map.zh, "思维导图");
  assert.equal(workflowModeLabels.user_flow.zh, "用户流程");
  assert.equal(workflowModeLabels.freeform_diagram.zh, "自由图形");
});
