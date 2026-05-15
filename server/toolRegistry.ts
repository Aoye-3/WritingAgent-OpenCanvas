import { allowedToolDefinitions, toolCatalog, type ToolDefinition, type ToolRef, type ToolState } from "./tools/catalog.js";

export { allowedToolDefinitions, toolCatalog as toolRegistry };
export type { ToolDefinition, ToolRef, ToolState };

export function enabledToolHints(toolRefs: string[], toolState: ToolState | undefined) {
  return allowedToolDefinitions(toolRefs)
    .filter((tool) => Boolean(toolState?.[tool.name]))
    .map((tool) => `- ${tool.name}: ${tool.promptHint}`);
}
