import type { CanvasNodeKind } from "../../../agents/types";
import { AUTO_NODE_VERTICAL_CHROME, MAX_NODE_HEIGHT, MAX_NODE_WIDTH, MIN_NODE_SIZE } from "./constants";
import type { CanvasNodeMetadata, ResizeHandle } from "./types";

export function computeResize(
  handle: ResizeHandle,
  start: { clientX: number; clientY: number; x: number; y: number; width: number; height: number; zoom: number },
  clientX: number,
  clientY: number,
  minSize: { width: number; height: number }
) {
  const dx = (clientX - start.clientX) / start.zoom;
  const dy = (clientY - start.clientY) / start.zoom;
  const movesLeft = handle.includes("w");
  const movesRight = handle.includes("e");
  const movesTop = handle.includes("n");
  const movesBottom = handle.includes("s");
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (movesRight) width = clamp(start.width + dx, minSize.width, MAX_NODE_WIDTH);
  if (movesBottom) height = clamp(start.height + dy, minSize.height, MAX_NODE_HEIGHT);
  if (movesLeft) {
    width = clamp(start.width - dx, minSize.width, MAX_NODE_WIDTH);
    x = start.x + start.width - width;
  }
  if (movesTop) {
    height = clamp(start.height - dy, minSize.height, MAX_NODE_HEIGHT);
    y = start.y + start.height - height;
  }

  return { x, y, width, height };
}

export function getAutoNodeHeight(kind: CanvasNodeKind, contentScrollHeight: number) {
  return Math.ceil(clamp(contentScrollHeight + AUTO_NODE_VERTICAL_CHROME, MIN_NODE_SIZE[kind].height, MAX_NODE_HEIGHT));
}

export function hasManualCanvasSize(metadata: unknown) {
  return readCanvasNodeMetadata(metadata).canvasLayout?.sizeMode === "manual";
}

export function isKnownCanvasKind(kind: string): kind is CanvasNodeKind {
  return kind === "document" || kind === "note" || kind === "reference" || kind === "role" || kind === "plan" || kind === "file_document" || kind === "clarification";
}

export function readCanvasNodeMetadata(metadata: unknown): CanvasNodeMetadata {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as CanvasNodeMetadata : {};
}

export type CanvasDiagramMetadata = {
  deliveryId?: string;
  module: "diagram_delivery";
  diagramKind?: "mindmap" | "userflow" | "flowchart" | "freeform";
  layout?: "radial" | "tree" | "left-right" | "freeform";
  shape: "rounded" | "rect" | "diamond" | "parallelogram" | "circle" | "database" | "document";
  tone: "primary" | "success" | "warning" | "danger" | "neutral";
  sourceId?: string;
  parentId?: string;
};

export function readDiagramMetadata(metadata: unknown): CanvasDiagramMetadata | undefined {
  const diagram = readCanvasNodeMetadata(metadata).diagram;
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram)) return undefined;
  const record = diagram as Record<string, unknown>;
  if (record.module !== "diagram_delivery") return undefined;
  const shape = readDiagramShape(record.shape);
  return {
    deliveryId: readOptionalString(record.deliveryId),
    module: "diagram_delivery",
    diagramKind: readDiagramKind(record.diagramKind),
    layout: readDiagramLayout(record.layout),
    shape,
    tone: readDiagramTone(record.tone),
    sourceId: readOptionalString(record.sourceId),
    parentId: readOptionalString(record.parentId)
  };
}

export function readDimension(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function withManualCanvasSize(metadata: unknown): CanvasNodeMetadata {
  const current = readCanvasNodeMetadata(metadata);
  const currentLayout = current.canvasLayout && typeof current.canvasLayout === "object" ? current.canvasLayout : {};
  return {
    ...current,
    canvasLayout: {
      ...currentLayout,
      sizeMode: "manual"
    }
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readDiagramShape(value: unknown): CanvasDiagramMetadata["shape"] {
  return value === "rect" || value === "diamond" || value === "parallelogram" || value === "circle" || value === "database" || value === "document" ? value : "rounded";
}

function readDiagramTone(value: unknown): CanvasDiagramMetadata["tone"] {
  return value === "primary" || value === "success" || value === "warning" || value === "danger" ? value : "neutral";
}

function readDiagramKind(value: unknown): CanvasDiagramMetadata["diagramKind"] | undefined {
  return value === "mindmap" || value === "userflow" || value === "flowchart" || value === "freeform" ? value : undefined;
}

function readDiagramLayout(value: unknown): CanvasDiagramMetadata["layout"] | undefined {
  return value === "radial" || value === "tree" || value === "left-right" || value === "freeform" ? value : undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
