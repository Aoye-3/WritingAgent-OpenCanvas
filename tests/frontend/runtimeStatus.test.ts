import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runtime status surfaces deployment mode and sandbox provider", () => {
  const types = readFileSync("src/features/settings/types.ts", "utf8");
  const settingsPanel = readFileSync("src/features/settings/components/AgentBackendRuntimePanel.tsx", "utf8");
  const dashboard = readFileSync("src/features/ai-dashboard/AiDashboardView.tsx", "utf8");

  assert.match(types, /deploymentMode: "local" \| "docker" \| "external"/);
  assert.match(types, /sandboxProvider: string/);
  assert.match(settingsPanel, /\["Deployment", status\.deploymentMode\]/);
  assert.match(settingsPanel, /\["Sandbox", status\.sandboxProvider\]/);
  assert.match(dashboard, /label="Deployment" value=\{dashboard\.runtime\.deploymentMode\}/);
  assert.match(dashboard, /label="Sandbox" value=\{dashboard\.runtime\.sandboxProvider\}/);
});
