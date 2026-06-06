import { useState } from "react";
import type { CanvasObject } from "../../../agents/types";
import { getCanvasShape } from "./shapeCatalog";

type Geometry = { x?: number; y?: number; width?: number; height?: number; startX?: number; startY?: number; endX?: number; endY?: number };

export function CanvasObjectLayer({
  objects,
  selectedObjectIds,
  transform,
  onDeleteObject,
  onSelectObject,
  onUpdateObject,
  onUpdateData,
  zoom
}: {
  objects: CanvasObject[];
  selectedObjectIds: string[];
  transform: string;
  onDeleteObject: (objectId: string) => void;
  onSelectObject: (objectId: string, additive: boolean) => void;
  onUpdateObject: (objectId: string, geometry: Record<string, unknown>) => void;
  onUpdateData: (objectId: string, data: Record<string, unknown>) => void;
  zoom: number;
}) {
  const [liveGeometry, setLiveGeometry] = useState<Record<string, Geometry>>({});
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
      onUpdateObject(objectId, nextGeometry as Record<string, unknown>);
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
              onUpdateObject(object.id, nextGeometry as Record<string, unknown>);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", finish, { once: true });
          };
          return (
            <svg
              className={`canvas-free-arrow${selected ? " is-selected" : ""}`}
              data-testid="canvas-free-arrow"
              key={object.id}
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
        const data = object.data as { shape?: string; rows?: string[][]; name?: string; previewable?: boolean };
        const shape = getCanvasShape(data.shape);
        return (
          <div
            className={`canvas-board-object canvas-board-object-${object.kind}${selected ? " is-selected" : ""}${object.kind === "shape" ? ` is-${shape.className}` : ""}`}
            data-testid={`canvas-object-${object.kind}`}
            key={object.id}
            onClick={(event) => { event.stopPropagation(); onSelectObject(object.id, event.shiftKey); }}
            onDoubleClick={() => onDeleteObject(object.id)}
            onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "move")}
            style={{ left: geometry.x ?? 0, top: geometry.y ?? 0, width: geometry.width ?? 220, height: geometry.height ?? 140 }}
          >
            {object.kind === "table" ? <SimpleTable rows={data.rows ?? defaultRows()} onChange={(rows) => onUpdateData(object.id, { ...data, rows })} /> : object.kind === "asset" ? data.previewable ? <img alt={data.name ?? "Canvas asset"} src={`/api/threads/${encodeURIComponent(object.threadId)}/canvas/assets/${encodeURIComponent(object.id)}/content`} /> : <span>{data.name ?? "Asset"}</span> : null}
            {selected ? <button className="canvas-object-resize-handle" type="button" aria-label="Resize canvas object" onPointerDown={(event) => startGeometryDrag(object.id, geometry, event, "resize")} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function SimpleTable({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const update = (rowIndex: number, cellIndex: number, value: string) => onChange(rows.map((row, r) => row.map((cell, c) => r === rowIndex && c === cellIndex ? value : cell)));
  return (
    <>
      <table onPointerDown={(event) => event.stopPropagation()}><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td contentEditable key={cellIndex} suppressContentEditableWarning onBlur={(event) => update(rowIndex, cellIndex, event.currentTarget.textContent ?? "")}>{cell}</td>)}</tr>)}</tbody></table>
      <div className="canvas-table-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => onChange([...rows, Array.from({ length: rows[0]?.length ?? 1 }, () => "")])}>+ Row</button>
        <button type="button" onClick={() => onChange(rows.map((row) => [...row, ""]))}>+ Column</button>
      </div>
    </>
  );
}

function defaultRows() {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ""));
}
