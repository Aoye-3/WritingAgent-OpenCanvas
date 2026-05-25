import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { StreamStatus } from "../../agentRunLoop.js";
import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { KnowledgeService } from "../../knowledge/service.js";
import type { AgentRuntimePort } from "../../runtime/agentRuntimePort.js";
import type { AgentRuntimeMemoryService } from "../agentRuntimeMemoryService.js";
import { createAgentBackendRuntimePort } from "../../runtime/agentBackendAdapter/index.js";
import { randomThreadId, safeId } from "../../utils/ids.js";
import type { AgentBackendRunnerDeps } from "./agentBackendRunner.js";
import { runAgentRuntimeGeneration } from "./agentRuntimeRunner.js";
import { mockText } from "./mockFallback.js";
import { normalizeAgentRunOutput } from "./outputNormalizer.js";
import { buildGenerationRunContext } from "./promptRunBuilder.js";
import { createProgressiveTextGate } from "./progressiveTextGate.js";
import { runProviderGeneration, runProviderGenerationStream, type ProviderRunnerDeps } from "./providerRunner.js";
import { recordGenerationRun } from "./runRecorder.js";

export type GenerationService = {
  generateAndRecord: (payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void) => Promise<GenerateResponse>;
  generateAndRecordStream: (
    payload: GenerateRequest,
    callbacks?: {
      onToken?: (token: string) => void;
      onStatus?: (status: StreamStatus) => void;
      onToolEvent?: (event: ToolEventRecord) => void;
    }
  ) => Promise<GenerateResponse>;
};

export type GenerationServiceDeps = {
  agentRuntime?: AgentRuntimePort;
  /** Compatibility hook for older tests and callers during the Agent Runtime port migration. */
  agentBackend?: AgentBackendRunnerDeps;
  provider?: ProviderRunnerDeps;
  knowledge?: KnowledgeService;
  memory?: AgentRuntimeMemoryService;
};

const streamLabels = {
  thinking: "Thinking...",
  finalizing: "Finalizing..."
} as const;

