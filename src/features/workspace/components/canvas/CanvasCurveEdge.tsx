import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

export function CanvasCurveEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, selected, label }: EdgeProps) {
  const distance = Math.abs(targetX - sourceX);
  const lift = clamp(distance * 0.36, 54, 150);
  const controlX = sourceX + (targetX - sourceX) / 2;
  const controlY = Math.min(sourceY, targetY) - lift;
  const path = `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`;
  const labelX = sourceX * 0.25 + controlX * 0.5 + targetX * 0.25;
  const labelY = sourceY * 0.25 + controlY * 0.5 + targetY * 0.25;

  return (
    <>
      <BaseEdge
        id={id}
        className={selected ? "canvas-edge is-selected" : "canvas-edge"}
        markerEnd={markerEnd}
        path={path}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
