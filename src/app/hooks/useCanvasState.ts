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
    setSelectedCanvasNodeId(nodes[0]?.id);
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
    refreshCanvas,
    ...canvasActions
  };
}

function createDefaultCanvasWorkflow(): CanvasWorkflow {
  return {
    projectId: "",
    ...defaultCanvasWorkflow(),
    updatedAt: ""
  };
}
