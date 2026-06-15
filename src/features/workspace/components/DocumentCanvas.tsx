import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type NodeChange,
  type OnSelectionChangeParams
} from "@xyflow/react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowMode, CanvasWorkflowStage, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch, CanvasObjectDraft, CanvasObjectPatch, CanvasRangeRewriteDraft } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";
import { ResetIcon, ZoomInIcon, ZoomOutIcon } from "../../../shared/icons";
import { CanvasCurveEdge } from "./canvas/CanvasCurveEdge";
import { CanvasNodeFrame } from "./canvas/CanvasNodeFrame";
import { CanvasContextMenu, CanvasSelectedNodeWorkflow, CanvasSelectionBar, type CanvasMenuState } from "./canvas/CanvasChrome";
import { MAX_ZOOM, MIN_ZOOM, canvasNodeKinds, kindLabels, workflowModeLabels } from "./canvas/constants";
import { buildCanvasFlowNodes } from "./canvas/flowMapping";
import { formatMindChainContext, type CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import type { CanvasFlowNode } from "./canvas/types";
import { completeCanvasToolAction, type CanvasTool } from "./canvas/toolState";
import { CanvasObjectLayer } from "./canvas/CanvasObjectLayer";
import { createCanvasObjectDraft, type CanvasShapeId } from "../../../../shared/canvasObjects";
import { CanvasAssetInput, CanvasToolOverlays } from "./canvas/CanvasToolOverlays";
import { CanvasCreationPreview } from "./canvas/CanvasCreationPreview";
import { createCanvasNodeDraft, getCanvasCreationSize, isPreviewCreationTool, pointToCenteredOrigin } from "./canvas/canvasCreation";
import { CANVAS_CLIPBOARD_MIME, createCanvasClipboardPayload, type CanvasClipboardPayload, type ClipboardNodeDraft } from "../../../../shared/canvasClipboard";

type DocumentCanvasProps = {
  activeTool: CanvasTool;
  canUndo: boolean;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  objects: CanvasObject[];
  providerLabel: string;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  selectedNodeId?: string;
  writeRequests: CanvasWriteRequest[];
  agentCardId?: string;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onCreateObject: (draft: CanvasObjectDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteObject: (objectId: string) => Promise<void>;
  onPaste: (payload: CanvasClipboardPayload, center: { x: number; y: number }) => Promise<void>;
  onConvertText: (objectId: string, kind: Extract<CanvasNodeKind, "document" | "reference" | "note">) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onAttachMindChain: (context: CanvasMindChainContext) => void;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
  onUpdateObject: (objectId: string, patch: CanvasObjectPatch) => Promise<unknown>;
  onUploadAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflowStage; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { mode?: CanvasWorkflowMode; stage?: CanvasWorkflowStage; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
  onToolChange: (tool: CanvasTool) => void;
};

const canvasNodeTypes = {
  canvasNode: CanvasNodeFrame
};

const canvasEdgeTypes = {
  canvasCurve: CanvasCurveEdge
};

export function DocumentCanvas(props: DocumentCanvasProps) {
  return (
    <ReactFlowProvider>
      <DocumentCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
function DocumentCanvasInner({
  activeTool,
  canUndo,
  edges,
  nodes,
  objects,
  providerLabel,
  workflow,
  suggestions,
  selectedNodeId,
  writeRequests,
  agentCardId,
  modelOverrides,
  onAcceptSuggestion,
  onConvertSuggestionToNode,
  onCreateEdge,
  onCreateNode,
  onCreateObject,
  onDeleteEdge,
  onDeleteNode,
  onDeleteObject,
  onPaste,
  onConvertText,
  onIgnoreSuggestion,
  onAttachMindChain,
  onSendMindChainToChat,
  onSelectNode,
  onUndo,
  onUpdateNode,
  onRequestRangeRewrite,
  onApproveWriteRequest,
  onRejectWriteRequest,
  onUpdateObject,
  onUploadAsset,
  onUpdateNodeWorkflow,
  onUpdateWorkflow,
  onToolChange
}: DocumentCanvasProps) {
  const { locale } = useI18n();
  const reduceMotion = useReducedMotion();
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [shapeKind, setShapeKind] = useState<CanvasShapeId>("rectangle");
  const [recentShapeIds, setRecentShapeIds] = useState<string[]>(["rectangle", "circle", "diamond"]);
  const [creationPreviewPoint, setCreationPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [editNewTextId, setEditNewTextId] = useState<string | null>(null);
  const [, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const resizingNodeIdRef = useRef<string | null>(null);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const internalClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const focusedNodeRef = useRef<string | undefined>(undefined);
  const floatingTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 300, damping: 30 };
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const flowEdges = useMemo<Edge[]>(() => edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edge.id === selectedEdgeId ? "canvas-edge is-selected" : "canvas-edge",
    selected: edge.id === selectedEdgeId,
    type: "canvasCurve"
  })), [edges, selectedEdgeId]);

  const handleResizeStateChange = useCallback((nodeId?: string) => {
    resizingNodeIdRef.current = nodeId ?? null;
    setResizingNodeId(nodeId ?? null);
  }, []);
  const clearCreationPreview = useCallback(() => setCreationPreviewPoint(null), []);
  const requestNodeMenu = useCallback((nodeId: string, screen: { x: number; y: number }) => {
    const point = reactFlow.screenToFlowPosition(screen);
    setMenu({ screenX: screen.x, screenY: screen.y, canvasX: point.x, canvasY: point.y, nodeId });
    setSelectedEdgeId(undefined);
    onSelectNode(nodeId);
  }, [onSelectNode, reactFlow]);

  useEffect(() => {
    setFlowNodes((current) => buildCanvasFlowNodes({
      nodes,
      currentNodes: current,
      selectedNodeId,
      resizingNodeId,
      locale,
      workflow,
      suggestions,
      writeRequests,
      agentCardId,
      modelOverrides,
      callbacks: {
        onAcceptSuggestion,
        onConvertSuggestionToNode,
        onDeleteNode,
        onIgnoreSuggestion,
        onCreationPreviewBlocked: clearCreationPreview,
        onRequestNodeMenu: requestNodeMenu,
        onResizeStateChange: handleResizeStateChange,
        onUpdateNode,
        onRequestRangeRewrite,
        onApproveWriteRequest,
        onRejectWriteRequest
      }
    }));
  }, [agentCardId, clearCreationPreview, handleResizeStateChange, locale, modelOverrides, nodes, onAcceptSuggestion, onApproveWriteRequest, onConvertSuggestionToNode, onDeleteNode, onIgnoreSuggestion, onRejectWriteRequest, onRequestRangeRewrite, onUpdateNode, requestNodeMenu, resizingNodeId, selectedNodeId, suggestions, workflow, writeRequests]);

  useEffect(() => {
    if (!selectedNode || focusedNodeRef.current === selectedNode.id) return;
    focusedNodeRef.current = selectedNode.id;
    void reactFlow.setCenter(
      selectedNode.x + selectedNode.width / 2,
      selectedNode.y + selectedNode.height / 2,
      { duration: 260, zoom: Math.max(viewport.zoom, 0.65) }
    );
  }, [reactFlow, selectedNode, viewport.zoom]);

  const createNode = async (kind: CanvasNodeKind) => {
    if (!menu) return;
    if (kind === "plan") return;
    setMenu(null);
    await onCreateNode(createCanvasNodeDraft(kind, { x: menu.canvasX, y: menu.canvasY }, locale));
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
    setSelectedEdgeId(undefined);
    onSelectNode(undefined);
  }, [onSelectNode, reactFlow]);

  const openNodeMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent, node: CanvasFlowNode) => {
    event.preventDefault();
    event.stopPropagation();
    requestNodeMenu(node.id, { x: event.clientX, y: event.clientY });
  }, [requestNodeMenu]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams<CanvasFlowNode>) => {
    const nextEdgeId = params.edges[0]?.id;
    setSelectedNodeIds(params.nodes.map((node) => node.id));
    if (params.nodes.length > 0 || nextEdgeId) setSelectedObjectIds([]);
    setSelectedEdgeId(nextEdgeId);
    onSelectNode(nextEdgeId ? undefined : params.nodes[0]?.id);
  }, [onSelectNode]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      for (const nodeId of selectedNodeIds) void onDeleteNode(nodeId);
      for (const objectId of selectedObjectIds) void onDeleteObject(objectId);
      if (selectedEdgeId) void onDeleteEdge(selectedEdgeId);
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [onDeleteEdge, onDeleteNode, onDeleteObject, selectedEdgeId, selectedNodeIds, selectedObjectIds]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    const copy = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const copiedNodes = nodes.filter((node): node is CanvasNode & ClipboardNodeDraft => selectedNodeIds.includes(node.id) && node.kind !== "plan");
      const copiedObjects = objects.filter((object) => selectedObjectIds.includes(object.id));
      if (copiedNodes.length === 0 && !copiedObjects.some((object) => object.kind === "text")) return;
      const payload = createCanvasClipboardPayload({ nodes: copiedNodes, objects: copiedObjects, edges });
      internalClipboardRef.current = payload;
      event.preventDefault();
      event.clipboardData?.setData(CANVAS_CLIPBOARD_MIME, JSON.stringify(payload));
      event.clipboardData?.setData("text/plain", [
        ...copiedNodes.map((node) => [node.title, node.content].filter(Boolean).join("\n")),
        ...copiedObjects.filter((object) => object.kind === "text").map((object) => object.data.text),
      ].join("\n\n"));
    };
    const paste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const raw = event.clipboardData?.getData(CANVAS_CLIPBOARD_MIME);
      let payload: CanvasClipboardPayload | null = null;
      if (raw) {
        try { payload = JSON.parse(raw) as CanvasClipboardPayload; } catch { payload = null; }
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!payload && !text) return;
      event.preventDefault();
      const center = lastCanvasPointRef.current ?? reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      if (payload?.version === 1) {
        void onPaste(payload, center);
        return;
      }
      const textDraft = createCanvasObjectDraft("text", pointToCenteredOrigin(center, getCanvasCreationSize("text")));
      void onCreateObject({ kind: "text", geometry: textDraft.geometry as { x: number; y: number; width: number; height: number }, data: { text, fontSize: 16, color: "#1f2937" } }).then((created) => {
        const object = created as CanvasObject;
        setSelectedObjectIds([object.id]);
        setEditNewTextId(object.id);
      });
    };
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  }, [edges, nodes, objects, onCreateObject, onPaste, reactFlow, selectedNodeIds, selectedObjectIds]);

  const resetViewport = () => {
    void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 160 });
  };

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    void onCreateEdge({ sourceNodeId: connection.source, targetNodeId: connection.target });
  }, [onCreateEdge]);

  const sendMindChain = (nodeId: string) => {
    const context = formatMindChainContext(nodeId, nodes, edges, locale);
    if (context) onAttachMindChain(context);
    setMenu(null);
  };

  const deleteSelectedEdge = async () => {
    if (!selectedEdgeId) return;
    await onDeleteEdge(selectedEdgeId);
    setSelectedEdgeId(undefined);
  };

  const createPreviewItem = (center: { x: number; y: number }) => {
    if (!isPreviewCreationTool(activeTool) || isPointOverCanvasContent(center, nodes, objects)) return;
    const origin = pointToCenteredOrigin(center, getCanvasCreationSize(activeTool));
    const roundedOrigin = { x: Math.round(origin.x), y: Math.round(origin.y) };
    setCreationPreviewPoint(null);
    if (activeTool === "shape" || activeTool === "table" || activeTool === "text") {
      void onCreateObject(createCanvasObjectDraft(activeTool, roundedOrigin, shapeKind)).then((created) => {
        if (activeTool === "text") {
          const object = created as CanvasObject;
          setSelectedObjectIds([object.id]);
          setEditNewTextId(object.id);
        }
        onToolChange(completeCanvasToolAction(activeTool));
      });
      return;
    }
    void onCreateNode(createCanvasNodeDraft(activeTool, roundedOrigin, locale)).then(() => onToolChange(completeCanvasToolAction(activeTool)));
  };

  const handleCanvasPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || !event.target.closest(".react-flow__pane")) return;
    if (event.button === 0 && isPreviewCreationTool(activeTool)) {
      event.preventDefault();
      event.stopPropagation();
      createPreviewItem(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      return;
    }
    if (activeTool !== "arrow") return;
    event.preventDefault();
    event.stopPropagation();
    const start = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setArrowStart(start);
    const finish = async (upEvent: PointerEvent) => {
      const end = reactFlow.screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
      setArrowStart(null);
      window.removeEventListener("pointerup", finish);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 12) return;
      await onCreateObject({ kind: "arrow", geometry: { startX: start.x, startY: start.y, endX: end.x, endY: end.y }, data: {} });
      onToolChange("select");
    };
    window.addEventListener("pointerup", finish, { once: true });
  };

  const handleCanvasPointerMoveCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    lastCanvasPointRef.current = point;
    if (!isPreviewCreationTool(activeTool) || !isBlankCanvasPoint(event.clientX, event.clientY) || isPointOverCanvasContent(point, nodes, objects)) {
      setCreationPreviewPoint(null);
      return;
    }
    setCreationPreviewPoint(point);
  };

  const handleCanvasPointerOverCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(".react-flow__node, .canvas-board-object, .canvas-free-arrow")) {
      setCreationPreviewPoint(null);
    }
  };

  useEffect(() => {
    setCreationPreviewPoint(null);
  }, [activeTool]);

  return (
    <section className="canvas-shell" aria-label="Document canvas workspace" data-testid="document-canvas">
      <div
        className="canvas-viewport"
        data-testid="canvas-viewport"
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerLeave={() => setCreationPreviewPoint(null)}
        onPointerMoveCapture={handleCanvasPointerMoveCapture}
        onPointerOverCapture={handleCanvasPointerOverCapture}
      >
        <CanvasAssetInput activeTool={activeTool} onToolChange={onToolChange} onUploadAsset={onUploadAsset} />
        <motion.div
          className="canvas-controls"
          aria-label="Canvas controls"
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={floatingTransition}
        >
          <span className="metadata-chip canvas-runtime-chip">
            <span className="status-dot" />
            {providerLabel}
          </span>
          {workflow ? (
            <select
              className="canvas-stage-select canvas-mode-select"
              aria-label="Canvas mode"
              value={workflow.mode}
              onChange={(event) => void onUpdateWorkflow({ mode: event.target.value as CanvasWorkflowMode })}
            >
              {Object.entries(workflowModeLabels).map(([mode, labels]) => <option key={mode} value={mode}>{labels[locale]}</option>)}
            </select>
          ) : null}
          <button className="icon-button canvas-zoom-button" type="button" aria-label="Zoom out" onClick={() => void reactFlow.zoomOut({ duration: 120 })}>
            <ZoomOutIcon aria-hidden="true" size={18} />
          </button>
          <span className="canvas-zoom-value">{Math.round(viewport.zoom * 100)}%</span>
          <button className="icon-button canvas-zoom-button" type="button" aria-label="Zoom in" onClick={() => void reactFlow.zoomIn({ duration: 120 })}>
            <ZoomInIcon aria-hidden="true" size={18} />
          </button>
          <button className="button button-secondary button-small" type="button" onClick={resetViewport}>
            <ResetIcon aria-hidden="true" size={16} />
            {locale === "zh" ? "重置" : "Reset"}
          </button>
          <button className="button button-secondary button-small" type="button" disabled={!canUndo} onClick={() => void onUndo()}>
            {locale === "zh" ? "撤销" : "Undo"}
          </button>
        </motion.div>
        <ReactFlow<CanvasFlowNode>
          className={`canvas-flow${isPreviewCreationTool(activeTool) ? " is-creating" : ""}`}
          colorMode="light"
          deleteKeyCode={null}
          fitView={nodes.length > 0}
          maxZoom={MAX_ZOOM}
          minZoom={MIN_ZOOM}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          nodes={flowNodes}
          edges={flowEdges}
          onConnect={handleConnect}
          onEdgeClick={(_event, edge) => {
            closeMenu();
            setSelectedEdgeId(edge.id);
            onSelectNode(undefined);
          }}
          onEdgeDoubleClick={(_event, edge) => void onDeleteEdge(edge.id)}
          nodesDraggable={!resizingNodeId && activeTool === "select"}
          onMoveStart={closeMenu}
          onNodeDragStart={closeMenu}
          onNodeDragStop={onNodeDragStop}
          onNodeMouseEnter={() => setCreationPreviewPoint(null)}
          onNodeContextMenu={openNodeMenu}
          onNodesChange={onNodesChange}
          onPaneClick={() => {
            closeMenu();
            setSelectedObjectIds([]);
            onSelectNode(undefined);
          }}
          onPaneContextMenu={openMenu}
          onSelectionChange={handleSelectionChange}
          panActivationKeyCode="Space"
          panOnDrag={activeTool === "pan"}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          selectionOnDrag={!resizingNodeId && activeTool === "select"}
          selectionMode={SelectionMode.Partial}
        >
        </ReactFlow>
        <CanvasObjectLayer
          objects={objects}
          selectedObjectIds={selectedObjectIds}
          transform={`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`}
          onDeleteObject={(objectId) => void onDeleteObject(objectId)}
          onCreationPreviewBlocked={clearCreationPreview}
          onSelectObject={(objectId, additive) => {
            setSelectedObjectIds((current) => additive ? current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId] : [objectId]);
            setSelectedEdgeId(undefined);
            onSelectNode(undefined);
          }}
          onUpdateObject={(objectId, geometry) => void onUpdateObject(objectId, { geometry })}
          onUpdateData={(objectId, data) => void onUpdateObject(objectId, { data })}
          onConvertText={(objectId, kind) => {
            void onConvertText(objectId, kind);
          }}
          requestedEditingTextId={editNewTextId}
          zoom={viewport.zoom}
        />
        <CanvasCreationPreview
          activeTool={activeTool}
          point={creationPreviewPoint}
          shapeKind={shapeKind}
          transform={`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`}
        />

        <AnimatePresence>
          {nodes.length === 0 ? (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="canvas-empty"
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              transition={floatingTransition}
            >
              <strong>{locale === "zh" ? "右键新建节点" : "Right-click to create a node"}</strong>
              <span>{locale === "zh" ? "也可以从底部工具栏放置文档、便签、形状或 Agent 工具。" : "Use the dock to place documents, notes, shapes, or the Agent tool."}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {menu ? (
          <CanvasContextMenu
            createItems={canvasNodeKinds.map((kind) => ({ kind, label: kindLabels[kind]?.[locale] ?? kind }))}
            menu={menu}
            sendMindChainLabel={locale === "zh" ? "发送思维链" : "Send mind chain"}
            onCreateNode={(kind) => void createNode(kind)}
            onSendMindChain={sendMindChain}
          />
        ) : null}
        <CanvasToolOverlays
          activeTool={activeTool}
          locale={locale}
          nodes={nodes}
          objects={objects}
          recentShapeIds={recentShapeIds}
          selectedNodeIds={selectedNodeIds}
          selectedObjectIds={selectedObjectIds}
          onSelectShape={(shape) => {
            setShapeKind(shape);
            setRecentShapeIds((current) => [shape, ...current.filter((id) => id !== shape)].slice(0, 6));
          }}
          onSendToChat={onSendMindChainToChat}
          onToolChange={onToolChange}
        />
      </div>

      <CanvasSelectionBar
        deleteEdgeLabel={locale === "zh" ? "删除连线" : "Delete edge"}
        hint={locale === "zh" ? "点击选中 · 拖拽空白框选 · 空格 + 拖拽移动画布 · Ctrl + 滚轮缩放" : "Click to select · Drag blank space to marquee select · Space + drag to pan · Ctrl + wheel to zoom"}
        locale={locale}
        selectedEdgeId={selectedEdgeId}
        selectedNode={selectedNode}
        onDeleteSelectedEdge={() => void deleteSelectedEdge()}
      />
      {selectedNode && workflow && selectedNode.kind !== "role" ? (
        <CanvasSelectedNodeWorkflow locale={locale} node={selectedNode} workflow={workflow} onUpdateNodeWorkflow={onUpdateNodeWorkflow} />
      ) : null}
    </section>
  );
}

function isBlankCanvasPoint(clientX: number, clientY: number) {
  return Boolean(document.elementFromPoint(clientX, clientY)?.closest(".react-flow__pane"));
}

function isPointOverCanvasContent(point: { x: number; y: number }, nodes: CanvasNode[], objects: CanvasObject[]) {
  if (nodes.some((node) => point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height)) {
    return true;
  }
  return objects.some((object) => {
    if (object.kind === "arrow") {
      const padding = 12;
      return point.x >= Math.min(object.geometry.startX, object.geometry.endX) - padding
        && point.x <= Math.max(object.geometry.startX, object.geometry.endX) + padding
        && point.y >= Math.min(object.geometry.startY, object.geometry.endY) - padding
        && point.y <= Math.max(object.geometry.startY, object.geometry.endY) + padding;
    }
    return point.x >= object.geometry.x
      && point.x <= object.geometry.x + object.geometry.width
      && point.y >= object.geometry.y
      && point.y <= object.geometry.y + object.geometry.height;
  });
}

