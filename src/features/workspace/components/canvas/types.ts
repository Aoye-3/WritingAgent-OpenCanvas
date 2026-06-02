import type { Node } from "@xyflow/react";
import type { CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion } from "../../../agents/types";
import type { CanvasNodePatch } from "../../../canvas/canvasClient";

export type CanvasLocale = "en" | "zh";

export type CanvasFlowNodeData = {
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  suggestions: CanvasWorkflowSuggestion[];
  onDeleteNode: (nodeId: string) => Promise<void>;
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  workflow?: CanvasWorkflow;
};

export type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasNode">;

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type CanvasNodeMetadata = Record<string, unknown> & {
  canvasLayout?: {
    sizeMode?: "auto" | "manual";
  };
};
