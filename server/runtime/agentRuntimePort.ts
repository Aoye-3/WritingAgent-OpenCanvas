import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { StreamStatus } from "../agentRunLoop.js";
import type { AgentRuntimeConfig } from "../services/agentDefinitionService.js";
import type { GenerateRequest } from "../contracts/generation.js";
import type { ChatMessage } from "../providerRuntime.js";
import type { ToolEventRecord } from "../toolRuntime.js";

export type AgentRuntimeRunInput = {
  payload: GenerateRequest;
  threadId: string;
  runtimeConfig: AgentRuntimeConfig;
  messages: ChatMessage[];
  prompt: string;
  facetwriteMemoryContent?: string;
  onToolEvent?: (event: ToolEventRecord) => void;
  onToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
};

export type AgentRuntimeRunResult = {
  text: string;
  finishReason: string;
  usage?: unknown;
  events: ToolEventRecord[];
};

export type AgentRuntimePort = {
  providerId: "agent-backend";
  run: (input: AgentRuntimeRunInput) => Promise<AgentRuntimeRunResult | undefined>;
  getStatus: () => Promise<unknown>;
  getConfigOverview: () => Promise<unknown>;
  getDashboard: (input: { agentRuntime: AgentRuntimeAdapter }) => Promise<unknown>;
};
