import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnSelectionChangeParams
} from "@xyflow/react";
import { flushSync } from "react-dom";
import type { CanvasNode, CanvasNodeKind } from "../../agents/types";
import type { CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";
import { CloseIcon, ResetIcon, ZoomInIcon, ZoomOutIcon } from "../../../shared/icons";

type DocumentCanvasProps = {
  nodes: CanvasNode[];
  providerLabel: string;
  selectedNodeId?: string;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSelectNode: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
};

type MenuState = { screenX: number; screenY: number; canvasX: number; canvasY: number };
type CanvasFlowNodeData = {
  isResizing: boolean;
  locale: "en" | "zh";
  node: CanvasNode;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
};
type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasNode">;
type CanvasNodeMetadata = Record<string, unknown> & {
  canvasLayout?: {
    sizeMode?: "auto" | "manual";
  };
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const MIN_NODE_SIZE: Record<CanvasNodeKind, { width: number; height: number }> = {
  document: { width: 260, height: 180 },
  note: { width: 220, height: 150 },
  reference: { width: 240, height: 160 }
};
const MAX_NODE_WIDTH = 920;
const MAX_NODE_HEIGHT = 2400;
const AUTO_NODE_VERTICAL_CHROME = 112;

const kindLabels: Record<CanvasNodeKind, { en: string; zh: string }> = {
  document: { en: "Document", zh: "文档" },
  note: { en: "Note", zh: "便签" },
  reference: { en: "Reference", zh: "引用" }
};

const canvasNodeTypes = {
  canvasNode: CanvasNodeCard
};

const resizeHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type ResizeHandle = typeof resizeHandles[number];

export function DocumentCanvas(props: DocumentCanvasProps) {
  return (
    <ReactFlowProvider>
      <DocumentCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DocumentCanvasInner({ nodes, providerLabel, selectedNodeId, onCreateNode, onDeleteNode, onSelectNode, onUpdateNode }: DocumentCanvasProps) {
  const { locale } = useI18n();
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const resizingNodeIdRef = useRef<string | null>(null);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  const handleResizeStateChange = useCallback((nodeId?: string) => {
    resizingNodeIdRef.current = nodeId ?? null;
    setResizingNodeId(nodeId ?? null);
  }, []);

  useEffect(() => {
    setFlowNodes((current) => mapCanvasNodes(nodes, current, selectedNodeId, resizingNodeId, locale, onDeleteNode, handleResizeStateChange, onUpdateNode));
  }, [handleResizeStateChange, locale, nodes, onDeleteNode, onUpdateNode, resizingNodeId, selectedNodeId]);

  const createNode = async (kind: CanvasNodeKind) => {
    if (!menu) return;
    setMenu(null);
    await onCreateNode({
      kind,
      title: kindLabels[kind][locale],
      content: "",
      x: Math.round(menu.canvasX),
      y: Math.round(menu.canvasY),
      width: kind === "document" ? 520 : 300,
      height: kind === "document" ? 260 : 190
    });
  };

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const activeResizeNodeId = resizingNodeIdRef.current;
    const allowedChanges = activeResizeNodeId
      ? changes.filter((change) => !(change.type === "position" && change.id === activeResizeNodeId))
      : changes;
    if (allowedChanges.length === 0) return;
    setFlowNodes((current) => applyNodeChanges(allowedChanges, current));
  }, []);

  const onNodeDragStop = useCallback((_event: ReactMouseEvent | globalThis.MouseEvent, node: CanvasFlowNode) => {
    if (resizingNodeIdRef.current === node.id) return;
    void onUpdateNode(node.id, {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y)
    });
  }, [onUpdateNode]);

  const openMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setMenu({ screenX: event.clientX, screenY: event.clientY, canvasX: point.x, canvasY: point.y });
    onSelectNode(undefined);
  }, [onSelectNode, reactFlow]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams<CanvasFlowNode>) => {
    onSelectNode(params.nodes[0]?.id);
  }, [onSelectNode]);

  const resetViewport = () => {
    void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 160 });
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
          <button className="icon-button canvas-zoom-button" type="button" aria-label="Zoom out" onClick={() => void reactFlow.zoomOut({ duration: 120 })}>
            <ZoomOutIcon aria-hidden="true" size={18} />
          </button>
          <span>{Math.round(viewport.zoom * 100)}%</span>
          <button className="icon-button canvas-zoom-button" type="button" aria-label="Zoom in" onClick={() => void reactFlow.zoomIn({ duration: 120 })}>
            <ZoomInIcon aria-hidden="true" size={18} />
          </button>
          <button className="button button-secondary button-small" type="button" onClick={resetViewport}>
            <ResetIcon aria-hidden="true" size={16} />
            {locale === "zh" ? "重置" : "Reset"}
          </button>
        </div>
      </div>

      <div className="canvas-viewport">
        <ReactFlow<CanvasFlowNode>
          className="canvas-flow"
          colorMode="light"
          deleteKeyCode={null}
          fitView={nodes.length > 0}
          maxZoom={MAX_ZOOM}
          minZoom={MIN_ZOOM}
          nodeTypes={canvasNodeTypes}
          nodes={flowNodes}
          nodesDraggable={!resizingNodeId}
          onMoveStart={closeMenu}
          onNodeDragStart={closeMenu}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          onPaneClick={() => {
            closeMenu();
            onSelectNode(undefined);
          }}
          onPaneContextMenu={openMenu}
          onSelectionChange={handleSelectionChange}
          panOnDrag={!resizingNodeId}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          selectionOnDrag={!resizingNodeId}
        >
          <Background color="#dbe7f7" gap={28} size={1} variant={BackgroundVariant.Lines} />
        </ReactFlow>

        {nodes.length === 0 ? (
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
        <span className="canvas-interaction-hint">
          {locale === "zh" ? "拖拽空白移动画布 · 滚轮平移 · Ctrl + 滚轮缩放" : "Drag blank space to pan · Wheel to pan · Ctrl + wheel to zoom"}
        </span>
      </div>
    </section>
  );
}

