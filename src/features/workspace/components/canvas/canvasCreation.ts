import type { CanvasNodeKind } from "../../../agents/types";
import type { CanvasNodeDraft } from "../../../canvas/canvasClient";
import { kindLabels } from "./constants";
import type { CanvasTool } from "./toolState";

type CreationTool = Extract<CanvasTool, "reference" | "document" | "note" | "role" | "text" | "shape" | "table">;
type NodeCreationTool = Extract<CreationTool, "reference" | "document" | "note" | "role">;
type CanvasSize = { width: number; height: number };
type CanvasPoint = { x: number; y: number };

const nodeToolKinds: Record<NodeCreationTool, CanvasNodeKind> = {
  reference: "reference",
  document: "document",
  note: "note",
  role: "role",
};

const creationSizes: Record<CreationTool, CanvasSize> = {
  reference: { width: 300, height: 190 },
  document: { width: 520, height: 260 },
  note: { width: 300, height: 190 },
  role: { width: 280, height: 190 },
  text: { width: 320, height: 40 },
  shape: { width: 220, height: 140 },
  table: { width: 360, height: 180 },
};

export function isPreviewCreationTool(tool: CanvasTool): tool is CreationTool {
  return tool in creationSizes;
}

export function getCanvasCreationSize(tool: CreationTool): CanvasSize {
  return creationSizes[tool];
}

export function pointToCenteredOrigin(point: CanvasPoint, size: CanvasSize): CanvasPoint {
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
  };
}

export function createCanvasNodeDraft(tool: NodeCreationTool, point: CanvasPoint, locale: "en" | "zh"): CanvasNodeDraft {
  const kind = nodeToolKinds[tool];
  const size = creationSizes[tool];
  const roleId = `role_${Date.now().toString(36)}`;
  const draft: CanvasNodeDraft = {
    kind,
    title: kindLabels[kind]?.[locale] ?? kind,
    content: "",
    x: Math.round(point.x),
    y: Math.round(point.y),
    ...size,
  };
  if (kind === "role") draft.metadata = { workflowRole: { roleId, label: "Role", prompt: "" } };
  return draft;
}
