export type CanvasTool =
  | "select"
  | "pan"
  | "reference"
  | "document"
  | "note"
  | "text"
  | "arrow"
  | "shape"
  | "table"
  | "asset"
  | "role"
  | "clarification"
  | "agent";

const creationTools = new Set<CanvasTool>(["reference", "document", "note", "text", "arrow", "shape", "table", "asset", "role", "clarification"]);

export function isCanvasCreationTool(tool: CanvasTool) {
  return creationTools.has(tool);
}

export function completeCanvasToolAction(tool: CanvasTool): CanvasTool {
  return isCanvasCreationTool(tool) ? "select" : tool;
}
