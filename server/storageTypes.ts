import type { CanvasWorkflowMode, CanvasWorkflowRole, CanvasWorkflowStage, CanvasWorkflowSuggestionStatus } from "../shared/canvasWorkflow.js";
import type { ClaimCandidate, ClaimSourceAnchor, ClaimStatus, CreateClaimFromSelectionInput, ExtractClaimsInput, UpdateClaimInput } from "../shared/claimReview.js";
import type { Provider } from "./types.js";
import type { ToolEventRecord } from "./toolRuntime.js";

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RunRecordInput = {
  threadId: string;
  clientRequestId?: string;
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
  runtimeRunId?: string;
  runtimeThreadId?: string;
  resumedClarificationId?: string;
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

export type ProjectCanvasPreviewNode = {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProjectCanvasPreviewObject = {
  id: string;
  kind: "arrow" | "shape" | "table" | "asset" | "text";
  geometry: JsonValue;
  data?: JsonValue;
};

export type ProjectCanvasPreview = {
  nodes: ProjectCanvasPreviewNode[];
  objects: ProjectCanvasPreviewObject[];
  updatedAt: string;
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
  canvasPreview?: ProjectCanvasPreview;
};

export type RuntimeBudgetProfile = "low" | "medium" | "high";

export type ProjectRuntimeSettings = {
  runtimeBudgetProfile: RuntimeBudgetProfile;
  evidenceToolLimit: number;
  bodyDraftWriteLimit: number;
  modelCallLimit: number;
  recursionLimit: number;
  synthesisReserveSteps: number;
};

export type DeliverableType = "auto" | "document" | "outline" | "analysis" | "checklist" | "proposal";

export type ProjectBrief = {
  goal?: string;
  audience?: string;
  background?: string;
  standingConstraints?: string;
};

export type TaskBrief = {
  objective?: string;
  deliverableType?: DeliverableType;
  deliverableDetails?: string;
  mustCover?: string;
  temporaryConstraints?: string;
};

export type StoredBrief<T> = {
  brief: T;
  revision: number;
};

export type PlanRunStatus = "draft" | "awaiting_approval" | "running" | "paused" | "awaiting_user" | "completed" | "failed" | "cancelled";
export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type PlanArtifactStatus = "staged" | "committing" | "committed" | "failed";
export type PlanArtifactType = "text" | "image";
export type PlanRunOrigin = "explicit_plan" | "auto_complex_task" | "approved_execution";

export type PlanStep = {
  id: string;
  planRunId: string;
  order: number;
  title: string;
  detail: string;
  status: PlanStepStatus;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type PlanArtifact = {
  id: string;
  planRunId: string;
  stepId: string;
  type: PlanArtifactType;
  status: PlanArtifactStatus;
  title: string;
  payload: JsonValue;
  source: JsonValue;
  canvasTargetId?: string;
  layout: JsonValue;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanArtifactLink = { id: string; planRunId: string; fromArtifactId: string; toArtifactId: string; label: string; canvasEdgeId?: string };
export type PlanClarificationOption = { id: string; label: string; description: string; recommended: boolean };
export type PlanClarification = {
  question: string;
  options: PlanClarificationOption[];
  status: "pending" | "answered";
  selectedOptionId?: string;
  customAnswer?: string;
};
export type PlanActivityType =
  | "intent_recognized"
  | "clarification_preparing"
  | "clarification_ready"
  | "plan_preparing"
  | "plan_ready"
  | "step_started"
  | "tool_started"
  | "tool_completed"
  | "artifact_committed"
  | "step_completed"
  | "plan_paused"
  | "plan_resumed"
  | "plan_failed"
  | "plan_completed";
export type PlanActivity = {
  id: string;
  threadId: string;
  planRunId: string;
  runId?: string;
  stepId?: string;
  type: PlanActivityType;
  status: string;
  summary: string;
  detail: JsonValue;
  sequence: number;
  createdAt: string;
};
export type PlanExecution = {
  planRunId: string;
  threadId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  currentStepId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastHeartbeatAt?: string;
  cancelToken: string;
  attempt: number;
  startedAt: string;
  pausedAt?: string;
  completedAt?: string;
  updatedAt: string;
};
export type PlanRun = {
  id: string;
  projectId: string;
  threadId: string;
  runId?: string;
  title: string;
  goal: string;
  status: PlanRunStatus;
  approval: "pending" | "approved" | "rejected";
  statusMessage: string;
  canvasNodeId?: string;
  currentStepId?: string;
  executionVersion: number;
  origin?: PlanRunOrigin;
  complexity?: JsonValue;
  budget?: JsonValue;
  preflight?: JsonValue;
  clarification?: PlanClarification;
  steps: PlanStep[];
  artifacts: PlanArtifact[];
  links: PlanArtifactLink[];
  createdAt: string;
  updatedAt: string;
};

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

export type AgentClarificationOption = { id: string; label: string; detail: string; recommended: boolean };
export type AgentClarificationStatus = "pending" | "answered";
export type AgentClarificationResumeState = "not_resumable" | "awaiting_answer" | "queued" | "resuming" | "succeeded" | "failed";
export type StoredAgentClarification = {
  id: string;
  threadId: string;
  runId: string;
  status: AgentClarificationStatus;
  question: string;
  options: AgentClarificationOption[];
  resumeContext: JsonValue;
  selectedOptionId?: string;
  selectedOptionLabel?: string;
  answer?: string;
  resumeState: AgentClarificationResumeState;
  resumeAttempts: number;
  resumeError?: string;
  resumedRuntimeRunId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasNodeKind = "document" | "note" | "reference" | "role" | "plan" | "file_document" | "clarification";
export type CanvasWriteOperation = "create" | "replace" | "append" | "replace_range" | "delete";
export type CanvasWriteRequestStatus = "pending" | "approved" | "rejected" | "stale";
export type CanvasWriteSuggestion = {
  id: string;
  threadId: string;
  projectId: string;
  runId: string;
  status: "pending" | "accepted" | "dismissed" | "stale";
  items: Array<{ title: string; content: string }>;
  nodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

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

export type CanvasNodePositionUpdate = {
  nodeId: string;
  x: number;
  y: number;
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
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
};

export type CanvasSettings = {
  undoDepth: number;
};

export type CanvasWorkflow = {
  projectId: string;
  mode: CanvasWorkflowMode;
  stage: CanvasWorkflowStage;
  stages: CanvasWorkflowStage[];
  roles: CanvasWorkflowRole[];
  updatedAt: string;
};

export type CanvasWorkflowInput = {
  mode?: CanvasWorkflowMode;
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

export type {
  ClaimCandidate,
  ClaimSourceAnchor,
  ClaimStatus,
  CreateClaimFromSelectionInput,
  ExtractClaimsInput,
  UpdateClaimInput
};
