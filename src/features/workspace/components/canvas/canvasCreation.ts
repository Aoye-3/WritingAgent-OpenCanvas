import type { CanvasNodeKind } from "../../../agents/types";
import type { CanvasNodeDraft } from "../../../canvas/canvasClient";
import { kindLabels } from "./constants";
import type { CanvasTool } from "./toolState";

type CreationTool = Extract<CanvasTool, "reference" | "document" | "note" | "role" | "clarification" | "text" | "shape" | "table">;
type NodeCreationTool = Extract<CreationTool, "reference" | "document" | "note" | "role" | "clarification"> | "file_document";
type CanvasSize = { width: number; height: number };
type CanvasPoint = { x: number; y: number };

const nodeToolKinds: Record<NodeCreationTool, CanvasNodeKind> = {
  reference: "reference",
  document: "document",
  note: "note",
  role: "role",
  clarification: "clarification",
  file_document: "file_document",
};

const creationSizes: Record<CreationTool, CanvasSize> = {
  reference: { width: 420, height: 190 },
  document: { width: 640, height: 260 },
  note: { width: 380, height: 190 },
  role: { width: 340, height: 190 },
  clarification: { width: 420, height: 260 },
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
  const size = tool === "file_document" ? { width: 360, height: 220 } : creationSizes[tool];
  const roleId = `role_${Date.now().toString(36)}`;
  const draft: CanvasNodeDraft = {
    kind,
    title: kindLabels[kind]?.[locale] ?? kind,
    content: kind === "file_document"
      ? `# ${kindLabels[kind]?.[locale] ?? kind}\n\n- ${locale === "zh" ? "状态" : "Status"}: ${locale === "zh" ? "等待绑定 Markdown 文件" : "Waiting for a Markdown file"}`
      : "",
    x: Math.round(point.x),
    y: Math.round(point.y),
    ...size,
  };
  if (kind === "role") draft.metadata = { workflowRole: { roleId, label: "Role", prompt: "" } };
  if (kind === "clarification") {
    draft.content = locale === "zh"
      ? "# 澄清确认\n\n等待配置问题和选项。"
      : "# Clarification\n\nWaiting for a question and options.";
    draft.metadata = {
      clarification: {
        question: locale === "zh" ? "需要确认的问题" : "Question to clarify",
        options: [],
        status: "pending",
        source: "manual"
      }
    };
    draft.includeInProjectContext = false;
  }
  return draft;
}
