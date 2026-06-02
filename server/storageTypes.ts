import type { CanvasWorkflowRole, CanvasWorkflowStage, CanvasWorkflowSuggestionStatus } from "../shared/canvasWorkflow.js";
import type { Provider } from "./types.js";
import type { ToolEventRecord } from "./toolRuntime.js";

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RunRecordInput = {
  threadId: string;
  agentCardId: string;
  mode: "structured" | "chat";
  prompt: string;
  output: string;
  provider: Provider;
  usedMock: boolean;
  errorMessage?: string;
  userMessage?: string;
  toolState?: Record<string, unknown>;
  events?: ToolEventRecord[];
  finishReason?: string;
  usage?: unknown;
};

export type StoredMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  usedMock: boolean;
  createdAt: string;
};

export type StoredThread = {
  id: string;
  agentCardId: string;
  title: string;
  updatedAt: string;
  deletedAt?: string | null;
  assetCount?: number;
};

export type ProjectSummary = StoredThread & {
  agentTitle: string;
  provider?: string;
};

export type StoredStructuredValues = Record<string, string | string[]>;

export type StoredOutputVersion = {
  id: string;
  threadId: string;
  runId: string;
  content: string;
  mode: "structured" | "chat";
  provider: Provider;
  usedMock: boolean;
  createdAt: string;
};

export type StoredToolEvent = {
  id: string;
  threadId: string;
  runId: string;
  eventType: string;
  payload: JsonValue;
  createdAt: string;
};

export type CanvasNodeKind = "document" | "note" | "reference" | "role";
export type CanvasWriteOperation = "create" | "replace" | "append";
export type CanvasWriteRequestStatus = "pending" | "approved" | "rejected";

export type CanvasNode = {
  id: string;
  threadId: string;
  kind: CanvasNodeKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: JsonValue;
  createdAt: string;
  updatedAt: string;
};

export type CanvasWriteRequest = {
  id: string;
  threadId: string;
  operation: CanvasWriteOperation;
  targetNodeId?: string;
  nodeKind: CanvasNodeKind;
  title: string;
  content: string;
  rationale: string;
  status: CanvasWriteRequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type CanvasEdge = {
  id: string;
  threadId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasNodeInput = {
  id?: string;
  kind: CanvasNodeKind;
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  metadata?: JsonValue;
};

export type CanvasNodePatch = Partial<Omit<CanvasNodeInput, "kind">> & {
  kind?: CanvasNodeKind;
};

export type CanvasWriteRequestInput = {
  operation: CanvasWriteOperation;
  targetNodeId?: string;
  nodeKind?: CanvasNodeKind;
  title?: string;
  content: string;
  rationale?: string;
};

export type CanvasEdgeInput = {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
};

export type CanvasSettings = {
  undoDepth: number;
};

export type CanvasWorkflow = {
  threadId: string;
  stage: CanvasWorkflowStage;
  stages: CanvasWorkflowStage[];
  roles: CanvasWorkflowRole[];
  updatedAt: string;
};

export type CanvasWorkflowInput = {
  stage?: CanvasWorkflowStage;
  roles?: CanvasWorkflowRole[];
};

export type CanvasNodeWorkflowPatch = {
  stage?: CanvasWorkflowStage;
  roles?: string[];
};

export type CanvasWorkflowSuggestion = {
  id: string;
  threadId: string;
  nodeId: string;
  roleNodeId: string;
  targetNodeId: string;
  roleId: string;
  content: string;
  rationale: string;
  status: CanvasWorkflowSuggestionStatus;
  createdAt: string;
  updatedAt: string;
};

export type CanvasWorkflowSuggestionInput = {
  nodeId?: string;
  roleNodeId?: string;
  targetNodeId?: string;
  roleId: string;
  content: string;
  rationale?: string;
};

export type CanvasSuggestionToNodeInput = {
  kind?: CanvasNodeKind;
  title?: string;
};
