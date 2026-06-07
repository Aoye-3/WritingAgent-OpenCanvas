import type { CanvasAssetObject, CanvasTableObject } from "../../../../../shared/canvasObjects";

export function CanvasObjectContent({
  object,
  onUpdateTable,
}: {
  object: CanvasTableObject | CanvasAssetObject;
  onUpdateTable: (rows: string[][]) => void;
}) {
  if (object.kind === "table") {
    return <CanvasTableEditor rows={object.data.rows} onChange={onUpdateTable} />;
  }
  return object.data.previewable
    ? <img alt={object.data.name} src={`/api/threads/${encodeURIComponent(object.threadId)}/canvas/assets/${encodeURIComponent(object.id)}/content`} />
    : <span>{object.data.name}</span>;
}

function CanvasTableEditor({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const update = (rowIndex: number, cellIndex: number, value: string) => onChange(rows.map((row, r) => row.map((cell, c) => r === rowIndex && c === cellIndex ? value : cell)));
  return (
    <>
      <table onPointerDown={(event) => event.stopPropagation()}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td contentEditable key={cellIndex} suppressContentEditableWarning onBlur={(event) => update(rowIndex, cellIndex, event.currentTarget.textContent ?? "")}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="canvas-table-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => onChange([...rows, Array.from({ length: rows[0]?.length ?? 1 }, () => "")])}>+ Row</button>
        <button type="button" onClick={() => onChange(rows.map((row) => [...row, ""]))}>+ Column</button>
      </div>
    </>
  );
}
