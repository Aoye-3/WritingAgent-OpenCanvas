import type { Locale } from "../i18n/types";

export type AgentCategory = "writing" | "education" | "summarise" | "rewrite";
export type AgentIcon = "pen" | "lines" | "mail" | "book" | "report" | "refresh";
export type AgentAccent = "blue" | "green" | "orange" | "violet" | "rose";
export type ToolRef = "web_search" | "knowledge_base" | "quick_messages" | "clear_context" | "canvas_write";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolGroup = "web" | "context" | "chat";
export type AgentModelResponseMode = "normal" | "prefix_completion";

export type AgentCardField = {
  id: string;
  kind: "text" | "textarea" | "select" | "chips" | "segmented";
  label: Record<Locale, string>;
  options?: string[];
  placeholder: Record<Locale, string>;
  required?: boolean;
};

export type AgentValues = Record<string, string | string[]>;

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
  defaultValues: AgentValues;
  fields: AgentCardField[];
  settings?: AgentSettings;
};

export type AgentSettings = {
  model: {
    providerId: "deepseek" | "openai" | "openai-compatible";
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
  };
  memory: {
    enabled: boolean;
  };
  quickMessages: string[];
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
  id: AgentSettings["model"]["providerId"];
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
  providerProfile: ProviderProfile;
};

export type ThreadCreateResponse = {
  threadId: string;
  agentCardId: string;
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

export type StoredOutputVersion = {
  id: string;
  threadId: string;
  runId: string;
  content: string;
  mode: "structured" | "chat";
  provider: "deepseek" | "openai" | "openai-compatible" | "mock";
  usedMock: boolean;
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

export type CanvasNodeKind = "document" | "note" | "reference";
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
  metadata: unknown;
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
  messages: StoredMessage[];
  structuredValues?: AgentValues;
  outputVersions: StoredOutputVersion[];
  toolEvents: StoredToolEvent[];
  canvasNodes?: CanvasNode[];
  canvasWriteRequests?: CanvasWriteRequest[];
};
