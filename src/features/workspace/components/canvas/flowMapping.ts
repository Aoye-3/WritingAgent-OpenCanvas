import type { CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../canvas/canvasClient";
import { readDimension } from "./nodeLayout";
import type { CanvasFlowNode, CanvasLocale, CanvasTextSelection } from "./types";

type CanvasFlowCallbacks = {
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onOpenDocumentPreview: (node: CanvasNode) => void;
  onCreationPreviewBlocked: () => void;
  onRequestNodeMenu: (nodeId: string, screen: { x: number; y: number }) => void;
  onTextSelectionChange: (selection?: CanvasTextSelection) => void;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
};

type BuildCanvasFlowNodesInput = {
  nodes: CanvasNode[];
  currentNodes: CanvasFlowNode[];
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

const emptySuggestions: CanvasWorkflowSuggestion[] = [];
const emptyWriteRequests: CanvasWriteRequest[] = [];

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
  const suggestionsByNodeId = groupByNodeId(suggestions, (suggestion) => suggestion.nodeId);
  const pendingWriteRequestsByNodeId = groupByNodeId(
    writeRequests.filter((request) => request.status === "pending" && request.targetNodeId),
    (request) => request.targetNodeId ?? ""
  );
  return nodes.map((node) => {
    const current = currentById.get(node.id);
    const preserveLiveGeometry = current?.dragging || node.id === resizingNodeId;
    const liveWidth = readDimension(current?.style?.width, node.width);
    const liveHeight = readDimension(current?.style?.height, node.height);
    const selected = selectedNodeSet.has(node.id) || node.id === selectedNodeId;
    const nextNode: CanvasFlowNode = {
      id: node.id,
      type: "canvasNode",
      draggable: !resizingNodeId,
      position: preserveLiveGeometry && current ? current.position : { x: node.x, y: node.y },
      selected: typeof current?.selected === "boolean" ? current.selected : selected,
      style: { width: preserveLiveGeometry ? liveWidth : node.width, height: preserveLiveGeometry ? liveHeight : node.height },
      width: preserveLiveGeometry ? liveWidth : node.width,
      height: preserveLiveGeometry ? liveHeight : node.height,
      data: {
        isResizing: node.id === resizingNodeId,
        locale,
        node,
        suggestions: suggestionsByNodeId.get(node.id) ?? emptySuggestions,
        writeRequests: pendingWriteRequestsByNodeId.get(node.id) ?? emptyWriteRequests,
        agentCardId,
        modelOverrides,
        workflow,
        ...callbacks
      }
    };
    return current && isSameFlowNode(current, nextNode) ? current : nextNode;
  });
}

function isSameFlowNode(current: CanvasFlowNode, next: CanvasFlowNode) {
  return current.id === next.id
    && current.type === next.type
    && current.draggable === next.draggable
    && current.selected === next.selected
    && current.position.x === next.position.x
    && current.position.y === next.position.y
    && current.width === next.width
    && current.height === next.height
    && current.style?.width === next.style?.width
    && current.style?.height === next.style?.height
    && current.data.locale === next.data.locale
    && isSameCanvasNodeValue(current.data.node, next.data.node)
    && current.data.suggestions === next.data.suggestions
    && current.data.writeRequests === next.data.writeRequests
    && current.data.agentCardId === next.data.agentCardId
    && current.data.modelOverrides === next.data.modelOverrides
    && isSameWorkflowValue(current.data.workflow, next.data.workflow)
    && current.data.onAcceptSuggestion === next.data.onAcceptSuggestion
    && current.data.onApproveWriteRequest === next.data.onApproveWriteRequest
    && current.data.onConvertSuggestionToNode === next.data.onConvertSuggestionToNode
    && current.data.onCreationPreviewBlocked === next.data.onCreationPreviewBlocked
    && current.data.onDeleteNode === next.data.onDeleteNode
    && current.data.onIgnoreSuggestion === next.data.onIgnoreSuggestion
    && current.data.onOpenDocumentPreview === next.data.onOpenDocumentPreview
    && current.data.onRejectWriteRequest === next.data.onRejectWriteRequest
    && current.data.onRequestNodeMenu === next.data.onRequestNodeMenu
    && current.data.onRequestRangeRewrite === next.data.onRequestRangeRewrite
    && current.data.onTextSelectionChange === next.data.onTextSelectionChange
    && current.data.onResizeStateChange === next.data.onResizeStateChange
    && current.data.onUpdateNode === next.data.onUpdateNode;
}

function isSameCanvasNodeValue(current: CanvasNode, next: CanvasNode) {
  return current.id === next.id
    && current.projectId === next.projectId
    && current.kind === next.kind
    && current.title === next.title
    && current.content === next.content
    && current.x === next.x
    && current.y === next.y
    && current.width === next.width
    && current.height === next.height
    && current.includeInProjectContext === next.includeInProjectContext
    && current.createdAt === next.createdAt
    && current.updatedAt === next.updatedAt
    && JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null);
}

function isSameWorkflowValue(current: CanvasWorkflow | undefined, next: CanvasWorkflow | undefined) {
  if (!current || !next) return current === next;
  return current.mode === next.mode
    && current.stage === next.stage
    && JSON.stringify(current.roles ?? []) === JSON.stringify(next.roles ?? []);
}

function groupByNodeId<T>(items: T[], readNodeId: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const nodeId = readNodeId(item);
    if (!nodeId) continue;
    const bucket = grouped.get(nodeId);
    if (bucket) bucket.push(item);
    else grouped.set(nodeId, [item]);
  }
  return grouped;
}
