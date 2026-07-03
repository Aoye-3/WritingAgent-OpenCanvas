import type { NodeChange } from "@xyflow/react";
import type { CanvasFlowNode } from "./types";

export function filterCanvasNodeChanges(changes: NodeChange<CanvasFlowNode>[], activeResizeNodeId: string | null) {
  return changes.filter((change) => {
    if (change.type === "dimensions") return true;
    if (change.type !== "position" && change.type !== "select") return false;
    return !(change.type === "position" && activeResizeNodeId && change.id === activeResizeNodeId);
  });
}

export function sameFlowNodeViewArray(left: CanvasFlowNode[], right: CanvasFlowNode[]) {
  return left.length === right.length && left.every((node, index) => {
    const next = right[index];
    return node.id === next.id
      && node.selected === next.selected
      && node.dragging === next.dragging
      && node.position.x === next.position.x
      && node.position.y === next.position.y
      && node.width === next.width
      && node.height === next.height
      && node.measured?.width === next.measured?.width
      && node.measured?.height === next.measured?.height
      && node.style?.width === next.style?.width
      && node.style?.height === next.style?.height;
  });
}
