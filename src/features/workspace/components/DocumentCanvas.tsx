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
import { fetchMarkdownOutputPreview, type CanvasEdgeDraft, type CanvasNodeDraft, type CanvasNodePatch, type CanvasNodePositionUpdate, type CanvasObjectDraft, type CanvasObjectPatch, type CanvasRangeRewriteDraft, type MarkdownOutputPreview } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";
import { ResetIcon, ZoomInIcon, ZoomOutIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import { CanvasCurveEdge } from "./canvas/CanvasCurveEdge";
import { CanvasNodeFrame } from "./canvas/CanvasNodeFrame";
import { CanvasContextMenu, CanvasSelectedNodeWorkflow, CanvasSelectionBar, type CanvasMenuState } from "./canvas/CanvasChrome";
import { MAX_ZOOM, MIN_ZOOM, canvasNodeKinds, kindLabels, workflowModeLabels } from "./canvas/constants";
import { collectDraggedNodePositionPatches } from "./canvas/dragPersistence";
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
import { createSplitCanvasNodeDraft, isSplittableCanvasNodeKind } from "../../../app/hooks/canvasActions/split";
import type { CanvasTextSelection } from "./canvas/types";

type DocumentCanvasProps = {
  activeTool: CanvasTool;
  canUndo: boolean;
  threadId: string;
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
  onUpdateNodePositions: (updates: CanvasNodePositionUpdate[]) => Promise<unknown>;
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

const canvasProOptions = { hideAttribution: true };

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
  threadId,
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
  onUpdateNodePositions,
  onRequestRangeRewrite,
  onApproveWriteRequest,
  onRejectWriteRequest,
  onUpdateObject,
  onUploadAsset,
  onUpdateNodeWorkflow,
  onUpdateWorkflow,
  onToolChange
}: DocumentCanvasProps) {
  const { locale, t } = useI18n();
  const reduceMotion = useReducedMotion();
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const reactFlowRef = useRef(reactFlow);
  reactFlowRef.current = reactFlow;
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [textSelection, setTextSelection] = useState<CanvasTextSelection | undefined>();
  const [shapeKind, setShapeKind] = useState<CanvasShapeId>("rectangle");
  const [recentShapeIds, setRecentShapeIds] = useState<string[]>(["rectangle", "circle", "diamond"]);
  const [creationPreviewPoint, setCreationPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [editNewTextId, setEditNewTextId] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] = useState<{ path: string; nodeTitle: string; status: "loading" | "ready" | "failed"; document?: MarkdownOutputPreview; error?: string } | null>(null);
  const [, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const resizingNodeIdRef = useRef<string | null>(null);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const internalClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const textSelectionRef = useRef<CanvasTextSelection | undefined>(undefined);
  const actionRef = useRef({
    onAcceptSuggestion,
    onApproveWriteRequest,
    onConvertSuggestionToNode,
    onCreateEdge,
    onCreateNode,
    onCreateObject,
    onDeleteEdge,
    onDeleteNode,
    onDeleteObject,
    onIgnoreSuggestion,
    onPaste,
    onConvertText,
    onRejectWriteRequest,
    onRequestRangeRewrite,
    onSelectNode,
    onUpdateNode,
    onUpdateNodePositions,
    onUpdateObject,
    onUpdateWorkflow
  });
  actionRef.current = {
    onAcceptSuggestion,
    onApproveWriteRequest,
    onConvertSuggestionToNode,
    onCreateEdge,
    onCreateNode,
    onCreateObject,
    onDeleteEdge,
    onDeleteNode,
    onDeleteObject,
    onIgnoreSuggestion,
    onPaste,
    onConvertText,
    onRejectWriteRequest,
    onRequestRangeRewrite,
    onSelectNode,
    onUpdateNode,
    onUpdateNodePositions,
    onUpdateObject,
    onUpdateWorkflow
  };
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
  const handleTextSelectionChange = useCallback((selection?: CanvasTextSelection) => {
    textSelectionRef.current = selection;
    setTextSelection(selection);
  }, []);
  const requestNodeMenu = useCallback((nodeId: string, screen: { x: number; y: number }) => {
    const point = reactFlowRef.current.screenToFlowPosition(screen);
    const currentSelection = textSelectionRef.current;
    const menuSelection = currentSelection?.nodeId === nodeId && currentSelection.text.trim() ? currentSelection : undefined;
    setMenu({ screenX: screen.x, screenY: screen.y, canvasX: point.x, canvasY: point.y, nodeId, textSelection: menuSelection });
    setSelectedEdgeId(undefined);
    actionRef.current.onSelectNode(nodeId);
  }, []);

  const flowCallbacks = useMemo(() => ({
    onAcceptSuggestion: (suggestionId: string) => actionRef.current.onAcceptSuggestion(suggestionId),
    onApproveWriteRequest: (requestId: string) => actionRef.current.onApproveWriteRequest(requestId),
    onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => actionRef.current.onConvertSuggestionToNode(suggestionId, kind),
    onCreationPreviewBlocked: clearCreationPreview,
    onDeleteNode: (nodeId: string) => actionRef.current.onDeleteNode(nodeId),
    onIgnoreSuggestion: (suggestionId: string) => actionRef.current.onIgnoreSuggestion(suggestionId),
    onOpenDocumentPreview: (node: CanvasNode) => {
      const path = readFileDocumentPath(node);
      if (!path) return;
      setDocumentPreview({ path, nodeTitle: node.title, status: "loading" });
      void fetchMarkdownOutputPreview(threadId, path)
        .then((document) => setDocumentPreview({ path, nodeTitle: node.title, status: "ready", document }))
        .catch((error) => setDocumentPreview({ path, nodeTitle: node.title, status: "failed", error: error instanceof Error ? error.message : "Unable to load Markdown preview" }));
    },
    onRejectWriteRequest: (requestId: string) => actionRef.current.onRejectWriteRequest(requestId),
    onRequestNodeMenu: requestNodeMenu,
    onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => actionRef.current.onRequestRangeRewrite(draft),
    onTextSelectionChange: handleTextSelectionChange,
    onResizeStateChange: handleResizeStateChange,
    onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => actionRef.current.onUpdateNode(nodeId, patch)
  }), [clearCreationPreview, handleResizeStateChange, handleTextSelectionChange, requestNodeMenu, threadId]);

  useEffect(() => {
    setFlowNodes((current) => {
      const next = buildCanvasFlowNodes({
        nodes,
        currentNodes: current,
        selectedNodeId,
        selectedNodeIds,
        resizingNodeId,
        locale,
        workflow,
        suggestions,
        writeRequests,
        agentCardId,
        modelOverrides,
        callbacks: flowCallbacks
      });
      return sameFlowNodeArray(current, next) ? current : next;
    });
  }, [agentCardId, flowCallbacks, locale, modelOverrides, nodes, resizingNodeId, selectedNodeId, selectedNodeIds, suggestions, workflow, writeRequests]);

  const createNode = async (kind: CanvasNodeKind) => {
    if (!menu) return;
    if (kind !== "document" && kind !== "note" && kind !== "reference" && kind !== "role" && kind !== "file_document" && kind !== "clarification") return;
    setMenu(null);
    await actionRef.current.onCreateNode(createCanvasNodeDraft(kind, { x: menu.canvasX, y: menu.canvasY }, locale));
  };

  const splitSelectionToNode = async (nodeId: string) => {
    const selection = menu?.textSelection ?? textSelection;
    const source = nodes.find((node) => node.id === nodeId);
    if (!source || !selection || selection.nodeId !== source.id || !isSplittableCanvasNodeKind(source.kind)) return;
    setMenu(null);
    handleTextSelectionChange(undefined);
    window.getSelection()?.removeAllRanges();
    await actionRef.current.onCreateNode(createSplitCanvasNodeDraft(source, selection));
  };

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const activeResizeNodeId = resizingNodeIdRef.current;
    const allowedChanges = changes.filter((change) => {
      if (change.type !== "position" && change.type !== "select") return false;
      return !(activeResizeNodeId && change.id === activeResizeNodeId);
    });
    if (allowedChanges.length === 0) return;
    setFlowNodes((current) => {
      const next = applyNodeChanges(allowedChanges, current);
      return sameFlowNodeViewArray(current, next) ? current : next;
    });
  }, []);

  const onNodeDragStop = useCallback((_event: ReactMouseEvent | globalThis.MouseEvent, node: CanvasFlowNode) => {
    if (resizingNodeIdRef.current === node.id) return;
    const patches = collectDraggedNodePositionPatches({
      draggedNodeId: node.id,
      selectedNodeIds,
      flowNodes: reactFlowRef.current.getNodes()
    });
    if (patches.length === 1) {
      const [{ nodeId, patch }] = patches;
      void actionRef.current.onUpdateNode(nodeId, patch);
      return;
    }
    if (patches.length > 1) {
      void actionRef.current.onUpdateNodePositions(patches.map(({ nodeId, patch }) => ({ nodeId, x: patch.x, y: patch.y })));
    }
  }, [selectedNodeIds]);

  const openMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    const point = reactFlowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setMenu({ screenX: event.clientX, screenY: event.clientY, canvasX: point.x, canvasY: point.y });
    setSelectedEdgeId(undefined);
    actionRef.current.onSelectNode(undefined);
  }, []);

  const openNodeMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent, node: CanvasFlowNode) => {
    event.preventDefault();
    event.stopPropagation();
    requestNodeMenu(node.id, { x: event.clientX, y: event.clientY });
  }, [requestNodeMenu]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams<CanvasFlowNode>) => {
    const nextEdgeId = params.edges[0]?.id;
    const nextNodeIds = params.nodes.map((node) => node.id).sort();
    setSelectedNodeIds((current) => sameStringArray(current, nextNodeIds) ? current : nextNodeIds);
    if (params.nodes.length > 0 || nextEdgeId) setSelectedObjectIds((current) => current.length === 0 ? current : []);
    setSelectedEdgeId((current) => current === nextEdgeId ? current : nextEdgeId);
    const nextSelectedNodeId = nextEdgeId ? undefined : params.nodes[0]?.id;
    if ((params.nodes.length > 0 || nextEdgeId) && selectedNodeId !== nextSelectedNodeId) {
      actionRef.current.onSelectNode(nextSelectedNodeId);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      for (const nodeId of selectedNodeIds) void actionRef.current.onDeleteNode(nodeId);
      for (const objectId of selectedObjectIds) void actionRef.current.onDeleteObject(objectId);
      if (selectedEdgeId) void actionRef.current.onDeleteEdge(selectedEdgeId);
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [selectedEdgeId, selectedNodeIds, selectedObjectIds]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if (!canUndo) return;
      event.preventDefault();
      void onUndo();
    };
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [canUndo, onUndo]);

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
      const center = lastCanvasPointRef.current ?? reactFlowRef.current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      if (payload?.version === 1) {
        void actionRef.current.onPaste(payload, center);
        return;
      }
      const textDraft = createCanvasObjectDraft("text", pointToCenteredOrigin(center, getCanvasCreationSize("text")));
      void actionRef.current.onCreateObject({ kind: "text", geometry: textDraft.geometry as { x: number; y: number; width: number; height: number }, data: { text, fontSize: 16, color: "#1f2937" } }).then((created) => {
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
  }, [edges, nodes, objects, selectedNodeIds, selectedObjectIds]);

  const resetViewport = () => {
    void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 160 });
  };

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    void actionRef.current.onCreateEdge({ sourceNodeId: connection.source, targetNodeId: connection.target });
  }, []);

  const sendMindChain = (nodeId: string) => {
    const context = formatMindChainContext(nodeId, nodes, edges, locale);
    if (context) onAttachMindChain(context);
    setMenu(null);
  };

  const deleteSelectedEdge = async () => {
    if (!selectedEdgeId) return;
    await actionRef.current.onDeleteEdge(selectedEdgeId);
    setSelectedEdgeId(undefined);
  };

  const createPreviewItem = (center: { x: number; y: number }) => {
    if (!isPreviewCreationTool(activeTool) || isPointOverCanvasContent(center, nodes, objects)) return;
    const origin = pointToCenteredOrigin(center, getCanvasCreationSize(activeTool));
    const roundedOrigin = { x: Math.round(origin.x), y: Math.round(origin.y) };
    setCreationPreviewPoint(null);
    if (activeTool === "shape" || activeTool === "table" || activeTool === "text") {
      void actionRef.current.onCreateObject(createCanvasObjectDraft(activeTool, roundedOrigin, shapeKind)).then((created) => {
        if (activeTool === "text") {
          const object = created as CanvasObject;
          setSelectedObjectIds([object.id]);
          setEditNewTextId(object.id);
        }
        onToolChange(completeCanvasToolAction(activeTool));
      });
      return;
    }
    void actionRef.current.onCreateNode(createCanvasNodeDraft(activeTool, roundedOrigin, locale)).then(() => onToolChange(completeCanvasToolAction(activeTool)));
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
      await actionRef.current.onCreateObject({ kind: "arrow", geometry: { startX: start.x, startY: start.y, endX: end.x, endY: end.y }, data: {} });
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
              onChange={(event) => void actionRef.current.onUpdateWorkflow({ mode: event.target.value as CanvasWorkflowMode })}
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
            {t("workspace.resetCanvas")}
          </button>
          <button className="button button-secondary button-small" type="button" disabled={!canUndo} onClick={() => void onUndo()}>
            {t("workspace.undoCanvas")}
          </button>
        </motion.div>
        <ReactFlow<CanvasFlowNode>
          className={`canvas-flow${isPreviewCreationTool(activeTool) ? " is-creating" : ""}`}
          colorMode="light"
          deleteKeyCode={null}
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
            actionRef.current.onSelectNode(undefined);
          }}
          onEdgeDoubleClick={(_event, edge) => void actionRef.current.onDeleteEdge(edge.id)}
          nodesDraggable={!resizingNodeId && activeTool === "select"}
          onMoveStart={closeMenu}
          onNodeDragStart={closeMenu}
          onNodeDragStop={onNodeDragStop}
          onNodeMouseEnter={() => setCreationPreviewPoint(null)}
          onNodeContextMenu={openNodeMenu}
          onNodesChange={onNodesChange}
          onPaneClick={() => {
            closeMenu();
            handleTextSelectionChange(undefined);
            setSelectedObjectIds([]);
            if (activeTool === "agent") onToolChange("select");
            actionRef.current.onSelectNode(undefined);
          }}
          onPaneContextMenu={openMenu}
          onSelectionChange={handleSelectionChange}
          panActivationKeyCode="Space"
          panOnDrag={activeTool === "pan"}
          panOnScroll
          proOptions={canvasProOptions}
          selectionOnDrag={!resizingNodeId && activeTool === "select"}
          selectionMode={SelectionMode.Partial}
        >
        </ReactFlow>
        <CanvasObjectLayer
          objects={objects}
          selectedObjectIds={selectedObjectIds}
          transform={`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`}
          onDeleteObject={(objectId) => void actionRef.current.onDeleteObject(objectId)}
          onCreationPreviewBlocked={clearCreationPreview}
          onSelectObject={(objectId, additive) => {
            setSelectedObjectIds((current) => additive ? current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId] : [objectId]);
            setSelectedEdgeId(undefined);
            actionRef.current.onSelectNode(undefined);
          }}
          onUpdateObject={(objectId, geometry) => void actionRef.current.onUpdateObject(objectId, { geometry })}
          onUpdateData={(objectId, data) => void actionRef.current.onUpdateObject(objectId, { data })}
          onConvertText={(objectId, kind) => {
            void actionRef.current.onConvertText(objectId, kind);
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
              <strong>{t("workspace.rightClickCreateNode")}</strong>
              <span>{t("workspace.createNodeHint")}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {menu ? (
          <CanvasContextMenu
            createItems={canvasNodeKinds.map((kind) => ({ kind, label: kindLabels[kind]?.[locale] ?? kind }))}
            menu={menu}
            sendMindChainLabel={t("workspace.sendMindChain")}
            splitSelectionLabel={locale === "zh" ? "拆分为节点" : "Split selection to node"}
            onCreateNode={(kind) => void createNode(kind)}
            onSendMindChain={sendMindChain}
            onSplitSelection={(nodeId) => void splitSelectionToNode(nodeId)}
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
        {documentPreview ? (
          <MarkdownDocumentPreviewPanel
            locale={locale}
            preview={documentPreview}
            onClose={() => setDocumentPreview(null)}
          />
        ) : null}
      </div>

      <CanvasSelectionBar
        deleteEdgeLabel={t("workspace.deleteEdge")}
        hint={t("workspace.canvasHint")}
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

function MarkdownDocumentPreviewPanel({ locale, preview, onClose }: {
  locale: "en" | "zh";
  preview: { path: string; nodeTitle: string; status: "loading" | "ready" | "failed"; document?: MarkdownOutputPreview; error?: string };
  onClose: () => void;
}) {
  const title = preview.document?.fileName ?? preview.nodeTitle;
  return (
    <div className="markdown-document-preview-backdrop nodrag nopan" role="presentation">
      <aside className="markdown-document-preview" aria-label={locale === "zh" ? "Markdown 文档预览" : "Markdown document preview"}>
        <header className="markdown-document-preview-header">
          <div>
            <strong>{title}</strong>
            <span>{preview.document?.path ?? preview.path}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={locale === "zh" ? "关闭预览" : "Close preview"}>×</button>
        </header>
        <div className="markdown-document-preview-body">
          {preview.status === "loading" ? <p>{locale === "zh" ? "正在读取 Markdown 文档..." : "Loading Markdown document..."}</p> : null}
          {preview.status === "failed" ? <p className="markdown-document-preview-error">{preview.error ?? (locale === "zh" ? "无法读取文档。" : "Unable to read document.")}</p> : null}
          {preview.status === "ready" && preview.document ? <MarkdownText text={preview.document.content} /> : null}
        </div>
      </aside>
    </div>
  );
}

function readFileDocumentPath(node: CanvasNode) {
  const metadata = node.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const fileDocument = (metadata as Record<string, unknown>).fileDocument;
  if (!fileDocument || typeof fileDocument !== "object" || Array.isArray(fileDocument)) return "";
  const path = (fileDocument as Record<string, unknown>).path;
  return typeof path === "string" ? path : "";
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameFlowNodeArray(left: CanvasFlowNode[], right: CanvasFlowNode[]) {
  return left.length === right.length && left.every((node, index) => node === right[index]);
}

function sameFlowNodeViewArray(left: CanvasFlowNode[], right: CanvasFlowNode[]) {
  return left.length === right.length && left.every((node, index) => {
    const next = right[index];
    return node.id === next.id
      && node.selected === next.selected
      && node.dragging === next.dragging
      && node.position.x === next.position.x
      && node.position.y === next.position.y
      && node.width === next.width
      && node.height === next.height
      && node.style?.width === next.style?.width
      && node.style?.height === next.style?.height;
  });
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