function mapCanvasNodes(
  nodes: CanvasNode[],
  currentNodes: CanvasFlowNode[],
  selectedNodeId: string | undefined,
  resizingNodeId: string | null,
  locale: "en" | "zh",
  onDeleteNode: (nodeId: string) => Promise<void>,
  onResizeStateChange: (nodeId?: string) => void,
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>
): CanvasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const current = currentById.get(node.id);
    const preserveLiveGeometry = current?.dragging || node.id === resizingNodeId;
    const liveWidth = readDimension(current?.style?.width, node.width);
    const liveHeight = readDimension(current?.style?.height, node.height);
    return {
      id: node.id,
      type: "canvasNode",
      draggable: !resizingNodeId,
      dragHandle: ".canvas-node-drag-handle",
      position: preserveLiveGeometry && current ? current.position : { x: node.x, y: node.y },
      selected: node.id === selectedNodeId,
      style: { width: preserveLiveGeometry ? liveWidth : node.width, height: preserveLiveGeometry ? liveHeight : node.height },
      width: preserveLiveGeometry ? liveWidth : node.width,
      height: preserveLiveGeometry ? liveHeight : node.height,
      data: {
        isResizing: node.id === resizingNodeId,
        locale,
        node,
        onDeleteNode,
        onResizeStateChange,
        onUpdateNode
      }
    };
  });
}

