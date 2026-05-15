import { getToolDefinition, type ToolRef, type ToolState } from "./catalog.js";

export type ToolPolicyDecision = {
  allowed: boolean;
  reason?: string;
};

export function evaluateToolExecutionPolicy(input: {
  toolName: string;
  allowedToolRefs?: string[];
  toolState?: ToolState;
}): ToolPolicyDecision {
  const definition = getToolDefinition(input.toolName);
  if (!definition) {
    return { allowed: false, reason: `Unknown tool: ${input.toolName}` };
  }

  if (input.allowedToolRefs && !input.allowedToolRefs.includes(definition.name)) {
    return { allowed: false, reason: `Tool is not allowed for this Agent: ${definition.name}` };
  }

  if (input.toolState && !input.toolState[definition.name]) {
    return { allowed: false, reason: `Tool is disabled for this run: ${definition.name}` };
  }

  if (definition.requiresExternalConfig) {
    return { allowed: false, reason: `${definition.label} is not configured. Add external configuration before it can run.` };
  }

  return { allowed: true };
}

export function isToolRef(name: string): name is ToolRef {
  return Boolean(getToolDefinition(name));
}
