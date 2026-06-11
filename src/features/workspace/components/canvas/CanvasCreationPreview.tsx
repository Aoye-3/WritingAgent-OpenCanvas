import { getCanvasShape } from "./shapeCatalog";
import { getCanvasCreationSize, isPreviewCreationTool, pointToCenteredOrigin } from "./canvasCreation";
import type { CanvasShapeId } from "../../../../../shared/canvasObjects";
import type { CanvasTool } from "./toolState";

export function CanvasCreationPreview({
  activeTool,
  point,
  shapeKind,
  transform,
}: {
  activeTool: CanvasTool;
  point: { x: number; y: number } | null;
  shapeKind: CanvasShapeId;
  transform: string;
}) {
  if (!point || !isPreviewCreationTool(activeTool)) return null;
  const size = getCanvasCreationSize(activeTool);
  const origin = pointToCenteredOrigin(point, size);
  const shape = getCanvasShape(shapeKind);
  const className = [
    "canvas-creation-preview",
    `is-${activeTool}`,
    activeTool === "shape" ? `is-${shape.className}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="canvas-creation-preview-layer" style={{ transform }}>
      <div
        className={className}
        data-testid="canvas-creation-preview"
        style={{ left: origin.x, top: origin.y, width: size.width, height: size.height }}
      >
        {activeTool === "table" ? <PreviewTable /> : null}
      </div>
    </div>
  );
}

function PreviewTable() {
  return (
    <div className="canvas-creation-preview-table" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
    </div>
  );
}
