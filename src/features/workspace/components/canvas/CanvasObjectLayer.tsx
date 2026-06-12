import { useEffect, useState } from "react";
import type { CanvasObject } from "../../../agents/types";
import type { CanvasObjectPatch } from "../../../../../shared/canvasObjects";
import { canvasTextFontSizes, type CanvasTextFontSize } from "../../../../../shared/canvasObjects";
import type { CanvasNodeKind } from "../../../agents/types";
import { getCanvasShape } from "./shapeCatalog";
import { CanvasObjectContent } from "./CanvasObjectContent";

type Geometry = { x?: number; y?: number; width?: number; height?: number; startX?: number; startY?: number; endX?: number; endY?: number };

export function CanvasObjectLayer({
  objects,
  selectedObjectIds,
  transform,
  onCreationPreviewBlocked,
  onDeleteObject,
  onSelectObject,
  onUpdateObject,
  onUpdateData,
  onConvertText,
  requestedEditingTextId,
  zoom
}: {
  objects: CanvasObject[];
  selectedObjectIds: string[];
  transform: string;
  onCreationPreviewBlocked: () => void;
  onDeleteObject: (objectId: string) => void;
  onSelectObject: (objectId: string, additive: boolean) => void;
  onUpdateObject: (objectId: string, geometry: CanvasObject["geometry"]) => void;
  onUpdateData: (objectId: string, data: NonNullable<CanvasObjectPatch["data"]>) => void;
  onConvertText: (objectId: string, kind: Extract<CanvasNodeKind, "document" | "reference" | "note">) => void;
  requestedEditingTextId?: string | null;
  zoom: number;
}) {
  const [liveGeometry, setLiveGeometry] = useState<Record<string, Geometry>>({});
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  useEffect(() => {
    if (requestedEditingTextId) setEditingTextId(requestedEditingTextId);
  }, [requestedEditingTextId]);
  const startGeometryDrag = (objectId: string, geometry: Geometry, event: React.PointerEvent, mode: "move" | "resize") => {
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    let nextGeometry = geometry;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - originX) / zoom;
      const dy = (moveEvent.clientY - originY) / zoom;
      if (mode === "resize") {
        nextGeometry = { ...geometry, width: Math.max(80, (geometry.width ?? 220) + dx), height: Math.max(60, (geometry.height ?? 140) + dy) };
      } else if (geometry.startX !== undefined) {
        nextGeometry = { ...geometry, startX: geometry.startX + dx, startY: (geometry.startY ?? 0) + dy, endX: (geometry.endX ?? 0) + dx, endY: (geometry.endY ?? 0) + dy };
      } else {
        nextGeometry = { ...geometry, x: (geometry.x ?? 0) + dx, y: (geometry.y ?? 0) + dy };
      }
      setLiveGeometry((current) => ({ ...current, [objectId]: nextGeometry }));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setLiveGeometry((current) => {
        const next = { ...current };
        delete next[objectId];
        return next;
      });
      onUpdateObject(objectId, nextGeometry as CanvasObject["geometry"]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };
  return (
    <div className="canvas-object-layer" style={{ transform }}>
      {objects.map((object) => {
        const geometry = liveGeometry[object.id] ?? object.geometry as Geometry;
        const selected = selectedObjectIds.includes(object.id);
        if (object.kind === "arrow") {
          const startX = geometry.startX ?? 0;
          const startY = geometry.startY ?? 0;
          const endX = geometry.endX ?? 0;
          const endY = geometry.endY ?? 0;
          const left = Math.min(startX, endX) - 12;
          const top = Math.min(startY, endY) - 12;
          const width = Math.max(24, Math.abs(endX - startX) + 24);
          const height = Math.max(24, Math.abs(endY - startY) + 24);
          const startDrag = (endpoint: "start" | "end", event: React.PointerEvent<SVGCircleElement>) => {
            event.stopPropagation();
            const originX = event.clientX;
            const originY = event.clientY;
            let nextGeometry = geometry;
            const move = (moveEvent: PointerEvent) => {
              const dx = (moveEvent.clientX - originX) / zoom;
              const dy = (moveEvent.clientY - originY) / zoom;
              nextGeometry = endpoint === "start"
                ? { ...geometry, startX: startX + dx, startY: startY + dy }
                : { ...geometry, endX: endX + dx, endY: endY + dy };
              setLiveGeometry((current) => ({ ...current, [object.id]: nextGeometry }));
            };
            const finish = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", finish);
              setLiveGeometry((current) => {
                const next = { ...current };
                delete next[object.id];
                return next;
              });
              onUpdateObject(object.id, nextGeometry as CanvasObject["geometry"]);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", finish, { once: true });
          };
          return (
            <svg
              className={`canvas-free-arrow${selected ? " is-selected" : ""}`}
              data-testid="canvas-free-arrow"
              key={object.id}
              onPointerEnter={onCreationPreviewBlocked}
              onClick={(event) => { event.stopPropagation(); onSelectObject(object.id, event.shiftKey); }}
              onDoubleClick={() => onDeleteObject(object.id)}
              onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "move")}
              style={{ left, top, width, height }}
            >
              <defs><marker id={`arrow-${object.id}`} markerHeight="6" markerWidth="6" orient="auto-start-reverse" refX="5" refY="3"><path d="M0,0 L6,3 L0,6 z" /></marker></defs>
              <line x1={startX - left} y1={startY - top} x2={endX - left} y2={endY - top} markerEnd={`url(#arrow-${object.id})`} />
              {selected ? <>
                <circle cx={startX - left} cy={startY - top} r="6" onPointerDown={(event) => startDrag("start", event)} />
                <circle cx={endX - left} cy={endY - top} r="6" onPointerDown={(event) => startDrag("end", event)} />
              </> : null}
            </svg>
          );
        }
        const shape = getCanvasShape(object.kind === "shape" ? object.data.shapeId : undefined);
        if (object.kind === "text") {
          return (
            <div
              className={`canvas-board-object canvas-board-object-text${selected ? " is-selected" : ""}`}
              data-testid="canvas-object-text"
              key={object.id}
              onClick={(event) => { event.stopPropagation(); onSelectObject(object.id, event.shiftKey); }}
              onDoubleClick={(event) => { event.stopPropagation(); setEditingTextId(object.id); }}
              onPointerDown={(event) => {
                if (editingTextId !== object.id) startGeometryDrag(object.id, geometry, event, "move");
              }}
              style={{ left: geometry.x ?? 0, top: geometry.y ?? 0, width: geometry.width ?? 320, minHeight: geometry.height ?? 40 }}
            >
              {editingTextId === object.id ? (
                <textarea
                  autoFocus
                  className="canvas-free-text-editor"
                  style={{ color: object.data.color, fontSize: object.data.fontSize }}
                  value={object.data.text}
                  onBlur={(event) => {
                    onUpdateData(object.id, { ...object.data, text: event.currentTarget.value });
                    setEditingTextId(null);
                  }}
                  onChange={(event) => onUpdateData(object.id, { ...object.data, text: event.currentTarget.value })}
                  onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
                  onPointerDown={(event) => event.stopPropagation()}
                />
              ) : (
                <div className="canvas-free-text-value" style={{ color: object.data.color, fontSize: object.data.fontSize }}>
                  {object.data.text || "Double-click to edit"}
                </div>
              )}
              {selected && editingTextId !== object.id ? (
                <div className="canvas-free-text-menu" onPointerDown={(event) => event.stopPropagation()}>
                  {canvasTextFontSizes.map((fontSize) => <button className={object.data.fontSize === fontSize ? "is-active" : ""} key={fontSize} type="button" onClick={() => onUpdateData(object.id, { ...object.data, fontSize: fontSize as CanvasTextFontSize })}>{fontSize}</button>)}
                  <input aria-label="Text color" type="color" value={object.data.color} onChange={(event) => onUpdateData(object.id, { ...object.data, color: event.currentTarget.value })} />
                  {(["document", "reference", "note"] as const).map((kind) => <button key={kind} type="button" onClick={() => onConvertText(object.id, kind)}>To {kind}</button>)}
                </div>
              ) : null}
              {selected ? <button className="canvas-object-resize-handle" type="button" aria-label="Resize canvas object" onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "resize")} /> : null}
            </div>
          );
        }
        return (
          <div
            className={`canvas-board-object canvas-board-object-${object.kind}${selected ? " is-selected" : ""}${object.kind === "shape" ? ` is-${shape.className}` : ""}`}
            data-testid={`canvas-object-${object.kind}`}
            key={object.id}
            onPointerEnter={onCreationPreviewBlocked}
            onClick={(event) => { event.stopPropagation(); onSelectObject(object.id, event.shiftKey); }}
            onDoubleClick={() => onDeleteObject(object.id)}
            onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "move")}
            style={{ left: geometry.x ?? 0, top: geometry.y ?? 0, width: geometry.width ?? 220, height: geometry.height ?? 140 }}
          >
            {object.kind === "table" || object.kind === "asset" ? <CanvasObjectContent object={object} onUpdateTable={(rows) => onUpdateData(object.id, { rows })} /> : null}
            {selected ? <button className="canvas-object-resize-handle" type="button" aria-label="Resize canvas object" onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "resize")} /> : null}
          </div>
        );
      })}
    </div>
  );
}
