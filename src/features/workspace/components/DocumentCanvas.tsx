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
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowStage, CanvasWorkflowSuggestion } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { useI18n } from "../../i18n/I18nProvider";
import { ResetIcon, ZoomInIcon, ZoomOutIcon } from "../../../shared/icons";
import { CanvasCurveEdge } from "./canvas/CanvasCurveEdge";
import { CanvasNodeFrame } from "./canvas/CanvasNodeFrame";
import { MAX_ZOOM, MIN_ZOOM, canvasNodeKinds, kindLabels, workflowStageLabels } from "./canvas/constants";
import { readDimension } from "./canvas/nodeLayout";
import { formatMindChain } from "../../../../shared/canvasMindChain";
import type { CanvasFlowNode } from "./canvas/types";

type DocumentCanvasProps = {
  canUndo: boolean;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  providerLabel: string;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  selectedNodeId?: string;
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflowStage; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { stage?: CanvasWorkflowStage; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
};

type MenuState = { screenX: number; screenY: number; canvasX: number; canvasY: number; nodeId?: string };

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
  canUndo,
  edges,
  nodes,
  providerLabel,
  workflow,
  suggestions,
  selectedNodeId,
  onAcceptSuggestion,
  onConvertSuggestionToNode,
  onCreateEdge,
  onCreateNode,
  onDeleteEdge,
  onDeleteNode,
  onIgnoreSuggestion,
  onSendMindChainToChat,
  onSelectNode,
  onUndo,
  onUpdateNode,
  onUpdateNodeWorkflow,
  onUpdateWorkflow
}: DocumentCanvasProps) {
  const { locale } = useI18n();
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const resizingNodeIdRef = useRef<string | null>(null);
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
    setFlowNodes((current) => mapCanvasNodes({
      nodes,
      currentNodes: current,
      selectedNodeId,
      resizingNodeId,
      locale,
      workflow,
      suggestions,
      onAcceptSuggestion,
      onConvertSuggestionToNode,
      onDeleteNode,
      onIgnoreSuggestion,
      onResizeStateChange: handleResizeStateChange,
      onUpdateNode
    }));
  }, [handleResizeStateChange, locale, nodes, onAcceptSuggestion, onConvertSuggestionToNode, onDeleteNode, onIgnoreSuggestion, onUpdateNode, resizingNodeId, selectedNodeId, suggestions, workflow]);

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
    setSelectedEdgeId(nextEdgeId);
    onSelectNode(nextEdgeId ? undefined : params.nodes[0]?.id);
  }, [onSelectNode]);

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

      <div className="canvas-viewport" data-testid="canvas-viewport">
        {workflow ? (
          <div className="canvas-status-node" data-testid="canvas-status-node">
            <span>{locale === "zh" ? "写作环节" : "Writing stage"}</span>
            <strong>{workflowStageLabels[workflow.stage][locale]}</strong>
          </div>
        ) : null}
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
          nodesDraggable={!resizingNodeId}
          onMoveStart={closeMenu}
          onNodeDragStart={closeMenu}
          onNodeDragStop={onNodeDragStop}
          onNodeContextMenu={openNodeMenu}
          onNodesChange={onNodesChange}
          onPaneClick={() => {
            closeMenu();
            onSelectNode(undefined);
          }}
          onPaneContextMenu={openMenu}
          onSelectionChange={handleSelectionChange}
          panActivationKeyCode="Space"
          panOnDrag={false}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          selectionOnDrag={!resizingNodeId}
          selectionMode={SelectionMode.Partial}
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
          <div className="canvas-menu" data-testid="canvas-menu" style={{ left: menu.screenX, top: menu.screenY }}>
            {menu.nodeId ? (
              <button type="button" onClick={() => sendMindChain(menu.nodeId!)}>{locale === "zh" ? "发送思维链" : "Send mind chain"}</button>
            ) : null}
            {!menu.nodeId ? canvasNodeKinds.map((kind) => (
              <button key={kind} type="button" data-testid={`canvas-menu-create-${kind}`} onClick={() => void createNode(kind)}>{kindLabels[kind]?.[locale] ?? kind}</button>
            )) : null}
          </div>
        ) : null}
      </div>

      <div className="canvas-selection-bar" data-testid="canvas-selection-bar">
        {selectedNode ? (
          <span>{locale === "zh" ? "已选中" : "Selected"}: {selectedNode.title || kindLabels[selectedNode.kind][locale]}</span>
        ) : selectedEdgeId ? (
          <span>{locale === "zh" ? "已选中连线" : "Selected edge"}</span>
        ) : (
          <span>{locale === "zh" ? "未选中节点" : "No node selected"}</span>
        )}
        {selectedEdgeId ? (
          <button className="button button-secondary button-small" type="button" data-testid="canvas-delete-edge" onClick={() => void deleteSelectedEdge()}>
            {locale === "zh" ? "删除连线" : "Delete edge"}
          </button>
        ) : null}
        <span className="canvas-interaction-hint">
          {locale === "zh" ? "点击选中 · 拖拽空白框选 · 空格 + 拖拽移动画布 · Ctrl + 滚轮缩放" : "Click to select · Drag blank space to marquee select · Space + drag to pan · Ctrl + wheel to zoom"}
        </span>
      </div>
      {selectedNode && workflow && selectedNode.kind !== "role" ? (
        <CanvasSelectedNodeWorkflow locale={locale} node={selectedNode} workflow={workflow} onUpdateNodeWorkflow={onUpdateNodeWorkflow} />
      ) : null}
    </section>
  );
}

