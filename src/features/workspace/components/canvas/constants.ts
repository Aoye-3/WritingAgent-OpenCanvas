import type { CanvasNodeKind, CanvasWorkflowMode, CanvasWorkflowStage } from "../../../agents/types";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export const MIN_NODE_SIZE: Record<CanvasNodeKind, { width: number; height: number }> = {
  document: { width: 260, height: 180 },
  note: { width: 220, height: 150 },
  reference: { width: 240, height: 160 },
  role: { width: 240, height: 170 },
  plan: { width: 320, height: 220 }
};

export const MAX_NODE_WIDTH = 920;
export const MAX_NODE_HEIGHT = 2400;
export const AUTO_NODE_VERTICAL_CHROME = 112;

export const kindLabels: Record<string, { en: string; zh: string }> = {
  document: { en: "Document", zh: "文档" },
  note: { en: "Note", zh: "便签" },
  reference: { en: "Reference", zh: "引用" },
  role: { en: "role", zh: "角色" },
  plan: { en: "Plan", zh: "计划" }
};

export const canvasNodeKinds = ["document", "note", "reference", "role", "plan"] as const;

export const workflowStageLabels: Record<CanvasWorkflowStage, { en: string; zh: string }> = {
  inspiration: { en: "Inspiration", zh: "灵感" },
  research: { en: "Research", zh: "研究" },
  structure: { en: "Structure", zh: "结构" },
  writing: { en: "Writing", zh: "写作" },
  polish: { en: "Polish", zh: "润色" },
  publish: { en: "Publish", zh: "发布" }
};

export const workflowModeLabels: Record<CanvasWorkflowMode, { en: string; zh: string }> = {
  batch_delivery: { en: "Batch delivery", zh: "批次交付" },
  mind_map: { en: "Mind map", zh: "思维导图" },
  user_flow: { en: "User flow", zh: "用户流程" },
  freeform_diagram: { en: "Freeform", zh: "自由图形" }
};
