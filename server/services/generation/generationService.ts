import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { randomThreadId, safeId } from "../../utils/ids.js";
import { runDeerFlowGeneration, type DeerFlowRunnerDeps } from "./deerflowRunner.js";
import { mockText } from "./mockFallback.js";
import { normalizeAgentRunOutput } from "./outputNormalizer.js";
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

    const runtimeEvents: ToolEventRecord[] = [];

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
        const normalized = normalizeAgentRunOutput({
          text: deerFlowRun.text,
          locale: payload.locale,
          source: "deerflow",
          events: deerFlowRun.events
        });
        if (hasBlockedInternalOutput(normalized.events)) {
          const event = createRuntimeFallbackEvent("deerflow", new Error("DeerFlow returned internal runtime output"));
          runtimeEvents.push(...(normalized.events ?? []), event);
          onToolEvent?.(event);
        } else {
          const events = maybeCreateCanvasWriteRequest({
            storage,
            payload,
            threadId,
            agentTitle: agentCard.title[payload.locale],
            text: normalized.text,
            events: normalized.events,
            onToolEvent
          });
          return recordGenerationRun({
            storage,
            payload,
            threadId,
            agentCardId: agentCard.id,
            agentTitle: agentCard.title[payload.locale],
            mode: context.mode,
            prompt: context.prompt,
            text: normalized.text,
            provider: "deerflow",
            usedMock: false,
            toolState: context.effectiveToolState,
            events,
            finishReason: deerFlowRun.finishReason,
            usage: deerFlowRun.usage
          });
        }
      }
    } catch (error) {
      const event = createRuntimeFallbackEvent("deerflow", error);
      runtimeEvents.push(event);
      onToolEvent?.(event);
    }

    try {
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

      const normalized = normalizeAgentRunOutput({
        text: providerRun.text,
        locale: payload.locale,
        source: context.providerId,
        events: providerRun.events
      });

      const events = maybeCreateCanvasWriteRequest({
        storage,
        payload,
        threadId,
        agentTitle: agentCard.title[payload.locale],
        text: normalized.text,
        events: [...runtimeEvents, ...(normalized.events ?? [])],
        onToolEvent
      });

      return recordGenerationRun({
        storage,
        payload,
        threadId,
        agentCardId: agentCard.id,
        agentTitle: agentCard.title[payload.locale],
        mode: context.mode,
        prompt: context.prompt,
        text: normalized.text,
        provider: context.providerId,
        usedMock: false,
        toolState: context.effectiveToolState,
        events,
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
        errorMessage: formatGenerationFailure(runtimeEvents, message),
        toolState: context.effectiveToolState,
        events: runtimeEvents,
        finishReason: "mock_fallback"
      });
    }
  }

  return { generateAndRecord };
}

function hasBlockedInternalOutput(events?: ToolEventRecord[]) {
  return events?.some((event) => event.eventType === "internal_output_blocked") ?? false;
}

function createRuntimeFallbackEvent(source: "deerflow", error: unknown): ToolEventRecord {
  return {
    eventType: `${source}_runtime_failed`,
    payload: {
      source,
      message: safeRuntimeErrorMessage(error),
      fallback: "provider"
    }
  };
}

function safeRuntimeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown runtime error";
  if (/api[_-]?key|authorization|token|password|secret/i.test(message)) {
    return "Runtime failed with a credential-related error.";
  }
  return message.slice(0, 240);
}

function formatGenerationFailure(runtimeEvents: ToolEventRecord[], providerMessage: string) {
  const deerflowMessage = runtimeEvents.find((event) => event.eventType === "deerflow_runtime_failed")?.payload?.message;
  if (typeof deerflowMessage === "string") {
    return `DeerFlow failed: ${deerflowMessage}; Provider failed: ${providerMessage}`;
  }
  return providerMessage;
}

function maybeCreateCanvasWriteRequest(input: {
  storage: SQLiteStorageRepository;
  payload: GenerateRequest;
  threadId: string;
  agentTitle: string;
  text: string;
  events?: ToolEventRecord[];
  onToolEvent?: (event: ToolEventRecord) => void;
}) {
  const events = [...(input.events ?? [])];
  if (!input.payload.toolState?.canvas_write) return events;
  if (!hasCanvasWriteIntent(input.payload)) return events;
  if (events.some((event) => event.payload?.tool === "canvas_write" && "requestId" in event.payload)) return events;
  const content = input.text.trim();
  if (!content) return events;

  const request = input.storage.createCanvasWriteRequest(input.threadId, {
    operation: "create",
    nodeKind: "document",
    title: input.agentTitle,
    content,
    rationale: "Requested by the user from the chat instruction."
  });
  const event: ToolEventRecord = {
    eventType: "tool_call_completed",
    payload: {
      tool: "canvas_write",
      requestId: request.id,
      operation: request.operation,
      nodeKind: request.nodeKind,
      title: request.title,
      status: request.status,
      source: "canvas_intent_fallback"
    }
  };
  events.push(event);
  input.onToolEvent?.(event);
  return events;
}

function hasCanvasWriteIntent(payload: GenerateRequest) {
  const instruction = `${payload.chatInstruction ?? ""}\n${payload.freeTextPrompt ?? ""}`.toLowerCase();
  return /canvas|画板|畫板|放到|写入|寫入|添加到|加入/.test(instruction);
}
