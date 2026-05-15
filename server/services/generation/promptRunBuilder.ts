import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import { getModel, getProviderId, getSystemPrompt } from "../../config/providerConfig.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { buildAgentPrompt } from "../../promptBuilder.js";
import type { ChatMessage } from "../../providerRuntime.js";
import { loadSkillsByRefs } from "../../skillLoader.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolState } from "../../toolRegistry.js";
import type { ProviderId } from "../../types.js";
import { isChatMode } from "./mockFallback.js";

export type GenerateModelSettings = NonNullable<ReturnType<AgentRuntimeAdapter["resolveAgentCard"]>["settings"]>["model"];

export type GenerationRunContext = {
  runtimeConfig: Awaited<ReturnType<AgentRuntimeAdapter["getAgentRuntimeConfig"]>>;
  prompt: string;
  modelSettings: GenerateModelSettings;
  providerId: ProviderId;
  mode: "structured" | "chat";
  messages: ChatMessage[];
  effectiveToolState: ToolState;
};

export async function buildGenerationRunContext(
  payload: GenerateRequest,
  threadId: string,
  storage: SQLiteStorageRepository,
  agentRuntime: AgentRuntimeAdapter
): Promise<GenerationRunContext> {
  const runtimeConfig = await agentRuntime.getAgentRuntimeConfig(payload.agentCardId ?? payload.taskId ?? "");
  const agentCard = runtimeConfig.agentCard;
  const effectiveToolState: ToolState = { ...runtimeConfig.settings.tools, ...payload.toolState };
  const skills = await loadSkillsByRefs(agentCard.skillRefs);
  const prompt = buildAgentPrompt({
    agentCard,
    skills,
    locale: payload.locale,
    structuredValues: payload.structuredValues ?? payload.formValues,
    contextValues: payload.contextValues,
    chatInstruction: payload.chatInstruction,
    freeTextPrompt: payload.freeTextPrompt,
    toolState: effectiveToolState
  });
  const modelSettings = resolveModelSettings(runtimeConfig.settings.model, payload.providerId);
  const messages = buildChatMessages(storage, {
    systemPrompt: payload.systemPrompt?.trim() || getSystemPrompt(payload.locale),
    prompt,
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
    effectiveToolState
  };
}

export function resolveModelSettings(settings: GenerateModelSettings | undefined, overrideProviderId?: ProviderId): GenerateModelSettings {
  const providerId = overrideProviderId ?? settings?.providerId ?? getProviderId();
  return {
    providerId,
    model: settings?.model?.trim() || getModel(providerId),
    temperature: settings?.temperature ?? 0.7,
    topP: settings?.topP ?? 1,
    contextCount: settings?.contextCount ?? 5,
    maxTokens: settings?.maxTokens ?? 2000,
    maxTokensEnabled: settings?.maxTokensEnabled ?? false,
    streaming: settings?.streaming ?? true,
    toolCallMode: settings?.toolCallMode ?? "auto",
    maxToolCalls: settings?.maxToolCalls ?? 20,
    thinkingMode: settings?.thinkingMode,
    reasoningEffort: settings?.reasoningEffort,
    responseMode: settings?.responseMode ?? "normal"
  };
}

export function buildChatMessages(
  storage: Pick<SQLiteStorageRepository, "listMessages">,
  input: {
    systemPrompt: string;
    prompt: string;
    threadId: string;
    contextCount: number;
    clearContext: boolean;
  }
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: input.systemPrompt }];
  if (!input.clearContext && input.contextCount > 0) {
    const history = storage.listMessages(input.threadId).slice(-input.contextCount);
    for (const message of history) {
      messages.push({ role: message.role, content: message.text });
    }
  }
  messages.push({ role: "user", content: input.prompt });
  return messages;
}

export function userMessageForRun(payload: GenerateRequest, agentTitle: string) {
  if (isChatMode(payload.mode)) {
    return payload.chatInstruction ?? payload.freeTextPrompt;
  }

  return `Structured generation with ${agentTitle}`;
}
