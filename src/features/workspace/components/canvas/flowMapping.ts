import type { CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../canvas/canvasClient";
import { readDimension } from "./nodeLayout";
import type { CanvasFlowNode, CanvasLocale } from "./types";

type CanvasFlowCallbacks = {
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onCreationPreviewBlocked: () => void;
  onRequestNodeMenu: (nodeId: string, screen: { x: number; y: number }) => void;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
};

type BuildCanvasFlowNodesInput = {
  nodes: CanvasNode[];
  currentNodes: Pick<CanvasFlowNode, "id" | "position" | "style" | "dragging">[];
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  resizingNodeId: string | null;
  locale: CanvasLocale;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  writeRequests?: CanvasWriteRequest[];
  agentCardId?: string;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  callbacks: CanvasFlowCallbacks;
};

export function buildCanvasFlowNodes({
  nodes,
  currentNodes,
  selectedNodeId,
  selectedNodeIds = [],
  resizingNodeId,
  locale,
  workflow,
  suggestions,
  writeRequests = [],
  agentCardId,
  modelOverrides,
  callbacks
}: BuildCanvasFlowNodesInput): CanvasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const selectedNodeSet = new Set(selectedNodeIds);
  return nodes.map((node) => {
    const current = currentById.get(node.id);
    const nodeSuggestions = suggestions.filter((suggestion) => suggestion.nodeId === node.id);
    const preserveLiveGeometry = current?.dragging || node.id === resizingNodeId;
    const liveWidth = readDimension(current?.style?.width, node.width);
    const liveHeight = readDimension(current?.style?.height, node.height);
    return {
      id: node.id,
      type: "canvasNode",
      draggable: !resizingNodeId,
      position: preserveLiveGeometry && current ? current.position : { x: node.x, y: node.y },
      selected: selectedNodeSet.has(node.id) || node.id === selectedNodeId,
      style: { width: preserveLiveGeometry ? liveWidth : node.width, height: preserveLiveGeometry ? liveHeight : node.height },
      width: preserveLiveGeometry ? liveWidth : node.width,
      height: preserveLiveGeometry ? liveHeight : node.height,
      data: {
        isResizing: node.id === resizingNodeId,
        locale,
        node,
        suggestions: nodeSuggestions,
        writeRequests: writeRequests.filter((request) => request.targetNodeId === node.id && request.status === "pending"),
        agentCardId,
        modelOverrides,
        workflow,
        ...callbacks
      }
    };
  });
}