function mapCanvasNodes({
  nodes,
  currentNodes,
  selectedNodeId,
  resizingNodeId,
  locale,
  workflow,
  suggestions,
  onAcceptSuggestion,
  onConvertSuggestionToNode,
  onDeleteNode,
  onIgnoreSuggestion,
  onResizeStateChange,
  onUpdateNode
}: {
  nodes: CanvasNode[];
  currentNodes: CanvasFlowNode[];
  selectedNodeId?: string;
  resizingNodeId: string | null;
  locale: "en" | "zh";
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onResizeStateChange: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
}): CanvasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const current = currentById.get(node.id);
    const nodeSuggestions = suggestions.filter((suggestion) => suggestion.nodeId === node.id);
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
        suggestions: nodeSuggestions,
        workflow,
        onAcceptSuggestion,
        onConvertSuggestionToNode,
        onDeleteNode,
        onIgnoreSuggestion,
        onResizeStateChange,
        onUpdateNode
      }
    };
  });
}

function CanvasSelectedNodeWorkflow({
  locale,
  node,
  workflow,
  onUpdateNodeWorkflow
}: {
  locale: "en" | "zh";
  node: CanvasNode;
  workflow: CanvasWorkflow;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflowStage; roles?: string[] }) => Promise<unknown>;
}) {
  const nodeWorkflow = readNodeWorkflow(node);

  return (
    <div className="canvas-selected-workflow" data-testid="canvas-selected-workflow">
      <label>
        <span>{locale === "zh" ? "节点环节" : "Node stage"}</span>
        <select
          aria-label="Selected node workflow stage"
          value={nodeWorkflow.stage ?? workflow.stage}
          onChange={(event) => void onUpdateNodeWorkflow(node.id, { stage: event.target.value as CanvasWorkflowStage })}
        >
          {workflow.stages.map((stage) => <option key={stage} value={stage}>{workflowStageLabels[stage][locale]}</option>)}
        </select>
      </label>
    </div>
  );
}

function readNodeWorkflow(node: CanvasNode): { stage?: CanvasWorkflowStage; roles: string[] } {
  const metadata = node.metadata as { workflow?: { stage?: CanvasWorkflowStage; roles?: unknown } } | undefined;
  return {
    stage: metadata?.workflow?.stage,
    roles: Array.isArray(metadata?.workflow?.roles) ? metadata.workflow.roles.filter((role): role is string => typeof role === "string") : []
  };
}
