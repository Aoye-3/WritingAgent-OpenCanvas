import type { AgentRuntimeConfig } from "../agentDefinitionService.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "../../runtime/agentBackendAdapter/config.js";
import { runAgentBackendAgent } from "../../runtime/agentBackendAdapter/client.js";
import type { ChatMessage } from "../../providerRuntime.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { StreamStatus } from "../../agentRunLoop.js";

export type AgentBackendRunnerInput = {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  configuredModelApiId: string;
  runtimeConfig: AgentRuntimeConfig;
  messages: ChatMessage[];
  prompt: string;
  facetwriteMemoryContent?: string;
  onToolEvent?: (event: ToolEventRecord) => void;
  onToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
};

export type AgentBackendRunnerDeps = {
  getRuntimeConfig?: () => AgentBackendRuntimeConfig;
  runAgent?: typeof runAgentBackendAgent;
};

export async function runAgentBackendGeneration(input: AgentBackendRunnerInput, deps: AgentBackendRunnerDeps = {}) {
  const config = (deps.getRuntimeConfig ?? getAgentBackendRuntimeConfig)();
  if (!config.enabled) return undefined;

  const run = await (deps.runAgent ?? runAgentBackendAgent)({
    config,
    threadId: input.threadId,
    projectId: input.projectId,
    configuredModelApiId: input.configuredModelApiId,
    agentCard: input.runtimeConfig.agentCard,
    settings: input.runtimeConfig.settings,
    messages: input.messages,
    prompt: input.prompt,
    facetwriteMemoryContent: input.facetwriteMemoryContent,
    allowedToolRefs: allowedToolsForRequest(input),
    toolState: input.payload.toolState,
    selectedCanvasNodeId: input.payload.selectedCanvasNodeId,
    contextValues: input.payload.contextValues,
    chatInstruction: input.payload.chatInstruction ?? input.payload.freeTextPrompt,
    onToolEvent: input.onToolEvent,
    onToken: input.onToken,
    onStatus: input.onStatus
  });

  if (!run.text && !run.events.some((event) => /(?:^|_)(?:plan|artifact)_/.test(event.eventType))) {
    throw new Error("AgentBackend completed with no visible assistant text or structured Plan events");
  }

  return run;
}

function allowedToolsForRequest(input: AgentBackendRunnerInput) {
  const allowed = new Set(input.runtimeConfig.enabledTools);
  if (input.payload.toolState?.plan_update) allowed.add("plan_update");
  if (input.payload.toolState?.artifact_stage) allowed.add("artifact_stage");
  return [...allowed];
}
