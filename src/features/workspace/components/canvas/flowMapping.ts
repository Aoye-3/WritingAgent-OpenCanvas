import type { CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion } from "../../../agents/types";
import type { CanvasNodePatch } from "../../../canvas/canvasClient";
import { readDimension } from "./nodeLayout";
import type { CanvasFlowNode, CanvasLocale } from "./types";

type CanvasFlowCallbacks = {
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

type BuildCanvasFlowNodesInput = {
  nodes: CanvasNode[];
  currentNodes: Pick<CanvasFlowNode, "id" | "position" | "style" | "dragging">[];
  selectedNodeId?: string;
  resizingNodeId: string | null;
  locale: CanvasLocale;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  callbacks: CanvasFlowCallbacks;
};

export function buildCanvasFlowNodes({
  nodes,
  currentNodes,
  selectedNodeId,
  resizingNodeId,
  locale,
  workflow,
  suggestions,
  callbacks
}: BuildCanvasFlowNodesInput): CanvasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
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
      dragHandle: ".canvas-node-drag-handle",
      position: preserveLiveGeometry && current ? current.position : { x: node.x, y: node.y },
      selected: node.id === selectedNodeId,
      style: { width: preserveLiveGeometry ? liveWidth : node.width, height: preserveLiveGeometry ? liveHeight : node.height },
      width: preserveLiveGeometry ? liveWidth : node.width,
      height: preserveLiveGeometry ? liveHeight : node.height,
      data: {
        isResizing: node.id === resizingNodeId,
        locale,
        node,
        suggestions: nodeSuggestions,
        workflow,
        ...callbacks
      }
    };
  });
}
