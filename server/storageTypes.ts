import type { CanvasWorkflowRole, CanvasWorkflowStage, CanvasWorkflowSuggestionStatus } from "../shared/canvasWorkflow.js";
import type { Provider } from "./types.js";
import type { ToolEventRecord } from "./toolRuntime.js";

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RunRecordInput = {
  threadId: string;
  agentCardId: string;
  configuredModelApiId?: string;
  modelId?: string;
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
  projectId: string;
  title: string;
  configuredModelApiId?: string | null;
  contextResetAt?: string | null;
  updatedAt: string;
  deletedAt?: string | null;
  assetCount?: number;
};

export type ProjectSummary = {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  deletedAt?: string | null;
  provider?: string;
  assetCount: number;
  threadCount: number;
  modelConfigIds: string[];
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
  includeInProjectContext: boolean;
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
export type CanvasWriteOperation = "create" | "replace" | "append" | "replace_range";
export type CanvasWriteRequestStatus = "pending" | "approved" | "rejected" | "stale";

export type CanvasNode = {
  id: string;
  projectId: string;
  kind: CanvasNodeKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: JsonValue;
  includeInProjectContext: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CanvasWriteRequest = {
  id: string;
  projectId: string;
  operation: CanvasWriteOperation;
  targetNodeId?: string;
  nodeKind: CanvasNodeKind;
  title: string;
  content: string;
  rationale: string;
  rangeStart?: number;
  rangeEnd?: number;
  originalText?: string;
  baseNodeUpdatedAt?: string;
  status: CanvasWriteRequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type CanvasEdge = {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type { CanvasObject, CanvasObjectKind } from "../shared/canvasObjects.js";
export type CanvasObjectInput = { id?: string; kind: unknown; geometry?: unknown; data?: unknown };
export type CanvasObjectPatch = { kind?: unknown; geometry?: unknown; data?: unknown };

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
  includeInProjectContext?: boolean;
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
  rangeStart?: number;
  rangeEnd?: number;
  originalText?: string;
  baseNodeUpdatedAt?: string;
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
  projectId: string;
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
  projectId: string;
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
