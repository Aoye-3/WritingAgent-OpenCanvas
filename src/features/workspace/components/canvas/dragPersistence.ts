export type DragPositionNode = {
  id: string;
  position: {
    x: number;
    y: number;
  };
};

export function collectDraggedNodePositionPatches(input: {
  draggedNodeId: string;
  selectedNodeIds: string[];
  flowNodes: DragPositionNode[];
}) {
  const selectedSet = new Set(input.selectedNodeIds);
  const targetIds = selectedSet.has(input.draggedNodeId) && selectedSet.size > 1
    ? selectedSet
    : new Set([input.draggedNodeId]);

  return input.flowNodes
    .filter((node) => targetIds.has(node.id))
    .map((node) => ({
      nodeId: node.id,
      patch: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y)
      }
    }));
}
