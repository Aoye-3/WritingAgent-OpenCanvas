import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import { getSystemPrompt } from "../../config/providerConfig.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { buildAgentPrompt } from "../../promptBuilder.js";
import type { ChatMessage } from "../../providerRuntime.js";
import { loadSkillsByRefs } from "../../skillLoader.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolState } from "../../toolRegistry.js";
import type { ProviderId } from "../../types.js";
import type { KnowledgeService } from "../../knowledge/service.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { isChatMode } from "./mockFallback.js";
import type { ConfiguredModelApi } from "../../domains/model-config/index.js";
import { shouldExcludeFromModelContext } from "./outputNormalizer.js";

export type GenerateModelSettings = NonNullable<ReturnType<AgentRuntimeAdapter["resolveAgentCard"]>["settings"]>["model"];

export type GenerationRunContext = {
  runtimeConfig: Awaited<ReturnType<AgentRuntimeAdapter["getAgentRuntimeConfig"]>>;
  prompt: string;
  modelSettings: GenerateModelSettings;
  providerId: ProviderId;
  mode: "structured" | "chat";
  messages: ChatMessage[];
  effectiveToolState: ToolState;
  knowledgeEvents: ToolEventRecord[];
};

export async function buildGenerationRunContext(
  payload: GenerateRequest,
  threadId: string,
  storage: SQLiteStorageRepository,
  agentRuntime: AgentRuntimeAdapter,
  knowledgeService?: KnowledgeService,
  configuredModel?: ConfiguredModelApi
): Promise<GenerationRunContext> {
  const runtimeConfig = await agentRuntime.getAgentRuntimeConfig(payload.agentCardId ?? payload.taskId ?? "");
  const agentCard = runtimeConfig.agentCard;
  const thread = storage.getThread?.(threadId);
  const projectContext = thread ? storage.getProjectSharedContext?.(thread.projectId) : undefined;
  const effectivePayload = projectContext
    ? { ...payload, contextValues: { project: projectContext, ...payload.contextValues } }
    : payload;
  const effectiveToolState: ToolState = { ...runtimeConfig.settings.tools, ...payload.toolState };
  const skills = await loadSkillsByRefs(agentCard.skillRefs);
  const prompt = buildAgentPrompt({
    agentCard,
    skills,
    locale: payload.locale,
    structuredValues: effectivePayload.structuredValues ?? effectivePayload.formValues,
    contextValues: effectivePayload.contextValues,
    chatInstruction: payload.chatInstruction,
    freeTextPrompt: payload.freeTextPrompt,
    toolState: effectiveToolState
  });
  const modelSettings = await resolveModelSettings(runtimeConfig.settings.model, configuredModel, payload.modelOverrides);
  const userPrompt = userPromptForModel(payload, agentCard.outputContract.type);
  const knowledge = await buildKnowledgeContext({
    knowledgeService,
    enabled: Boolean(runtimeConfig.settings.knowledge.enabled && effectiveToolState.knowledge_base),
    query: userPrompt,
    baseIds: runtimeConfig.settings.knowledge.baseIds,
    documentCount: runtimeConfig.settings.knowledge.documentCount,
    threshold: runtimeConfig.settings.knowledge.threshold
  });
  const messages = buildChatMessages(storage, {
    systemPrompt: buildSystemPrompt(payload.systemPrompt?.trim() || getSystemPrompt(payload.locale), prompt),
    userPrompt,
    prompt,
    knowledgeContext: knowledge.context,
    threadId,
    contextCount: modelSettings.contextCount,
    clearContext: Boolean(effectiveToolState.clear_context)
  });

  return {
    runtimeConfig,
    prompt,
    modelSettings,
    providerId: modelSettings.providerId,
    mode: isChatMode(payload.mode) ? "chat" : "structured",
    messages,
    effectiveToolState,
    knowledgeEvents: knowledge.events
  };
}

