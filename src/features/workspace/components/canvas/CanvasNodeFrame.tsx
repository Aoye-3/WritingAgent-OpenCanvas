import { Handle, Position, useReactFlow, useViewport, type NodeProps } from "@xyflow/react";
import { flushSync } from "react-dom";
import type { CanvasNode } from "../../../agents/types";
import { CloseIcon } from "../../../../shared/icons";
import { MIN_NODE_SIZE, kindLabels } from "./constants";
import { computeResize, isKnownCanvasKind, readDimension, withManualCanvasSize } from "./nodeLayout";
import { CanvasNodeRenderer } from "./renderers/CanvasNodeRenderer";
import type { CanvasFlowNode, CanvasLocale, ResizeHandle } from "./types";

const resizeHandles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function CanvasNodeFrame({ data, selected }: NodeProps<CanvasFlowNode>) {
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
    <article className={`canvas-node ${kindClass} ${selected ? "is-selected" : ""}`} data-testid="canvas-node">
      <NodeLinkPort />
      {selected ? <ResizeFrame onResizeStart={startResize} /> : null}
      <CanvasNodeHeader locale={locale} node={node} onDeleteNode={onDeleteNode} />
      <CanvasNodeRenderer isResizing={isResizing} locale={locale} node={node} onUpdateNode={onUpdateNode} />
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
  node,
  onDeleteNode
}: {
  locale: CanvasLocale;
  node: CanvasNode;
  onDeleteNode: (nodeId: string) => Promise<void>;
}) {
  const label = isKnownCanvasKind(node.kind) ? kindLabels[node.kind][locale] : (locale === "zh" ? "鏈煡鑺傜偣" : "Unknown node");
  return (
    <div className="canvas-node-header canvas-node-drag-handle">
      <span>{label}</span>
      <button className="icon-button canvas-node-delete nodrag" type="button" aria-label="Delete node" onClick={() => void onDeleteNode(node.id)}>
        <CloseIcon aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
