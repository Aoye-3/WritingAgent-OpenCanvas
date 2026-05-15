import { MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import type { CanvasNode, CanvasNodeKind } from "../../agents/types";
import type { CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";

type DocumentCanvasProps = {
  nodes: CanvasNode[];
  providerLabel: string;
  selectedNodeId?: string;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSelectNode: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
};

type PanState = { startX: number; startY: number; originX: number; originY: number };
type DragState = { nodeId: string; startX: number; startY: number; originX: number; originY: number };
type MenuState = { screenX: number; screenY: number; canvasX: number; canvasY: number };

const kindLabels: Record<CanvasNodeKind, { en: string; zh: string }> = {
  document: { en: "Document", zh: "文档" },
  note: { en: "Note", zh: "便签" },
  reference: { en: "Reference", zh: "引用卡" }
};

export function DocumentCanvas({ nodes, providerLabel, selectedNodeId, onCreateNode, onDeleteNode, onSelectNode, onUpdateNode }: DocumentCanvasProps) {
  const { locale } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [localNodes, setLocalNodes] = useState(nodes);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => setLocalNodes(nodes), [nodes]);

  const selectedNode = useMemo(() => localNodes.find((node) => node.id === selectedNodeId), [localNodes, selectedNodeId]);

  const toCanvasPoint = (screenX: number, screenY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (screenX - left - pan.x) / zoom,
      y: (screenY - top - pan.y) / zoom
    };
  };

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    setMenu(null);
    onSelectNode(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanState({ startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y });
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (panState) {
      setPan({
        x: panState.originX + event.clientX - panState.startX,
        y: panState.originY + event.clientY - panState.startY
      });
      return;
    }

    if (dragState) {
      const nextX = dragState.originX + (event.clientX - dragState.startX) / zoom;
      const nextY = dragState.originY + (event.clientY - dragState.startY) / zoom;
      setLocalNodes((current) => current.map((node) => node.id === dragState.nodeId ? { ...node, x: nextX, y: nextY } : node));
    }
  };

  const endPointer = async () => {
    setPanState(null);
    if (dragState) {
      const node = localNodes.find((item) => item.id === dragState.nodeId);
      setDragState(null);
      if (node) await onUpdateNode(node.id, { x: node.x, y: node.y });
    }
  };

  const startNodeDrag = (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setMenu(null);
    onSelectNode(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ nodeId: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y });
  };

  const openMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.target !== event.currentTarget) return;
    const point = toCanvasPoint(event.clientX, event.clientY);
    setMenu({ screenX: event.clientX, screenY: event.clientY, canvasX: point.x, canvasY: point.y });
  };

  const createNode = async (kind: CanvasNodeKind) => {
    if (!menu) return;
    setMenu(null);
    await onCreateNode({
      kind,
      title: kindLabels[kind][locale],
      content: "",
      x: Math.round(menu.canvasX),
      y: Math.round(menu.canvasY),
      width: kind === "document" ? 360 : 300,
      height: kind === "document" ? 260 : 190
    });
  };

  const wheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    const nextZoom = clamp(zoom - event.deltaY * 0.001, 0.45, 1.8);
    setZoom(nextZoom);
  };

  return (
    <section className="canvas-shell" aria-label="Document canvas workspace">
      <div className="canvas-topline">
        <div>
          <p className="eyebrow">Doc Canvas</p>
          <h2>{locale === "zh" ? "文档画板" : "Document canvas"}</h2>
        </div>
        <div className="canvas-controls" aria-label="Canvas controls">
          <span className="metadata-chip">
            <span className="status-dot" />
            {providerLabel}
          </span>
          <button className="button button-secondary button-small" type="button" onClick={() => setZoom((value) => clamp(value - 0.1, 0.45, 1.8))}>-</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="button button-secondary button-small" type="button" onClick={() => setZoom((value) => clamp(value + 0.1, 0.45, 1.8))}>+</button>
          <button className="button button-secondary button-small" type="button" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>
            {locale === "zh" ? "重置" : "Reset"}
          </button>
        </div>
      </div>

      <div
        className="canvas-viewport"
        onContextMenu={openMenu}
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={wheelZoom}
        ref={viewportRef}
      >
        <div className="canvas-grid" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {localNodes.map((node) => (
            <article
              className={`canvas-node canvas-node-${node.kind} ${selectedNodeId === node.id ? "is-selected" : ""}`}
              key={node.id}
              style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectNode(node.id);
                setMenu(null);
              }}
            >
              <div className="canvas-node-header" onPointerDown={(event) => startNodeDrag(event, node)}>
                <span>{kindLabels[node.kind][locale]}</span>
                <button className="icon-button canvas-node-delete" type="button" aria-label="Delete node" onClick={(event) => { event.stopPropagation(); void onDeleteNode(node.id); }}>
                  x
                </button>
              </div>
              <input
                className="canvas-node-title"
                defaultValue={node.title}
                onBlur={(event) => void onUpdateNode(node.id, { title: event.currentTarget.value })}
                onPointerDown={(event) => event.stopPropagation()}
              />
              <textarea
                className="canvas-node-content"
                defaultValue={node.content}
                placeholder={locale === "zh" ? "在这里编辑节点内容..." : "Edit node content..."}
                onBlur={(event) => void onUpdateNode(node.id, { content: event.currentTarget.value })}
                onPointerDown={(event) => event.stopPropagation()}
              />
            </article>
          ))}
        </div>

        {localNodes.length === 0 ? (
          <div className="canvas-empty">
            <strong>{locale === "zh" ? "右键新建节点" : "Right-click to create a node"}</strong>
            <span>{locale === "zh" ? "Agent 的写入申请会在批准后生成或修改这里的节点。" : "Approved Agent write requests will create or update nodes here."}</span>
          </div>
        ) : null}

        {menu ? (
          <div className="canvas-menu" style={{ left: menu.screenX, top: menu.screenY }}>
            {(["document", "note", "reference"] as CanvasNodeKind[]).map((kind) => (
              <button key={kind} type="button" onClick={() => void createNode(kind)}>{kindLabels[kind][locale]}</button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="canvas-selection-bar">
        {selectedNode ? (
          <span>{locale === "zh" ? "已选中" : "Selected"}: {selectedNode.title || kindLabels[selectedNode.kind][locale]}</span>
        ) : (
          <span>{locale === "zh" ? "未选中节点" : "No node selected"}</span>
        )}
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
