import type { Locale } from "../i18n/types";

export type AgentCategory = "chat";
export type AgentIcon = "bot" | "pen" | "lines" | "mail" | "book" | "report" | "refresh";
export type AgentAccent = "blue" | "green" | "orange" | "violet" | "rose";
export type ToolRef = "web_search" | "knowledge_base" | "quick_messages" | "clear_context" | "canvas_write" | "plan_clarification_submit" | "plan_revision_submit" | "artifact_stage";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolGroup = "web" | "context" | "chat";
export type AgentModelResponseMode = "normal" | "prefix_completion";

export type AgentCard = {
  id: string;
  category: AgentCategory;
  accent: AgentAccent;
  icon: AgentIcon;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  identityPrompt: string;
  skillRefs: string[];
  toolRefs: string[];
  outputContract: {
    type: string;
    defaultFormat: string;
  };
  settings?: AgentSettings;
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
export type StoredBrief<T> = { brief: T; revision: number };
export type BriefSaveStatus = "idle" | "saving" | "saved" | "error";

export type ConversationModelRuntimeSettings = {
  configuredModelApiId?: string;
  providerId: string;
  model: string;
  responseMode?: AgentModelResponseMode;
  temperature: number;
  topP: number;
  contextCount: number;
  maxTokens: number;
  maxTokensEnabled: boolean;
  streaming: boolean;
  toolCallMode: "auto" | "function" | "none";
  maxToolCalls: number;
  thinkingMode?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max" | "low" | "medium" | "xhigh";
};

export type AgentSettings = {
  prompt: {
    name: string;
    description: string;
    identityPrompt: string;
    outputType: string;
    outputFormat: string;
    skillRefs: string[];
  };
  tools: Partial<Record<ToolRef, boolean>>;
  knowledge: {
    enabled: boolean;
    scope: string;
    baseIds?: string[];
    documentCount?: number;
    threshold?: number;
    rerankEnabled?: boolean;
  };
  memory: {
    enabled: boolean;
  };
  quickMessages: string[];
  mcpRefs: string[];
};

export type ToolCatalogItem = {
  name: ToolRef;
  group: ToolGroup;
  label: string;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  enabledByDefault: boolean;
  requiresExternalConfig: boolean;
};

export type SkillCatalogItem = {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  status: "available";
};

export type ToolPolicy = {
  name: ToolRef;
  enabled: boolean;
  canAutoRun: boolean;
  requiresApproval: boolean;
  requiresExternalConfig: boolean;
  riskLevel: ToolRiskLevel;
};

export type ProviderCapabilities = {
  chatCompletions: boolean;
  streaming: boolean;
  toolCalls: boolean;
  thinking: boolean;
  reasoningContentPolicy?: "strip" | "preserve_when_tool_calling" | "preserve";
  jsonOutput: boolean;
  chatPrefixCompletion: boolean;
  supportsAssistantPrefix: boolean;
  betaBaseURL?: string;
};

export type ProviderProfile = {
  id: ConversationModelRuntimeSettings["providerId"];
  label: string;
  defaultBaseURL: string;
  defaultModel: string;
  capabilities: ProviderCapabilities;
};

export type AgentRuntimeConfig = {
  agentCard: AgentCard;
  settings: AgentSettings;
  availableTools: ToolCatalogItem[];
  enabledTools: ToolRef[];
  toolPolicies: ToolPolicy[];
  missingToolRefs: string[];
  deprecatedToolRefs: string[];
  availableSkills: SkillCatalogItem[];
  missingSkillRefs: string[];
};

export type ThreadCreateResponse = {
  thread: StoredThread;
  threadId: string;
  projectId: string;
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
  modelConfigIds: string[];
  threadCount: number;
  assetCount: number;
  agentCardId?: string;
  agentTitle?: string;
  provider?: string;
};

export type StoredOutputVersion = {
  id: string;
  threadId: string;
  runId: string;
  content: string;
  mode: "structured" | "chat";
  provider: "deepseek" | "openai" | "openai-compatible" | "agent-backend" | "mock";
  usedMock: boolean;
  includeInProjectContext: boolean;
  createdAt: string;
};

export type StoredToolEvent = {
  id: string;
  threadId: string;
  runId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

export type CanvasNodeKind = "document" | "note" | "reference" | "role" | "plan";
export type CanvasWriteOperation = "create" | "replace" | "append" | "replace_range";
export type CanvasWriteRequestStatus = "pending" | "approved" | "rejected" | "stale";
export type CanvasWriteSuggestion = {
  id: string; threadId: string; projectId: string; runId: string;
  status: "pending" | "accepted" | "dismissed" | "stale";
  items: Array<{ title: string; content: string }>;
  nodeIds: string[]; createdAt: string; updatedAt: string;
};
export type CanvasWorkflowStage = "inspiration" | "research" | "structure" | "writing" | "polish" | "publish";
export type CanvasWorkflowSuggestionStatus = "pending" | "accepted" | "ignored";

export type CanvasWorkflowRole = {
  id: string;
  label: string;
  prompt: string;
};

export type CanvasWorkflow = {
  projectId: string;
  stage: CanvasWorkflowStage;
  stages: CanvasWorkflowStage[];
  roles: CanvasWorkflowRole[];
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
  metadata: unknown;
  includeInProjectContext: boolean;
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

export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type PlanClarification = {
  question: string;
  options: Array<{ id: string; label: string; description: string; recommended: boolean }>;
  status: "pending" | "answered";
  selectedOptionId?: string;
  customAnswer?: string;
};
export type PlanRun = {
  id: string; projectId: string; threadId: string; title: string; goal: string;
  status: "draft" | "awaiting_approval" | "running" | "paused" | "awaiting_user" | "completed" | "failed" | "cancelled";
  approval: "pending" | "approved" | "rejected"; statusMessage: string;
  canvasNodeId?: string; currentStepId?: string; executionVersion: number;
  clarification?: PlanClarification;
  steps: Array<{ id: string; title: string; detail: string; status: PlanStepStatus; attempt: number; error?: string }>;
  artifacts: Array<{ id: string; stepId: string; type: "text" | "image"; status: "staged" | "committing" | "committed" | "failed"; title: string; canvasTargetId?: string; error?: string }>;
  links: Array<{ id: string; fromArtifactId: string; toArtifactId: string; label: string; canvasEdgeId?: string }>;
  createdAt: string; updatedAt: string;
};
export type PlanActivity = {
  id: string; threadId: string; planRunId: string; runId?: string; stepId?: string;
  type: "intent_recognized" | "clarification_preparing" | "clarification_ready" | "plan_preparing" | "plan_ready" | "step_started" | "tool_started" | "tool_completed" | "artifact_committed" | "step_completed" | "plan_paused" | "plan_resumed" | "plan_failed" | "plan_completed";
  status: string; summary: string; sequence: number; createdAt: string;
};

import type { CanvasObject } from "../../../shared/canvasObjects";
export type { CanvasObject, CanvasObjectKind } from "../../../shared/canvasObjects";

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

export type StoredMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  usedMock: boolean;
  createdAt: string;
};

export type ThreadStateResponse = {
  thread: StoredThread;
  project?: ProjectSummary;
  messages: StoredMessage[];
  projectBrief: StoredBrief<ProjectBrief>;
  taskBrief: StoredBrief<TaskBrief>;
  outputVersions: StoredOutputVersion[];
  toolEvents: StoredToolEvent[];
  canvasNodes?: CanvasNode[];
  canvasEdges?: CanvasEdge[];
  canvasObjects?: CanvasObject[];
  canvasWriteRequests?: CanvasWriteRequest[];
  canvasWriteSuggestions?: CanvasWriteSuggestion[];
  canvasWorkflow?: CanvasWorkflow;
  canvasWorkflowSuggestions?: CanvasWorkflowSuggestion[];
  plans?: PlanRun[];
  planActivities?: PlanActivity[];
};
