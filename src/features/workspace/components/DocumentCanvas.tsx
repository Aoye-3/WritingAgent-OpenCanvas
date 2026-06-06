import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
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
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowStage, CanvasWorkflowSuggestion } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch, CanvasObjectDraft, CanvasObjectPatch } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";
import { ResetIcon, ZoomInIcon, ZoomOutIcon } from "../../../shared/icons";
import { CanvasCurveEdge } from "./canvas/CanvasCurveEdge";
import { CanvasNodeFrame } from "./canvas/CanvasNodeFrame";
import { CanvasContextMenu, CanvasSelectedNodeWorkflow, CanvasSelectionBar, CanvasStatusNode, type CanvasMenuState } from "./canvas/CanvasChrome";
import { MAX_ZOOM, MIN_ZOOM, canvasNodeKinds, kindLabels, workflowStageLabels } from "./canvas/constants";
import { buildCanvasFlowNodes } from "./canvas/flowMapping";
import { formatMindChain } from "../../../../shared/canvasMindChain";
import type { CanvasFlowNode } from "./canvas/types";
import { completeCanvasToolAction, type CanvasTool } from "./canvas/toolState";
import { CanvasObjectLayer } from "./canvas/CanvasObjectLayer";
import { ShapeLibraryPanel } from "./canvas/ShapeLibraryPanel";

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
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onCreateObject: (draft: CanvasObjectDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteObject: (objectId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateObject: (objectId: string, patch: CanvasObjectPatch) => Promise<unknown>;
  onUploadAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflowStage; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { stage?: CanvasWorkflowStage; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
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
  onAcceptSuggestion,
  onConvertSuggestionToNode,
  onCreateEdge,
  onCreateNode,
  onCreateObject,
  onDeleteEdge,
  onDeleteNode,
  onDeleteObject,
  onIgnoreSuggestion,
  onSendMindChainToChat,
  onSelectNode,
  onUndo,
  onUpdateNode,
  onUpdateObject,
  onUploadAsset,
  onUpdateNodeWorkflow,
  onUpdateWorkflow,
  onToolChange
}: DocumentCanvasProps) {
  const { locale } = useI18n();
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [shapeKind, setShapeKind] = useState("rectangle");
  const [recentShapeIds, setRecentShapeIds] = useState<string[]>(["rectangle", "circle", "diamond"]);
  const [, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const resizingNodeIdRef = useRef<string | null>(null);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    setFlowNodes((current) => buildCanvasFlowNodes({
      nodes,
      currentNodes: current,
      selectedNodeId,
      resizingNodeId,
      locale,
      workflow,
      suggestions,
      callbacks: {
        onAcceptSuggestion,
        onConvertSuggestionToNode,
        onDeleteNode,
        onIgnoreSuggestion,
        onResizeStateChange: handleResizeStateChange,
        onUpdateNode
      }
    }));
  }, [handleResizeStateChange, locale, nodes, onAcceptSuggestion, onConvertSuggestionToNode, onDeleteNode, onIgnoreSuggestion, onUpdateNode, resizingNodeId, selectedNodeId, suggestions, workflow]);

  useEffect(() => {
    if (activeTool === "asset") assetInputRef.current?.click();
  }, [activeTool]);

  const createNode = async (kind: CanvasNodeKind) => {
    if (!menu) return;
    setMenu(null);
    const roleId = `role_${Date.now().toString(36)}`;
    await onCreateNode({
      kind,
      title: kindLabels[kind]?.[locale] ?? kind,
      content: "",
      x: Math.round(menu.canvasX),
      y: Math.round(menu.canvasY),
      width: kind === "document" ? 520 : kind === "role" ? 280 : 300,
      height: kind === "document" ? 260 : kind === "role" ? 190 : 190,
      metadata: kind === "role" ? { workflowRole: { roleId, label: "Role", prompt: "" } } : undefined
    });
  };

  const createNodeAt = useCallback(async (kind: CanvasNodeKind, x: number, y: number) => {
    const roleId = `role_${Date.now().toString(36)}`;
    await onCreateNode({
      kind,
      title: kindLabels[kind]?.[locale] ?? kind,
      content: "",
      x: Math.round(x),
      y: Math.round(y),
      width: kind === "document" ? 520 : kind === "role" ? 280 : 300,
      height: kind === "document" ? 260 : kind === "role" ? 190 : 190,
      metadata: kind === "role" ? { workflowRole: { roleId, label: "Role", prompt: "" } } : undefined
    });
    onToolChange(completeCanvasToolAction(activeTool));
  }, [activeTool, locale, onCreateNode, onToolChange]);

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
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setMenu({ screenX: event.clientX, screenY: event.clientY, canvasX: point.x, canvasY: point.y, nodeId: node.id });
    setSelectedEdgeId(undefined);
    onSelectNode(node.id);
  }, [onSelectNode, reactFlow]);

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

  const resetViewport = () => {
    void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 160 });
  };

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    void onCreateEdge({ sourceNodeId: connection.source, targetNodeId: connection.target });
  }, [onCreateEdge]);

  const sendMindChain = (nodeId: string) => {
    const text = formatMindChain(nodeId, nodes, edges, locale);
    if (text) onSendMindChainToChat(text);
    setMenu(null);
  };

  const deleteSelectedEdge = async () => {
    if (!selectedEdgeId) return;
    await onDeleteEdge(selectedEdgeId);
    setSelectedEdgeId(undefined);
  };

  const handleArrowPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "arrow") return;
    if (!(event.target instanceof Element) || !event.target.closest(".react-flow__pane")) return;
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

  const handleCanvasClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "shape" && activeTool !== "table") return;
    if (!(event.target instanceof Element) || !event.target.closest(".react-flow__pane")) return;
    event.preventDefault();
    event.stopPropagation();
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    void onCreateObject({
      kind: activeTool,
      geometry: { x: point.x, y: point.y, width: activeTool === "table" ? 360 : 220, height: activeTool === "table" ? 180 : 140 },
      data: activeTool === "shape" ? { shape: shapeKind } : { rows: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => "")) }
    }).then(() => onToolChange("select"));
  };

  return (
    <section className="canvas-shell" aria-label="Document canvas workspace" data-testid="document-canvas">
      <div className="canvas-topline">
        <div>
          <p className="eyebrow">Doc Canvas</p>
          {workflow ? <p className="canvas-workflow-summary">{locale === "zh" ? "当前环节" : "Current stage"}: {workflowStageLabels[workflow.stage][locale]}</p> : null}
          <h2>{locale === "zh" ? "文档画板" : "Document canvas"}</h2>
        </div>
        <div className="canvas-controls" aria-label="Canvas controls">
          <span className="metadata-chip">
            <span className="status-dot" />
            {providerLabel}
          </span>
          {workflow ? (
            <select
              className="canvas-stage-select"
              aria-label="Canvas workflow stage"
              value={workflow.stage}
              onChange={(event) => void onUpdateWorkflow({ stage: event.target.value as CanvasWorkflowStage })}
            >
              {workflow.stages.map((stage) => <option key={stage} value={stage}>{workflowStageLabels[stage][locale]}</option>)}
            </select>
          ) : null}
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
          <button className="button button-secondary button-small" type="button" disabled={!canUndo} onClick={() => void onUndo()}>
            {locale === "zh" ? "撤销" : "Undo"}
          </button>
        </div>
      </div>

      <div className="canvas-viewport" data-testid="canvas-viewport" onClickCapture={handleCanvasClickCapture} onPointerDownCapture={handleArrowPointerDown}>
        <input
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.txt,.md"
          className="canvas-asset-input"
          ref={assetInputRef}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return onToolChange("select");
            void readFileBase64(file).then((fileBase64) => onUploadAsset({ fileName: file.name, fileBase64 })).finally(() => onToolChange("select"));
          }}
        />
        {workflow ? <CanvasStatusNode label={locale === "zh" ? "写作环节" : "Writing stage"} stageLabel={workflowStageLabels[workflow.stage][locale]} /> : null}
        <ReactFlow<CanvasFlowNode>
          className="canvas-flow"
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
          onNodeContextMenu={openNodeMenu}
          onNodesChange={onNodesChange}
          onPaneClick={(event) => {
            closeMenu();
            if (activeTool === "document" || activeTool === "note" || activeTool === "text" || activeTool === "role") {
              const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
              void createNodeAt(activeTool === "text" ? "note" : activeTool, point.x, point.y);
              return;
            }
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
          <Background color="#dbe7f7" gap={28} size={1} variant={BackgroundVariant.Lines} />
        </ReactFlow>
        <CanvasObjectLayer
          objects={objects}
          selectedObjectIds={selectedObjectIds}
          transform={`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`}
          onDeleteObject={(objectId) => void onDeleteObject(objectId)}
          onSelectObject={(objectId, additive) => {
            setSelectedObjectIds((current) => additive ? current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId] : [objectId]);
            setSelectedEdgeId(undefined);
            onSelectNode(undefined);
          }}
          onUpdateObject={(objectId, geometry) => void onUpdateObject(objectId, { geometry })}
          onUpdateData={(objectId, data) => void onUpdateObject(objectId, { data })}
          zoom={viewport.zoom}
        />

        {nodes.length === 0 ? (
          <div className="canvas-empty">
            <strong>{locale === "zh" ? "右键新建节点" : "Right-click to create a node"}</strong>
            <span>{locale === "zh" ? "Agent 的写入申请会在批准后生成或修改这里的节点。" : "Approved Agent write requests will create or update nodes here."}</span>
          </div>
        ) : null}

        {menu ? (
          <CanvasContextMenu
            createItems={canvasNodeKinds.map((kind) => ({ kind, label: kindLabels[kind]?.[locale] ?? kind }))}
            menu={menu}
            sendMindChainLabel={locale === "zh" ? "发送思维链" : "Send mind chain"}
            onCreateNode={(kind) => void createNode(kind)}
            onSendMindChain={sendMindChain}
          />
        ) : null}
        {activeTool === "agent" ? (
          <div className="canvas-agent-tool-menu" data-testid="canvas-agent-tool-menu">
            <strong>{locale === "zh" ? "选区 Agent 操作" : "Selection Agent actions"}</strong>
            {[
              [locale === "zh" ? "总结选区" : "Summarize selection", "Summarize the selected Canvas items."],
              [locale === "zh" ? "解释关系" : "Explain relationships", "Explain the relationships between the selected Canvas items."],
              [locale === "zh" ? "生成内容提案" : "Create content proposal", "Create a content proposal based on the selected Canvas items."],
              [locale === "zh" ? "布局整理建议" : "Suggest layout cleanup", "Suggest a clearer layout for the selected Canvas items without changing the Canvas."]
            ].map(([label, instruction]) => (
              <button key={label} type="button" onClick={() => {
                const selectedNodes = nodes.filter((node) => selectedNodeIds.includes(node.id)).map((node) => `${node.title}: ${node.content}`);
                const selectedObjects = objects.filter((object) => selectedObjectIds.includes(object.id)).map((object) => `[${object.kind}] ${JSON.stringify(object.data)}`);
                onSendMindChainToChat(`${instruction}\n\n${[...selectedNodes, ...selectedObjects].join("\n") || "No Canvas items selected."}`);
                onToolChange("select");
              }}>{label}</button>
            ))}
          </div>
        ) : null}
        {activeTool === "shape" ? (
          <ShapeLibraryPanel
            locale={locale}
            recentShapeIds={recentShapeIds}
            onClose={() => onToolChange("select")}
            onSelectShape={(shape) => {
              setShapeKind(shape);
              setRecentShapeIds((current) => [shape, ...current.filter((id) => id !== shape)].slice(0, 6));
            }}
          />
        ) : null}
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

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

