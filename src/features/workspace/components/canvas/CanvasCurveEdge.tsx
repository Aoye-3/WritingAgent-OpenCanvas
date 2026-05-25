import { BaseEdge, type EdgeProps } from "@xyflow/react";

export function CanvasCurveEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, selected }: EdgeProps) {
  const distance = Math.abs(targetX - sourceX);
  const lift = clamp(distance * 0.36, 54, 150);
  const controlX = sourceX + (targetX - sourceX) / 2;
  const controlY = Math.min(sourceY, targetY) - lift;
  const path = `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`;

  return (
    <BaseEdge
      id={id}
      className={selected ? "canvas-edge is-selected" : "canvas-edge"}
      markerEnd={markerEnd}
      path={path}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
