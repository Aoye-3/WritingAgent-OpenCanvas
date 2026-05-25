import type { Node } from "@xyflow/react";
import type { CanvasNode } from "../../../agents/types";
import type { CanvasNodePatch } from "../../../canvas/canvasClient";

export type CanvasLocale = "en" | "zh";

export type CanvasFlowNodeData = {
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasNode">;

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type CanvasNodeMetadata = Record<string, unknown> & {
  canvasLayout?: {
    sizeMode?: "auto" | "manual";
  };
};
