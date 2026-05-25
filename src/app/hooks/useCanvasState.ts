import { useState } from "react";
import type { CanvasEdge, CanvasNode, CanvasWriteRequest } from "../../features/agents/types";
import { fetchCanvas } from "../../features/canvas/canvasClient";
import { useCanvasActions } from "./useCanvasActions";
import { useCanvasHistory } from "./useCanvasHistory";

type UseCanvasStateOptions = {
  ensureThreadId: () => Promise<string>;
  onRefreshProjectSurfaces: () => Promise<void>;
  undoDepth: number;
};

export function useCanvasState({ ensureThreadId, onRefreshProjectSurfaces, undoDepth }: UseCanvasStateOptions) {
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [canvasWriteRequests, setCanvasWriteRequests] = useState<CanvasWriteRequest[]>([]);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | undefined>();
  const canvasHistory = useCanvasHistory(undoDepth);

  const resetCanvas = () => {
    setCanvasNodes([]);
    setCanvasEdges([]);
    setCanvasWriteRequests([]);
    setSelectedCanvasNodeId(undefined);
    canvasHistory.clearHistory();
  };

  const applyCanvasState = (nodes: CanvasNode[] = [], writeRequests: CanvasWriteRequest[] = [], edges: CanvasEdge[] = []) => {
    setCanvasNodes(nodes);
    setCanvasEdges(edges);
    setCanvasWriteRequests(writeRequests);
    setSelectedCanvasNodeId(nodes[0]?.id);
  };

  const refreshCanvas = async (threadId: string) => {
    const canvas = await fetchCanvas(threadId);
    setCanvasNodes(canvas.nodes);
    setCanvasEdges(canvas.edges ?? []);
    setCanvasWriteRequests(canvas.writeRequests);
    setSelectedCanvasNodeId((current) => current && canvas.nodes.some((node) => node.id === current) ? current : canvas.nodes[0]?.id);
  };

  const canvasActions = useCanvasActions({
    canvasEdges,
    canvasNodes,
    ensureThreadId,
    onRefreshCanvas: refreshCanvas,
    onRefreshProjectSurfaces,
    popHistory: canvasHistory.popHistory,
    pushHistory: canvasHistory.pushHistory,
    setCanvasEdges,
    setCanvasNodes,
    setCanvasWriteRequests,
    setSelectedCanvasNodeId
  });

  return {
    canvasNodes,
    canvasEdges,
    canvasWriteRequests,
    selectedCanvasNodeId,
    canUndoCanvas: canvasHistory.canUndo,
    setCanvasNodes,
    setCanvasEdges,
    setCanvasWriteRequests,
    setSelectedCanvasNodeId,
    resetCanvas,
    applyCanvasState,
    refreshCanvas,
    ...canvasActions
  };
}
