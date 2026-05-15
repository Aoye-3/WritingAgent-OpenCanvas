import type { AgentSettings } from "../agentCards.js";
import { allowedToolDefinitions, type ToolRef, type ToolState } from "./catalog.js";

export type ToolPolicy = {
  name: ToolRef;
  tool: ToolRef;
  enabled: boolean;
  canAutoRun: boolean;
  requiresApproval: boolean;
  requiresExternalConfig: boolean;
  riskLevel: "low" | "medium" | "high";
};

export function buildToolPolicies(toolRefs: string[], toolState: ToolState | undefined): ToolPolicy[] {
  return allowedToolDefinitions(toolRefs).map((tool) => ({
    name: tool.name,
    tool: tool.name,
    enabled: Boolean(toolState?.[tool.name]),
    canAutoRun: Boolean(toolState?.[tool.name]) && !tool.requiresApproval && !tool.requiresExternalConfig,
    requiresApproval: tool.requiresApproval,
    requiresExternalConfig: tool.requiresExternalConfig,
    riskLevel: tool.riskLevel
  }));
}

export function isToolEnabledForAgent(
  tool: ToolRef,
  agentToolRefs: string[],
  settings: AgentSettings | undefined,
  toolState: ToolState | undefined
) {
  if (!agentToolRefs.includes(tool)) return false;
  if (settings?.tools?.[tool] === false) return false;
  return Boolean(toolState?.[tool]);
}
