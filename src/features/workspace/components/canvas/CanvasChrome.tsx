import type { CSSProperties } from "react";
import type { CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowStage } from "../../../agents/types";
import { kindLabels, workflowStageLabels } from "./constants";
import type { CanvasLocale } from "./types";

export type CanvasMenuState = { screenX: number; screenY: number; canvasX: number; canvasY: number; nodeId?: string };

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
  onCreateNode,
  onSendMindChain
}: {
  createItems: Array<{ kind: CanvasNodeKind; label: string }>;
  menu: CanvasMenuState;
  sendMindChainLabel: string;
  onCreateNode: (kind: CanvasNodeKind) => void;
  onSendMindChain: (nodeId: string) => void;
}) {
  const style: CSSProperties = { left: menu.screenX, top: menu.screenY };
  return (
    <div className="canvas-menu" data-testid="canvas-menu" style={style}>
      {menu.nodeId ? (
        <button type="button" onClick={() => onSendMindChain(menu.nodeId!)}>{sendMindChainLabel}</button>
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

export function CanvasSelectedNodeWorkflow({
  locale,
  node,
  workflow,
  onUpdateNodeWorkflow
}: {
  locale: CanvasLocale;
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
