import type { CSSProperties } from "react";
import type { CanvasNode, CanvasNodeKind } from "../../../agents/types";
import { kindLabels } from "./constants";
import type { CanvasLocale, CanvasTextSelection } from "./types";

export type CanvasMenuState = { screenX: number; screenY: number; canvasX: number; canvasY: number; nodeId?: string; textSelection?: CanvasTextSelection };

export function CanvasStatusNode({ label, stageLabel }: { label: string; stageLabel: string }) {
  return (
    <div className="canvas-status-node" data-testid="canvas-status-node">
      <span>{label}</span>
      <strong>{stageLabel}</strong>
    </div>
  );
}

export function CanvasContextMenu({
  createItems,
  menu,
  sendMindChainLabel,
  splitSelectionLabel,
  onCreateNode,
  onSendMindChain,
  onSplitSelection
}: {
  createItems: Array<{ kind: CanvasNodeKind; label: string }>;
  menu: CanvasMenuState;
  sendMindChainLabel: string;
  splitSelectionLabel: string;
  onCreateNode: (kind: CanvasNodeKind) => void;
  onSendMindChain: (nodeId: string) => void;
  onSplitSelection: (nodeId: string) => void;
}) {
  const style: CSSProperties = { left: menu.screenX, top: menu.screenY };
  return (
    <div className="canvas-menu" data-testid="canvas-menu" style={style}>
      {menu.nodeId ? (
        <button type="button" onClick={() => onSendMindChain(menu.nodeId!)}>{sendMindChainLabel}</button>
      ) : null}
      {menu.nodeId && menu.textSelection ? (
        <button type="button" data-testid="canvas-menu-split-selection" onClick={() => onSplitSelection(menu.nodeId!)}>{splitSelectionLabel}</button>
      ) : null}
      {!menu.nodeId ? createItems.map((item) => (
        <button key={item.kind} type="button" data-testid={`canvas-menu-create-${item.kind}`} onClick={() => onCreateNode(item.kind)}>{item.label}</button>
      )) : null}
    </div>
  );
}

export function CanvasSelectionBar({
  deleteEdgeLabel,
  hint,
  locale,
  selectedEdgeId,
  selectedNode,
  onDeleteSelectedEdge
}: {
  deleteEdgeLabel: string;
  hint: string;
  locale: CanvasLocale;
  selectedEdgeId?: string;
  selectedNode?: CanvasNode;
  onDeleteSelectedEdge: () => void;
}) {
  return (
    <div className="canvas-selection-bar" data-testid="canvas-selection-bar">
      {selectedNode ? (
        <span>{locale === "zh" ? "已选中" : "Selected"}: {selectedNode.title || kindLabels[selectedNode.kind][locale]}</span>
      ) : selectedEdgeId ? (
        <span>{locale === "zh" ? "已选中连线" : "Selected edge"}</span>
      ) : (
        <span>{locale === "zh" ? "未选中节点" : "No node selected"}</span>
      )}
      {selectedEdgeId ? (
        <button className="button button-secondary button-small" type="button" data-testid="canvas-delete-edge" onClick={onDeleteSelectedEdge}>
          {deleteEdgeLabel}
        </button>
      ) : null}
      <span className="canvas-interaction-hint">{hint}</span>
    </div>
  );
}

