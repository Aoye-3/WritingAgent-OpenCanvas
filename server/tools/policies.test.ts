import test from "node:test";
import assert from "node:assert/strict";
import { buildToolPolicies, isToolEnabledForAgent } from "./policies.js";
import { toolCatalog } from "./catalog.js";

test("catalog marks canvas writes as approval-gated", () => {
  const canvasWrite = toolCatalog.find((tool) => tool.name === "canvas_write");

  assert.equal(canvasWrite?.riskLevel, "high");
  assert.equal(canvasWrite?.requiresApproval, true);
  assert.equal(canvasWrite?.requiresExternalConfig, false);
});

test("tool policies separate enabled state from approval requirements", () => {
  const policies = buildToolPolicies(["knowledge_base", "canvas_write", "web_search"], {
    knowledge_base: true,
    canvas_write: true,
    web_search: false
  });

  assert.deepEqual(
    policies.map((policy) => ({
      tool: policy.tool,
      enabled: policy.enabled,
      canAutoRun: policy.canAutoRun,
      requiresApproval: policy.requiresApproval
    })),
    [
      { tool: "web_search", enabled: false, canAutoRun: false, requiresApproval: false },
      { tool: "knowledge_base", enabled: true, canAutoRun: true, requiresApproval: false },
      { tool: "canvas_write", enabled: true, canAutoRun: false, requiresApproval: true }
    ]
  );
});

test("agent tool enablement respects agent refs, settings, and request state", () => {
  assert.equal(isToolEnabledForAgent("canvas_write", ["canvas_write"], undefined, {}), false);
  assert.equal(isToolEnabledForAgent("canvas_write", ["knowledge_base"], undefined, { canvas_write: true }), false);
  assert.equal(isToolEnabledForAgent("canvas_write", ["canvas_write"], { tools: { canvas_write: false } } as never, { canvas_write: true }), false);
  assert.equal(isToolEnabledForAgent("canvas_write", ["canvas_write"], undefined, { canvas_write: true }), true);
});
