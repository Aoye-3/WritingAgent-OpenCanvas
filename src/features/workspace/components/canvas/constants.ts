import type { CanvasNodeKind } from "../../../agents/types";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export const MIN_NODE_SIZE: Record<CanvasNodeKind, { width: number; height: number }> = {
  document: { width: 260, height: 180 },
  note: { width: 220, height: 150 },
  reference: { width: 240, height: 160 }
};

export const MAX_NODE_WIDTH = 920;
export const MAX_NODE_HEIGHT = 2400;
export const AUTO_NODE_VERTICAL_CHROME = 112;

export const kindLabels: Record<CanvasNodeKind, { en: string; zh: string }> = {
  document: { en: "Document", zh: "文档" },
  note: { en: "Note", zh: "便签" },
  reference: { en: "Reference", zh: "引用" }
};

export const canvasNodeKinds = ["document", "note", "reference"] as const;