export async function resolveModelSettings(
  settings: GenerateModelSettings | undefined,
  configured?: ConfiguredModelApi,
  modelOverrides?: GenerateRequest["modelOverrides"]
): Promise<GenerateModelSettings> {
  if (!configured?.enabled || !configured.apiKey?.trim()) {
    throw new Error("Please select an enabled project model with a configured API key before generating.");
  }
  return {
    configuredModelApiId: configured.id,
    providerId: configured.providerId,
    model: configured.modelId,
    temperature: settings?.temperature ?? 0.7,
    topP: settings?.topP ?? 1,
    contextCount: settings?.contextCount ?? 5,
    maxTokens: settings?.maxTokens ?? 2000,
    maxTokensEnabled: settings?.maxTokensEnabled ?? false,
    streaming: settings?.streaming ?? true,
    toolCallMode: settings?.toolCallMode ?? "auto",
    maxToolCalls: settings?.maxToolCalls ?? 20,
    thinkingMode: modelOverrides?.thinkingMode ?? settings?.thinkingMode,
    reasoningEffort: modelOverrides?.reasoningEffort ?? settings?.reasoningEffort,
    responseMode: settings?.responseMode ?? "normal"
  };
}

export function buildChatMessages(
  storage: Pick<SQLiteStorageRepository, "listMessages">,
  input: {
    systemPrompt: string;
    userPrompt?: string;
    prompt: string;
    knowledgeContext?: string;
    threadId: string;
    contextCount: number;
    clearContext: boolean;
  }
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: input.systemPrompt }];
  if (!input.clearContext && input.contextCount > 0) {
    const history = storage.listMessages(input.threadId)
      .filter((message) => !shouldExcludeFromModelContext(message.text))
      .slice(-input.contextCount);
    for (const message of history) {
    messages.push({ role: message.role, content: message.text });
    }
  }
  const userContent = [input.knowledgeContext, input.userPrompt?.trim() || input.prompt].filter(Boolean).join("\n\n");
  messages.push({ role: "user", content: userContent });
  return messages;
}

function buildSystemPrompt(systemPrompt: string, internalPrompt: string) {
  return [
    systemPrompt,
    "Use the following FacetWrite runtime context to guide the response. This context is private implementation detail: never quote, reveal, or reproduce headings such as AgentCard, Loaded Skills, Current User Instruction, Context, Enabled Tool State, or Output Contract in the final answer.",
    internalPrompt
  ].filter(Boolean).join("\n\n");
}

function userPromptForModel(payload: GenerateRequest, outputType: string) {
  const instruction = payload.chatInstruction?.trim() || payload.freeTextPrompt?.trim();
  if (instruction) return instruction;
  return `Generate the requested ${outputType} from the current AgentCard structured inputs.`;
}

async function buildKnowledgeContext(input: {
  knowledgeService?: KnowledgeService;
  enabled: boolean;
  query: string;
  baseIds?: string[];
  documentCount?: number;
  threshold?: number;
}): Promise<{ context?: string; events: ToolEventRecord[] }> {
  if (!input.knowledgeService || !input.enabled) return { events: [] };
  try {
    const results = await input.knowledgeService.search({
      query: input.query,
      baseIds: input.baseIds,
      limit: input.documentCount,
      threshold: input.threshold
    });
    if (results.length === 0) return { events: [] };
    return {
      context: [
        "Knowledge References:",
        ...results.map((result) => `[${result.id}] ${result.title} (${result.source}, score ${result.score.toFixed(3)})\n${result.content}`)
      ].join("\n\n"),
      events: [{
        eventType: "knowledge_search_completed",
        payload: {
          resultCount: results.length,
          sources: results.map((result) => ({
            id: result.id,
            baseId: result.baseId,
            title: result.title,
            source: result.source,
            score: result.score
          }))
        }
      }]
    };
  } catch (error) {
    return {
      events: [{
        eventType: "knowledge_search_failed",
        payload: {
          message: error instanceof Error ? error.message.slice(0, 240) : "Knowledge search failed"
        }
      }]
    };
  }
}

export function userMessageForRun(payload: GenerateRequest, agentTitle: string) {
  if (isChatMode(payload.mode)) {
    return payload.chatInstruction ?? payload.freeTextPrompt;
  }

  return `Structured generation with ${agentTitle}`;
}
