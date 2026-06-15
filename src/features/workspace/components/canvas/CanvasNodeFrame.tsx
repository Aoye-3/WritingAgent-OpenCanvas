import { Handle, Position, useReactFlow, useViewport, type NodeProps } from "@xyflow/react";
import { flushSync } from "react-dom";
import type { CanvasNode, CanvasWorkflowRole, CanvasWorkflowStage } from "../../../agents/types";
import { TrashIcon } from "../../../../shared/icons";
import { MIN_NODE_SIZE, kindLabels, workflowStageLabels } from "./constants";
import { computeResize, isKnownCanvasKind, readDimension, withManualCanvasSize } from "./nodeLayout";
import { CanvasNodeRenderer } from "./renderers/CanvasNodeRenderer";
import type { CanvasFlowNode, CanvasLocale, ResizeHandle } from "./types";

export const resizeHandles: ResizeHandle[] = ["n", "e", "s", "w"];

export function CanvasNodeFrame({ data, selected }: NodeProps<CanvasFlowNode>) {
  const { isResizing, locale, node, onDeleteNode, onResizeStateChange, onUpdateNode } = data;
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();
  const kindClass = isKnownCanvasKind(node.kind) ? `canvas-node-${node.kind}` : "canvas-node-unknown";
  const minSize = isKnownCanvasKind(node.kind) ? MIN_NODE_SIZE[node.kind] : { width: 220, height: 150 };
  const openContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    data.onRequestNodeMenu(node.id, { x: event.clientX, y: event.clientY });
  };

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
    <article className={`canvas-node ${kindClass} ${selected ? "is-selected" : ""}`} data-testid="canvas-node" onContextMenu={openContextMenu} onPointerEnter={data.onCreationPreviewBlocked}>
      <NodeLinkPort />
      {selected ? <ResizeFrame onResizeStart={startResize} /> : null}
      <CanvasNodeHeader locale={locale} node={node} />
      <CanvasNodeWorkflowBadges locale={locale} node={node} />
      <CanvasNodeRenderer
        agentCardId={data.agentCardId}
        isSelected={Boolean(selected)}
        isResizing={isResizing}
        locale={locale}
        modelOverrides={data.modelOverrides}
        node={node}
        pendingRequest={data.writeRequests[0]}
        onApproveWriteRequest={data.onApproveWriteRequest}
        onRejectWriteRequest={data.onRejectWriteRequest}
        onRequestRangeRewrite={data.onRequestRangeRewrite}
        onUpdateNode={onUpdateNode}
      />
      <CanvasNodeSuggestions
        locale={locale}
        roles={data.workflow?.roles ?? []}
        suggestions={data.suggestions}
        onAcceptSuggestion={data.onAcceptSuggestion}
        onConvertSuggestionToNode={data.onConvertSuggestionToNode}
        onIgnoreSuggestion={data.onIgnoreSuggestion}
      />
      <button className="icon-button canvas-node-delete nodrag" type="button" aria-label="Delete node" onClick={() => void onDeleteNode(node.id)}>
        <TrashIcon aria-hidden="true" size={15} />
      </button>
    </article>
  );
}

function NodeLinkPort() {
  return (
    <span className="canvas-node-link-port nodrag nopan" aria-label="Canvas node link port" data-testid="canvas-node-link-port">
      <span className="canvas-node-link-hole" aria-hidden="true" />
      <Handle className="canvas-node-link-handle canvas-node-link-target" type="target" position={Position.Top} />
      <Handle className="canvas-node-link-handle canvas-node-link-source" type="source" position={Position.Top} />
    </span>
  );
}

function ResizeFrame({ onResizeStart }: { onResizeStart: (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="canvas-node-resize-frame" aria-hidden="true">
      {resizeHandles.map((handle) => (
        <button
          className={`canvas-node-resize-handle canvas-node-resize-${handle} nodrag nopan`}
          data-testid={`canvas-node-resize-${handle}`}
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

function CanvasNodeHeader({
  locale,
  node
}: {
  locale: CanvasLocale;
  node: CanvasNode;
}) {
  const label = isKnownCanvasKind(node.kind) ? kindLabels[node.kind]?.[locale] ?? node.kind : (locale === "zh" ? "鏈煡鑺傜偣" : "Unknown node");
  return (
    <div className="canvas-node-header canvas-node-drag-handle">
      <span>{label}</span>
    </div>
  );
}

function CanvasNodeWorkflowBadges({ locale, node }: { locale: CanvasLocale; node: CanvasNode }) {
  if (node.kind === "role") return null;
  const workflow = readNodeWorkflow(node);
  const stageLabel = workflow.stage ? workflowStageLabels[workflow.stage][locale] : undefined;
  if (!stageLabel) return null;
  return (
    <div className="canvas-node-workflow-badges nodrag">
      {stageLabel ? <span className="canvas-node-stage-badge">{stageLabel}</span> : null}
    </div>
  );
}

function CanvasNodeSuggestions({
  locale,
  roles,
  suggestions,
  onAcceptSuggestion,
  onConvertSuggestionToNode,
  onIgnoreSuggestion
}: {
  locale: CanvasLocale;
  roles: CanvasWorkflowRole[];
  suggestions: CanvasFlowNode["data"]["suggestions"];
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
}) {
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");
  if (pending.length === 0) return null;
  return (
    <div className="canvas-node-suggestions nodrag">
      {pending.map((suggestion) => (
        <div className="canvas-node-suggestion" key={suggestion.id}>
          <strong>{roles.find((role) => role.id === suggestion.roleId)?.label ?? suggestion.roleId}</strong>
          <p>{suggestion.content}</p>
          <div className="canvas-node-suggestion-actions">
            <button type="button" onClick={() => void onAcceptSuggestion(suggestion.id)}>{locale === "zh" ? "接受" : "Accept"}</button>
            <button type="button" onClick={() => void onIgnoreSuggestion(suggestion.id)}>{locale === "zh" ? "忽略" : "Ignore"}</button>
            <button type="button" onClick={() => void onConvertSuggestionToNode(suggestion.id)}>{locale === "zh" ? "转节点" : "To node"}</button>
          </div>
        </div>
      ))}
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