function readDimension(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function CanvasNodeCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const { isResizing, locale, node, onDeleteNode, onResizeStateChange, onUpdateNode } = data;
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const kindClass = isKnownCanvasKind(node.kind) ? `canvas-node-${node.kind}` : "canvas-node-unknown";
  const minSize = isKnownCanvasKind(node.kind) ? MIN_NODE_SIZE[node.kind] : { width: 220, height: 150 };

  const startResize = (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    onResizeStateChange(node.id);
    const liveNode = reactFlow.getNode(node.id);
    const liveWidth = readDimension(liveNode?.style?.width, node.width);
    const liveHeight = readDimension(liveNode?.style?.height, node.height);
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: liveNode?.position.x ?? node.x,
      y: liveNode?.position.y ?? node.y,
      width: liveWidth,
      height: liveHeight,
      zoom: viewport.zoom || 1
    };

    const updateVisualNode = (next: { x: number; y: number; width: number; height: number }) => {
      flushSync(() => {
        reactFlow.setNodes((current) => current.map((flowNode) => flowNode.id === node.id ? {
          ...flowNode,
          position: { x: next.x, y: next.y },
          style: { ...flowNode.style, width: next.width, height: next.height },
          width: next.width,
          height: next.height
        } : flowNode));
      });
    };

    let latest = { x: start.x, y: start.y, width: start.width, height: start.height };

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      latest = computeResize(handle, start, moveEvent.clientX, moveEvent.clientY, minSize);
      updateVisualNode(latest);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      void onUpdateNode(node.id, {
        x: Math.round(latest.x),
        y: Math.round(latest.y),
        width: Math.round(latest.width),
        height: Math.round(latest.height),
        metadata: withManualCanvasSize(node.metadata)
      }).finally(() => onResizeStateChange(undefined));
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <article className={`canvas-node ${kindClass} ${selected ? "is-selected" : ""}`}>
      {selected ? <ResizeFrame onResizeStart={startResize} /> : null}
      <CanvasNodeHeader locale={locale} node={node} onDeleteNode={onDeleteNode} />
      <CanvasNodeBody isResizing={isResizing} locale={locale} node={node} onUpdateNode={onUpdateNode} />
    </article>
  );
}

