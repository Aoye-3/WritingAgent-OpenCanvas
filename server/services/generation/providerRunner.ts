import { runAgentCompletion, runAgentCompletionStream, type StreamStatus } from "../../agentRunLoop.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { createOpenAIChatClient, getProviderProfile, type ChatMessage, type ChatClient } from "../../providerRuntime.js";
import { resolveConfiguredModelApi, resolveProviderApiConfig } from "../../domains/model-config/index.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { ToolState } from "../../toolRegistry.js";
import type { ProviderId } from "../../types.js";
import type { KnowledgeService } from "../../knowledge/service.js";
import { safeId } from "../../utils/ids.js";
import type { GenerateModelSettings } from "./promptRunBuilder.js";
import type { AgentCard } from "../../agentCards.js";

export type ProviderRunnerInput = {
  payload: GenerateRequest;
  threadId: string;
  agentCard: AgentCard;
  providerId: ProviderId;
  modelSettings: GenerateModelSettings;
  messages: ChatMessage[];
  effectiveToolState: ToolState;
  storage: SQLiteStorageRepository;
  knowledgeService?: KnowledgeService;
  onToolEvent?: (event: ToolEventRecord) => void;
};

export type ProviderRunnerDeps = {
  apiKey?: string;
  baseURL?: string;
  createClient?: typeof createOpenAIChatClient;
  runAgent?: typeof runAgentCompletion;
  runAgentStream?: typeof runAgentCompletionStream;
};

export async function runProviderGeneration(input: ProviderRunnerInput, deps: ProviderRunnerDeps = {}) {
  const config = input.modelSettings.configuredModelApiId
    ? await resolveConfiguredModelApi(input.modelSettings.configuredModelApiId)
    : await resolveProviderApiConfig(input.providerId);
  const apiKey = deps.apiKey ?? config.apiKey;
  if (!apiKey) {
    throw new Error(`${getProviderProfile(input.providerId).label} API key is not configured. Open Model Config and save this provider's API key.`);
  }
  const baseURL = deps.baseURL ?? config.baseURL;

  const run = await (deps.runAgent ?? runAgentCompletion)({
    client: (deps.createClient ?? createOpenAIChatClient)({ apiKey, baseURL }) as ChatClient,
    providerId: input.providerId,
    modelSettings: input.modelSettings,
    messages: input.messages,
    allowedToolRefs: input.agentCard.toolRefs,
    toolState: input.effectiveToolState,
    toolContext: {
      threadId: input.threadId,
      allowedToolRefs: input.agentCard.toolRefs,
      toolState: input.effectiveToolState,
      selectedCanvasNodeId: safeId(input.payload.selectedCanvasNodeId),
      contextValues: input.payload.contextValues,
      chatInstruction: input.payload.chatInstruction ?? input.payload.freeTextPrompt,
      knowledgeService: input.knowledgeService,
      createCanvasWriteRequest: (writeInput) => input.storage.createCanvasWriteRequest(input.threadId, writeInput)
    },
    onToolEvent: input.onToolEvent
  });

  if (!run.text) {
    throw new Error(`${getProviderProfile(input.providerId).label} returned an empty response`);
  }

  return run;
}

export async function runProviderGenerationStream(
  input: ProviderRunnerInput & {
    onToken?: (token: string) => void;
    onStatus?: (status: StreamStatus) => void;
  },
  deps: ProviderRunnerDeps = {}
) {
  const config = input.modelSettings.configuredModelApiId
    ? await resolveConfiguredModelApi(input.modelSettings.configuredModelApiId)
    : await resolveProviderApiConfig(input.providerId);
  const apiKey = deps.apiKey ?? config.apiKey;
  if (!apiKey) {
    throw new Error(`${getProviderProfile(input.providerId).label} API key is not configured. Open Model Config and save this provider's API key.`);
  }
  const baseURL = deps.baseURL ?? config.baseURL;

  const run = await (deps.runAgentStream ?? runAgentCompletionStream)({
    client: (deps.createClient ?? createOpenAIChatClient)({ apiKey, baseURL }) as ChatClient,
    providerId: input.providerId,
    modelSettings: input.modelSettings,
    messages: input.messages,
    allowedToolRefs: input.agentCard.toolRefs,
    toolState: input.effectiveToolState,
    toolContext: {
      threadId: input.threadId,
      allowedToolRefs: input.agentCard.toolRefs,
      toolState: input.effectiveToolState,
      selectedCanvasNodeId: safeId(input.payload.selectedCanvasNodeId),
      contextValues: input.payload.contextValues,
      chatInstruction: input.payload.chatInstruction ?? input.payload.freeTextPrompt,
      knowledgeService: input.knowledgeService,
      createCanvasWriteRequest: (writeInput) => input.storage.createCanvasWriteRequest(input.threadId, writeInput)
    },
    onToolEvent: input.onToolEvent,
    onToken: input.onToken,
    onStatus: input.onStatus
  });

  if (!run.text) {
    throw new Error(`${getProviderProfile(input.providerId).label} returned an empty response`);
  }

  return run;
}
