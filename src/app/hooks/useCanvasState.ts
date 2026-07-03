import { useState } from "react";
import type { CanvasEdge, CanvasNode, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../features/agents/types";
import { fetchCanvas } from "../../features/canvas/canvasClient";
import { useCanvasActions } from "./useCanvasActions";
import { useCanvasHistory } from "./useCanvasHistory";
import { defaultCanvasWorkflow } from "../../../shared/canvasWorkflow";

type UseCanvasStateOptions = {
  ensureThreadId: () => Promise<string>;
  onRefreshProjectSurfaces: () => Promise<void>;
  undoDepth: number;
};

export function useCanvasState({ ensureThreadId, onRefreshProjectSurfaces, undoDepth }: UseCanvasStateOptions) {
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [canvasObjects, setCanvasObjects] = useState<CanvasObject[]>([]);
  const [canvasWriteRequests, setCanvasWriteRequests] = useState<CanvasWriteRequest[]>([]);
  const [canvasWorkflow, setCanvasWorkflow] = useState<CanvasWorkflow | undefined>(() => createDefaultCanvasWorkflow());
  const [canvasWorkflowSuggestions, setCanvasWorkflowSuggestions] = useState<CanvasWorkflowSuggestion[]>([]);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | undefined>();
  const canvasHistory = useCanvasHistory(undoDepth);

  const resetCanvas = () => {
    setCanvasNodes([]);
    setCanvasEdges([]);
    setCanvasObjects([]);
    setCanvasWriteRequests([]);
    setCanvasWorkflow(createDefaultCanvasWorkflow());
    setCanvasWorkflowSuggestions([]);
    setSelectedCanvasNodeId(undefined);
    canvasHistory.clearHistory();
  };

  const applyCanvasState = (
    nodes: CanvasNode[] = [],
    writeRequests: CanvasWriteRequest[] = [],
    edges: CanvasEdge[] = [],
    workflow?: CanvasWorkflow,
    suggestions: CanvasWorkflowSuggestion[] = [],
    objects: CanvasObject[] = []
  ) => {
    setCanvasNodes(nodes);
    setCanvasEdges(edges);
    setCanvasObjects(objects);
    setCanvasWriteRequests(writeRequests);
    setCanvasWorkflow(workflow ?? createDefaultCanvasWorkflow());
    setCanvasWorkflowSuggestions(suggestions);
    setSelectedCanvasNodeId((current) => resolveCanvasSelectedNodeId(current, nodes));
  };

  const refreshCanvas = async (threadId: string) => {
    const canvas = await fetchCanvas(threadId);
    setCanvasNodes(canvas.nodes);
    setCanvasEdges(canvas.edges ?? []);
    setCanvasObjects(canvas.objects ?? []);
    setCanvasWriteRequests(canvas.writeRequests);
    setCanvasWorkflow(canvas.workflow);
    setCanvasWorkflowSuggestions(canvas.suggestions ?? []);
    setSelectedCanvasNodeId((current) => current && canvas.nodes.some((node) => node.id === current) ? current : canvas.nodes[0]?.id);
  };

  const applyLiveCanvasNode = (node: CanvasNode) => {
    setCanvasNodes((current) => upsertCanvasNodeSnapshot(current, node));
  };

  const canvasActions = useCanvasActions({
    canvasEdges,
    canvasNodes,
    canvasObjects,
    canvasWriteRequests,
    ensureThreadId,
    onRefreshCanvas: refreshCanvas,
    onRefreshProjectSurfaces,
    popHistory: canvasHistory.popHistory,
    pushHistory: canvasHistory.pushHistory,
    setCanvasEdges,
    setCanvasNodes,
    setCanvasObjects,
    setCanvasWorkflow,
    setCanvasWorkflowSuggestions,
    setCanvasWriteRequests,
    setSelectedCanvasNodeId
  });

  return {
    canvasNodes,
    canvasEdges,
    canvasObjects,
    canvasWriteRequests,
    canvasWorkflow,
    canvasWorkflowSuggestions,
    selectedCanvasNodeId,
    canUndoCanvas: canvasHistory.canUndo,
    setCanvasNodes,
    setCanvasEdges,
    setCanvasObjects,
    setCanvasWorkflow,
    setCanvasWorkflowSuggestions,
    setCanvasWriteRequests,
    setSelectedCanvasNodeId,
    resetCanvas,
    applyCanvasState,
    applyLiveCanvasNode,
    refreshCanvas,
    ...canvasActions
  };
}

export function upsertCanvasNodeSnapshot(nodes: CanvasNode[], node: CanvasNode) {
  const existingIndex = nodes.findIndex((candidate) => candidate.id === node.id);
  if (existingIndex < 0) return [...nodes, node];
  if (isSameCanvasNodeSnapshot(nodes[existingIndex], node)) return nodes;
  return nodes.map((candidate, index) => index === existingIndex ? node : candidate);
}

export function resolveCanvasSelectedNodeId(current: string | undefined, nodes: CanvasNode[]) {
  return current && nodes.some((node) => node.id === current) ? current : nodes[0]?.id;
}

function isSameCanvasNodeSnapshot(current: CanvasNode | undefined, next: CanvasNode) {
  if (!current) return false;
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

function createDefaultCanvasWorkflow(): CanvasWorkflow {
  return {
    projectId: "",
    ...defaultCanvasWorkflow(),
    updatedAt: ""
  };
}
