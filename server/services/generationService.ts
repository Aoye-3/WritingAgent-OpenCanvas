import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { runAgentCompletion } from "../agentRunLoop.js";
import { getBaseURL, getModel, getProviderId, getSystemPrompt } from "../config/providerConfig.js";
import type { GenerateRequest, GenerateResponse } from "../contracts/generation.js";
import { getDeerFlowRuntimeConfig } from "../deerflow/config.js";
import { runDeerFlowAgent } from "../deerflow/client.js";
import { buildAgentPrompt } from "../promptBuilder.js";
import { createOpenAIChatClient, getProviderProfile, type ChatMessage } from "../providerRuntime.js";
import { loadSkillsByRefs } from "../skillLoader.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import type { ToolState } from "../toolRegistry.js";
import type { ProviderId } from "../types.js";
import { safeId, randomThreadId } from "../utils/ids.js";

export type GenerationService = {
  generateAndRecord: (payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void) => Promise<GenerateResponse>;
};

export function createGenerationService(storage: SQLiteStorageRepository, agentRuntime: AgentRuntimeAdapter): GenerationService {
  async function generateAndRecord(payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void): Promise<GenerateResponse> {
    const runtimeConfig = await agentRuntime.getAgentRuntimeConfig(payload.agentCardId ?? payload.taskId ?? "");
    const agentCard = runtimeConfig.agentCard;
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    await storage.ensureThread(threadId, agentCard.id);
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
    const providerId = modelSettings.providerId;
    const mode = isChatMode(payload.mode) ? "chat" : "structured";
    const messages = buildChatMessages({
      systemPrompt: payload.systemPrompt?.trim() || getSystemPrompt(payload.locale),
      prompt,
      threadId,
      contextCount: modelSettings.contextCount,
      clearContext: Boolean(effectiveToolState.clear_context)
    });

    try {
      const deerFlowConfig = getDeerFlowRuntimeConfig();
      if (deerFlowConfig.enabled) {
        const run = await runDeerFlowAgent({
          config: deerFlowConfig,
          threadId,
          agentCard,
          settings: runtimeConfig.settings,
          messages,
          prompt,
          onToolEvent
        });

        if (!run.text) {
          throw new Error("DeerFlow returned an empty response");
        }

        const saved = storage.recordRun({
          threadId,
          agentCardId: agentCard.id,
          mode,
          prompt,
          output: run.text,
          provider: "deerflow",
          usedMock: false,
          userMessage: userMessageForRun(payload, agentCard.title[payload.locale]),
          toolState: effectiveToolState,
          events: run.events,
          finishReason: run.finishReason,
          usage: run.usage
        });

        return {
          text: run.text,
          prompt,
          provider: "deerflow",
          usedMock: false,
          threadId,
          runId: saved.runId,
          events: run.events,
          finishReason: run.finishReason,
          usage: run.usage
        };
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured");
      }

      const run = await runAgentCompletion({
        client: createOpenAIChatClient({ apiKey, baseURL: getBaseURL(providerId) }),
        providerId,
        modelSettings,
        messages,
        allowedToolRefs: agentCard.toolRefs,
        toolState: effectiveToolState,
        toolContext: {
          threadId,
          selectedCanvasNodeId: safeId(payload.selectedCanvasNodeId),
          contextValues: payload.contextValues,
          chatInstruction: payload.chatInstruction ?? payload.freeTextPrompt,
          createCanvasWriteRequest: (input) => storage.createCanvasWriteRequest(threadId, input)
        },
        onToolEvent
      });

      if (!run.text) {
        throw new Error(`${getProviderProfile(providerId).label} returned an empty response`);
      }

      const saved = storage.recordRun({
        threadId,
        agentCardId: agentCard.id,
        mode,
        prompt,
        output: run.text,
        provider: providerId,
        usedMock: false,
        userMessage: userMessageForRun(payload, agentCard.title[payload.locale]),
        toolState: effectiveToolState,
        events: run.events,
        finishReason: run.finishReason,
        usage: run.usage
      });

      return {
        text: run.text,
        prompt,
        provider: providerId,
        usedMock: false,
        threadId,
        runId: saved.runId,
        events: run.events,
        finishReason: run.finishReason,
        usage: run.usage
      };
    } catch (error) {
      const text = mockText(payload);
      const message = error instanceof Error ? error.message : "Unknown generation error";
      const saved = storage.recordRun({
        threadId,
        agentCardId: agentCard.id,
        mode,
        prompt,
        output: text,
        provider: "mock",
        usedMock: true,
        errorMessage: message,
        userMessage: userMessageForRun(payload, agentCard.title[payload.locale]),
        toolState: effectiveToolState,
        finishReason: "mock_fallback"
      });

      return {
        text,
        prompt,
        provider: "mock",
        usedMock: true,
        threadId,
        runId: saved.runId,
        errorMessage: message,
        finishReason: "mock_fallback"
      };
    }
  }

  function buildChatMessages(input: {
    systemPrompt: string;
    prompt: string;
    threadId: string;
    contextCount: number;
    clearContext: boolean;
  }): ChatMessage[] {
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

  return { generateAndRecord };
}

function resolveModelSettings(settings: GenerateModelSettings | undefined, overrideProviderId?: ProviderId): GenerateModelSettings {
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

type GenerateModelSettings = NonNullable<ReturnType<AgentRuntimeAdapter["resolveAgentCard"]>["settings"]>["model"];

function mockText(payload: GenerateRequest) {
  const instruction = payload.chatInstruction?.trim() || payload.freeTextPrompt?.trim();
  if (payload.locale === "zh") {
    if (isChatMode(payload.mode)) {
      return instruction
        ? `我现在处于 Mock fallback 模式，无法调用真实模型。你刚才说：“${instruction}”。请先检查模型连接，恢复后我会基于右侧对话理解意图，并在需要改画布时发起写入申请。`
        : "我现在处于 Mock fallback 模式，无法调用真实模型。请先检查模型连接。";
    }

    return "气候变化是指地球温度、降雨和天气模式的长期变化。\n\n温室气体会把更多热量留在大气中，而燃烧煤、石油和天然气等人类活动会增加这些气体。\n\n在日常生活中，它可能表现为更炎热的夏天、更强的暴雨、海平面上升，以及农业生产变化。\n\n我们可以通过节约能源、使用更清洁的交通方式和减少浪费来应对。";
  }

  if (isChatMode(payload.mode)) {
    return instruction
      ? `I am in mock fallback mode, so I cannot call the real model yet. You said: "${instruction}". Once the model connection is restored, I will infer intent from this chat and request Canvas writes only when needed.`
      : "I am in mock fallback mode, so I cannot call the real model yet. Please check the model connection.";
  }

  return "Climate change means long-term shifts in temperature, rainfall, and weather patterns across the planet.\n\nGreenhouse gases trap heat in the atmosphere, and human activities add more of these gases by burning coal, oil, and gas.\n\nThe effects can include hotter summers, stronger storms, rising sea levels, and changes to food production.\n\nPeople can respond by saving energy, using cleaner transport, reducing waste, and supporting climate-aware decisions.";
}

function isChatMode(mode: GenerateRequest["mode"]) {
  return mode === "freeText" || mode === "chat";
}

function userMessageForRun(payload: GenerateRequest, agentTitle: string) {
  if (isChatMode(payload.mode)) {
    return payload.chatInstruction ?? payload.freeTextPrompt;
  }

  return `Structured generation with ${agentTitle}`;
}
