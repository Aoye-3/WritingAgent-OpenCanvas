import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { randomThreadId, safeId } from "../../utils/ids.js";
import { runDeerFlowGeneration, type DeerFlowRunnerDeps } from "./deerflowRunner.js";
import { mockText } from "./mockFallback.js";
import { buildGenerationRunContext } from "./promptRunBuilder.js";
import { runProviderGeneration, type ProviderRunnerDeps } from "./providerRunner.js";
import { recordGenerationRun } from "./runRecorder.js";

export type GenerationService = {
  generateAndRecord: (payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void) => Promise<GenerateResponse>;
};

export type GenerationServiceDeps = {
  deerflow?: DeerFlowRunnerDeps;
  provider?: ProviderRunnerDeps;
};

export function createGenerationService(
  storage: SQLiteStorageRepository,
  agentRuntime: AgentRuntimeAdapter,
  deps: GenerationServiceDeps = {}
): GenerationService {
  async function generateAndRecord(payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime);
    const agentCard = context.runtimeConfig.agentCard;
    await storage.ensureThread(threadId, agentCard.id);

    try {
      const deerFlowRun = await runDeerFlowGeneration({
        payload,
        threadId,
        runtimeConfig: context.runtimeConfig,
        messages: context.messages,
        prompt: context.prompt,
        onToolEvent
      }, deps.deerflow);

      if (deerFlowRun) {
        return recordGenerationRun({
          storage,
          payload,
          threadId,
          agentCardId: agentCard.id,
          agentTitle: agentCard.title[payload.locale],
          mode: context.mode,
          prompt: context.prompt,
          text: deerFlowRun.text,
          provider: "deerflow",
          usedMock: false,
          toolState: context.effectiveToolState,
          events: deerFlowRun.events,
          finishReason: deerFlowRun.finishReason,
          usage: deerFlowRun.usage
        });
      }

      const providerRun = await runProviderGeneration({
        payload,
        threadId,
        agentCard,
        providerId: context.providerId,
        modelSettings: context.modelSettings,
        messages: context.messages,
        effectiveToolState: context.effectiveToolState,
        storage,
        onToolEvent
      }, deps.provider);

      return recordGenerationRun({
        storage,
        payload,
        threadId,
        agentCardId: agentCard.id,
        agentTitle: agentCard.title[payload.locale],
        mode: context.mode,
        prompt: context.prompt,
        text: providerRun.text,
        provider: context.providerId,
        usedMock: false,
        toolState: context.effectiveToolState,
        events: providerRun.events,
        finishReason: providerRun.finishReason,
        usage: providerRun.usage
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown generation error";
      return recordGenerationRun({
        storage,
        payload,
        threadId,
        agentCardId: agentCard.id,
        agentTitle: agentCard.title[payload.locale],
        mode: context.mode,
        prompt: context.prompt,
        text: mockText(payload),
        provider: "mock",
        usedMock: true,
        errorMessage: message,
        toolState: context.effectiveToolState,
        finishReason: "mock_fallback"
      });
    }
  }

  return { generateAndRecord };
}