function ResizeFrame({ onResizeStart }: { onResizeStart: (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="canvas-node-resize-frame" aria-hidden="true">
      {resizeHandles.map((handle) => (
        <button
          className={`canvas-node-resize-handle canvas-node-resize-${handle} nodrag nopan`}
          key={handle}
          type="button"
          tabIndex={-1}
          onPointerDownCapture={(event) => onResizeStart(handle, event)}
        />
      ))}
      <span className="canvas-node-resize-line canvas-node-resize-line-n" />
      <span className="canvas-node-resize-line canvas-node-resize-line-e" />
      <span className="canvas-node-resize-line canvas-node-resize-line-s" />
      <span className="canvas-node-resize-line canvas-node-resize-line-w" />
    </div>
  );
}

function computeResize(
  handle: ResizeHandle,
  start: { clientX: number; clientY: number; x: number; y: number; width: number; height: number; zoom: number },
  clientX: number,
  clientY: number,
  minSize: { width: number; height: number }
) {
  const dx = (clientX - start.clientX) / start.zoom;
  const dy = (clientY - start.clientY) / start.zoom;
  const movesLeft = handle.includes("w");
  const movesRight = handle.includes("e");
  const movesTop = handle.includes("n");
  const movesBottom = handle.includes("s");
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (movesRight) width = clamp(start.width + dx, minSize.width, MAX_NODE_WIDTH);
  if (movesBottom) height = clamp(start.height + dy, minSize.height, MAX_NODE_HEIGHT);
  if (movesLeft) {
    width = clamp(start.width - dx, minSize.width, MAX_NODE_WIDTH);
    x = start.x + start.width - width;
  }
  if (movesTop) {
    height = clamp(start.height - dy, minSize.height, MAX_NODE_HEIGHT);
    y = start.y + start.height - height;
  }

  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAutoNodeHeight(kind: CanvasNodeKind, contentScrollHeight: number) {
  return Math.ceil(clamp(contentScrollHeight + AUTO_NODE_VERTICAL_CHROME, MIN_NODE_SIZE[kind].height, MAX_NODE_HEIGHT));
}

function readCanvasNodeMetadata(metadata: unknown): CanvasNodeMetadata {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as CanvasNodeMetadata : {};
}

function hasManualCanvasSize(metadata: unknown) {
  return readCanvasNodeMetadata(metadata).canvasLayout?.sizeMode === "manual";
}

function withManualCanvasSize(metadata: unknown): CanvasNodeMetadata {
  const current = readCanvasNodeMetadata(metadata);
  const currentLayout = current.canvasLayout && typeof current.canvasLayout === "object" ? current.canvasLayout : {};
  return {
    ...current,
    canvasLayout: {
      ...currentLayout,
      sizeMode: "manual"
    }
  };
}

function CanvasNodeHeader({
  locale,
  node,
  onDeleteNode
}: {
  locale: "en" | "zh";
  node: CanvasNode;
  onDeleteNode: (nodeId: string) => Promise<void>;
}) {
  const label = isKnownCanvasKind(node.kind) ? kindLabels[node.kind][locale] : (locale === "zh" ? "未知节点" : "Unknown node");
  return (
    <div className="canvas-node-header canvas-node-drag-handle">
      <span>{label}</span>
      <button className="icon-button canvas-node-delete nodrag" type="button" aria-label="Delete node" onClick={() => void onDeleteNode(node.id)}>
        <CloseIcon aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

function CanvasNodeBody({
  isResizing,
  locale,
  node,
  onUpdateNode
}: {
  isResizing: boolean;
  locale: "en" | "zh";
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
}) {
  if (!isKnownCanvasKind(node.kind)) {
    return <FallbackNodeBody locale={locale} node={node} onUpdateNode={onUpdateNode} />;
  }

  return <EditableTextNode isResizing={isResizing} locale={locale} node={node} onUpdateNode={onUpdateNode} />;
}

function EditableTextNode({
  isResizing,
  locale,
  node,
  onUpdateNode
}: {
  isResizing: boolean;
  locale: "en" | "zh";
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);

  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setContent(node.content), [node.content]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (content !== node.content || isResizing || hasManualCanvasSize(node.metadata)) return;
    const previousHeight = textarea.style.height;
    textarea.style.height = "0px";
    const nextHeight = getAutoNodeHeight(node.kind, textarea.scrollHeight);
    textarea.style.height = previousHeight;
    if (nextHeight > node.height + 12) {
      void onUpdateNode(node.id, { height: nextHeight });
    }
  }, [content, isResizing, node.content, node.height, node.id, node.kind, node.metadata, onUpdateNode]);

  return (
    <>
      <input
        className="canvas-node-title nodrag"
        onBlur={() => {
          if (title !== node.title) void onUpdateNode(node.id, { title });
        }}
        onChange={(event) => setTitle(event.currentTarget.value)}
        value={title}
      />
      <textarea
        className="canvas-node-content nodrag nowheel"
        ref={textareaRef}
        value={content}
        placeholder={locale === "zh" ? "在这里编辑节点内容..." : "Edit node content..."}
        onBlur={() => {
          if (content !== node.content) void onUpdateNode(node.id, { content });
        }}
        onChange={(event) => setContent(event.currentTarget.value)}
      />
    </>
  );
}

function FallbackNodeBody({
  locale,
  node,
  onUpdateNode
}: {
  locale: "en" | "zh";
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
}) {
  return (
    <>
      <input
        className="canvas-node-title nodrag"
        defaultValue={node.title}
        onBlur={(event) => void onUpdateNode(node.id, { title: event.currentTarget.value })}
      />
      <p className="canvas-node-fallback">
        {locale === "zh" ? "这个节点类型暂未安装专属渲染器，将以安全文本节点显示。" : "This node type does not have a dedicated renderer yet, so it is shown as a safe text node."}
      </p>
      <textarea
        className="canvas-node-content nodrag nowheel"
        defaultValue={node.content}
        placeholder={locale === "zh" ? "在这里编辑节点内容..." : "Edit node content..."}
        onBlur={(event) => void onUpdateNode(node.id, { content: event.currentTarget.value })}
      />
    </>
  );
}

function isKnownCanvasKind(kind: string): kind is CanvasNodeKind {
  return kind === "document" || kind === "note" || kind === "reference";
}