export function createGenerationService(
  storage: SQLiteStorageRepository,
  agentRuntime: AgentRuntimeAdapter,
  deps: GenerationServiceDeps = {}
): GenerationService {
  const executionRuntime = deps.agentRuntime ?? (deps.agentBackend ? createAgentBackendRuntimePort(deps.agentBackend) : undefined);

  async function generateAndRecord(payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge);
    const agentCard = context.runtimeConfig.agentCard;
    await storage.ensureThread(threadId, agentCard.id);
    const facetwriteMemoryContent = context.runtimeConfig.settings.memory.enabled ? (await deps.memory?.readMemory())?.content : undefined;
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];

    try {
      const agentBackendRun = await runAgentRuntimeGeneration({
        payload,
        threadId,
        runtimeConfig: context.runtimeConfig,
        messages: context.messages,
        prompt: context.prompt,
        facetwriteMemoryContent,
        onToolEvent
      }, executionRuntime);

      if (agentBackendRun) {
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        if (hasBlockedInternalOutput(normalized.events)) {
          const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"));
          runtimeEvents.push(...(normalized.events ?? []), event);
          onToolEvent?.(event);
        } else {
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
            provider: "agent-backend",
            usedMock: false,
            toolState: context.effectiveToolState,
            events,
            finishReason: agentBackendRun.finishReason,
            usage: agentBackendRun.usage
          });
        }
      }
    } catch (error) {
      const event = createRuntimeFallbackEvent("agent-backend", error);
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
        knowledgeService: deps.knowledge,
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

  async function generateAndRecordStream(
    payload: GenerateRequest,
    callbacks: {
      onToken?: (token: string) => void;
      onStatus?: (status: StreamStatus) => void;
      onToolEvent?: (event: ToolEventRecord) => void;
    } = {}
  ): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge);
    const agentCard = context.runtimeConfig.agentCard;
    await storage.ensureThread(threadId, agentCard.id);
    const facetwriteMemoryContent = context.runtimeConfig.settings.memory.enabled ? (await deps.memory?.readMemory())?.content : undefined;
    const textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];

    callbacks.onStatus?.({ phase: "thinking", label: streamLabels.thinking });

    try {
      const agentBackendRun = await runAgentRuntimeGeneration({
        payload,
        threadId,
        runtimeConfig: context.runtimeConfig,
        messages: context.messages,
        prompt: context.prompt,
        facetwriteMemoryContent,
        onToolEvent: callbacks.onToolEvent,
        onToken: textGate.push,
        onStatus: callbacks.onStatus
      }, executionRuntime);

      if (agentBackendRun) {
        textGate.flush();
        callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        if (hasBlockedInternalOutput(normalized.events)) {
          const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"));
          runtimeEvents.push(...(normalized.events ?? []), event);
          callbacks.onToolEvent?.(event);
        } else {
          const events = maybeCreateCanvasWriteRequest({
            storage,
            payload,
            threadId,
            agentTitle: agentCard.title[payload.locale],
            text: normalized.text,
            events: [...runtimeEvents, ...(normalized.events ?? [])],
            onToolEvent: callbacks.onToolEvent
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
            provider: "agent-backend",
            usedMock: false,
            toolState: context.effectiveToolState,
            events,
            finishReason: agentBackendRun.finishReason,
            usage: agentBackendRun.usage
          });
        }
      }
    } catch (error) {
      const event = createRuntimeFallbackEvent("agent-backend", error);
      runtimeEvents.push(event);
      callbacks.onToolEvent?.(event);
    }

    try {
      const providerRun = await runProviderGenerationStream({
        payload,
        threadId,
        agentCard,
        providerId: context.providerId,
        modelSettings: context.modelSettings,
        messages: context.messages,
        effectiveToolState: context.effectiveToolState,
        storage,
        knowledgeService: deps.knowledge,
        onToolEvent: callbacks.onToolEvent,
        onToken: textGate.push,
        onStatus: callbacks.onStatus
      }, deps.provider);

      textGate.flush();
      callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
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
        onToolEvent: callbacks.onToolEvent
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
      const text = mockText(payload);
      textGate.push(text);
      textGate.flush();
      return recordGenerationRun({
        storage,
        payload,
        threadId,
        agentCardId: agentCard.id,
        agentTitle: agentCard.title[payload.locale],
        mode: context.mode,
        prompt: context.prompt,
        text,
        provider: "mock",
        usedMock: true,
        errorMessage: formatGenerationFailure(runtimeEvents, message),
        toolState: context.effectiveToolState,
        events: runtimeEvents,
        finishReason: "mock_fallback"
      });
    }
  }

  return { generateAndRecord, generateAndRecordStream };
}

function hasBlockedInternalOutput(events?: ToolEventRecord[]) {
  return events?.some((event) => event.eventType === "internal_output_blocked") ?? false;
}

function createRuntimeFallbackEvent(source: "agent-backend", error: unknown): ToolEventRecord {
  return {
    eventType: "agent_backend_runtime_failed",
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
  const agentBackendMessage = runtimeEvents.find((event) => event.eventType === "agent_backend_runtime_failed")?.payload?.message;
  if (typeof agentBackendMessage === "string") {
    return `AgentBackend failed: ${agentBackendMessage}; Provider failed: ${providerMessage}`;
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

  const operation = input.payload.selectedCanvasNodeId ? "append" : "create";
  const request = input.storage.createCanvasWriteRequest(input.threadId, {
    operation,
    ...(input.payload.selectedCanvasNodeId ? { targetNodeId: input.payload.selectedCanvasNodeId } : {}),
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
  const intentKeywords = [
    "canvas",
    "画板",
    "写入",
    "存到画板",
    "保存到画板",
    "加入",
    "添加到",
    "放到",
    "save to canvas",
    "write this",
    "write to canvas",
    "add to canvas"
  ];
  return intentKeywords.some((keyword) => instruction.includes(keyword)) ||
    /save\s+to\s+canvas|write\s+this|write\s+to\s+canvas|add\s+to\s+canvas/.test(instruction);
}
