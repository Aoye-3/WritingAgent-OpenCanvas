import type { CanvasEdge, CanvasNode } from "../../../features/agents/types";

export function removeCanvasNodeFromState({
  nodeId,
  nodes,
  edges,
  selectedNodeId
}: {
  nodeId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId?: string;
}) {
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    selectedNodeId: selectedNodeId === nodeId ? undefined : selectedNodeId
  };
}
