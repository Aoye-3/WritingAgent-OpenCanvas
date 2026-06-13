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
      canvasAction: input.payload.canvasAction,
      knowledgeService: input.knowledgeService,
      createCanvasWriteRequest: (writeInput) => input.storage.createCanvasWriteRequest(projectIdForThread(input), writeInput),
      commitCanvasWrite: (writeInput) => commitLowRiskCanvasWrite(input.storage, projectIdForThread(input), writeInput, input.payload.canvasAction?.id)
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
      canvasAction: input.payload.canvasAction,
      knowledgeService: input.knowledgeService,
      createCanvasWriteRequest: (writeInput) => input.storage.createCanvasWriteRequest(projectIdForThread(input), writeInput),
      commitCanvasWrite: (writeInput) => commitLowRiskCanvasWrite(input.storage, projectIdForThread(input), writeInput, input.payload.canvasAction?.id)
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

function commitLowRiskCanvasWrite(storage: ProviderRunnerInput["storage"], projectId: string, input: import("../../storage.js").CanvasWriteRequestInput, actionId?: string) {
  if (input.operation === "create") {
    const stableId = actionId ? `node_${actionId.replace(/[^A-Za-z0-9_-]/g, "_")}` : undefined;
    const existing = stableId ? storage.listCanvasNodes(projectId).find((node) => node.id === stableId) : undefined;
    return existing ?? storage.createCanvasNode(projectId, { id: stableId, kind: input.nodeKind ?? "document", title: input.title, content: input.content });
  }
  if (input.operation === "append" && input.targetNodeId) {
    const existing = storage.listCanvasNodes(projectId).find((node) => node.id === input.targetNodeId);
    const updated = existing && storage.updateCanvasNode(projectId, existing.id, { content: existing.content ? `${existing.content}\n\n${input.content}` : input.content });
    if (updated) return updated;
  }
  throw new Error("Only create and append Canvas operations can be committed without approval");
}

function projectIdForThread(input: ProviderRunnerInput) {
  const projectId = input.storage.getThread(input.threadId)?.projectId;
  if (!projectId) throw new Error("Thread not found");
  return projectId;
}
