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
import type { ProviderRunnerDeps } from "./providerRunner.js";
import { recordGenerationRun } from "./runRecorder.js";
import { resolveConfiguredModelApi, type ConfiguredModelApi } from "../../domains/model-config/index.js";
import { isConfiguredModelRuntimeReady } from "../../runtime/agentBackendAdapter/modelSync.js";
import { PlanOrchestrator } from "../planOrchestrator.js";
import { resolveCanvasAction } from "./canvasActionPolicy.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";
import { resolveOrchestrationPolicy } from "./orchestrationPolicy.js";

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
  modelRuntime?: {
    resolveConfiguredModel: (configuredModelApiId: string) => Promise<ConfiguredModelApi>;
    isModelReady: (configuredModelApiId: string) => boolean;
  };
  mockFallbackEnabled?: boolean;
};

export type GenerationErrorCode = "model_required" | "model_not_ready" | "runtime_unavailable" | "runtime_auth_failed";

export class GenerationError extends Error {
  constructor(public code: GenerationErrorCode, message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

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
  const planOrchestrator = new PlanOrchestrator(storage);

  async function generateAndRecord(payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    payload = withOrchestrationPolicy(withCanvasAction(payload, threadId, storage));
    const selection = await prepareThreadModelSelection(payload, threadId, storage, deps.modelRuntime);
    payload = withPlanGeneration(payload, threadId, storage);
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge, selection.configuredModel);
    const agentCard = context.runtimeConfig.agentCard;
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];
    const observeToolEvent = (event: ToolEventRecord) => {
      planOrchestrator.observe(threadId, event);
      onToolEvent?.(event);
    };
    for (const event of canvasActionEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }
    for (const event of planPhaseEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }

    try {
      planOrchestrator.prepare(threadId, payload);
      const agentBackendRun = await runAgentRuntimeGeneration({
        payload: { ...payload, toolState: context.effectiveToolState },
        threadId,
        projectId: selection.projectId,
        configuredModelApiId: context.modelSettings.configuredModelApiId!,
        modelSettings: context.modelSettings,
        runtimeConfig: context.runtimeConfig,
        messages: context.messages,
        prompt: context.prompt,
        onToolEvent: observeToolEvent
      }, executionRuntime);

      if (agentBackendRun) {
        planOrchestrator.assertPostcondition(threadId, payload);
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        if (hasBlockedInternalOutput(normalized.events)) {
          const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"), isMockFallbackEnabled(deps));
          runtimeEvents.push(...(normalized.events ?? []), event);
          observeToolEvent(event);
        } else {
          const events = [...runtimeEvents, ...(normalized.events ?? [])];
          planOrchestrator.complete(threadId, payload);
          const recorded = recordGenerationRun({
            storage,
            payload,
            threadId,
            agentCardId: agentCard.id,
            agentTitle: agentCard.title[payload.locale],
            configuredModelApiId: context.modelSettings.configuredModelApiId,
            modelId: context.modelSettings.model,
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
          return recorded;
        }
      } else {
        const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend is disabled or unavailable"), isMockFallbackEnabled(deps));
        runtimeEvents.push(event);
        observeToolEvent(event);
      }
    } catch (error) {
      planOrchestrator.fail(threadId, payload, error);
      const event = createRuntimeFallbackEvent("agent-backend", error, isMockFallbackEnabled(deps));
      runtimeEvents.push(event);
      observeToolEvent(event);
    }

    if (!isMockFallbackEnabled(deps)) throw runtimeGenerationError(runtimeEvents);
    return recordMockFallback({
      storage,
      payload,
      threadId,
      agentCardId: agentCard.id,
      agentTitle: agentCard.title[payload.locale],
      configuredModelApiId: context.modelSettings.configuredModelApiId,
      modelId: context.modelSettings.model,
      mode: context.mode,
      prompt: context.prompt,
      toolState: context.effectiveToolState,
      events: runtimeEvents
    });
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
    payload = withOrchestrationPolicy(withCanvasAction(payload, threadId, storage));
    const selection = await prepareThreadModelSelection(payload, threadId, storage, deps.modelRuntime);
    payload = withPlanGeneration(payload, threadId, storage);
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge, selection.configuredModel);
    const agentCard = context.runtimeConfig.agentCard;
    let textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];
    const observeToolEvent = (event: ToolEventRecord) => {
      planOrchestrator.observe(threadId, event);
      callbacks.onToolEvent?.(event);
    };
    for (const event of canvasActionEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }
    for (const event of planPhaseEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }

    callbacks.onStatus?.({ phase: "thinking", label: streamLabels.thinking });

    try {
      planOrchestrator.prepare(threadId, payload);
      const agentBackendRun = await runAgentRuntimeGeneration({
        payload: { ...payload, toolState: context.effectiveToolState },
        threadId,
        projectId: selection.projectId,
        configuredModelApiId: context.modelSettings.configuredModelApiId!,
        modelSettings: context.modelSettings,
        runtimeConfig: context.runtimeConfig,
        messages: context.messages,
        prompt: context.prompt,
        onToolEvent: observeToolEvent,
        onToken: textGate.push,
        onStatus: callbacks.onStatus
      }, executionRuntime);

      if (agentBackendRun) {
        planOrchestrator.assertPostcondition(threadId, payload);
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        if (hasBlockedInternalOutput(normalized.events)) {
          const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"), isMockFallbackEnabled(deps));
          runtimeEvents.push(...(normalized.events ?? []), event);
          observeToolEvent(event);
          textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
        } else {
          textGate.flush();
          callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
          const events = [...runtimeEvents, ...(normalized.events ?? [])];
          planOrchestrator.complete(threadId, payload);
          const recorded = recordGenerationRun({
            storage,
            payload,
            threadId,
            agentCardId: agentCard.id,
            agentTitle: agentCard.title[payload.locale],
            configuredModelApiId: context.modelSettings.configuredModelApiId,
            modelId: context.modelSettings.model,
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
          return recorded;
        }
      } else {
        const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend is disabled or unavailable"), isMockFallbackEnabled(deps));
        runtimeEvents.push(event);
        observeToolEvent(event);
      }
    } catch (error) {
      planOrchestrator.fail(threadId, payload, error);
      const event = createRuntimeFallbackEvent("agent-backend", error, isMockFallbackEnabled(deps));
      runtimeEvents.push(event);
      observeToolEvent(event);
      textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    }

    if (!isMockFallbackEnabled(deps)) throw runtimeGenerationError(runtimeEvents);
    const result = recordMockFallback({
      storage,
      payload,
      threadId,
      agentCardId: agentCard.id,
      agentTitle: agentCard.title[payload.locale],
      configuredModelApiId: context.modelSettings.configuredModelApiId,
      modelId: context.modelSettings.model,
      mode: context.mode,
      prompt: context.prompt,
      toolState: context.effectiveToolState,
      events: runtimeEvents
    });
    textGate.push(result.text);
    textGate.flush();
    return result;
  }

  return { generateAndRecord, generateAndRecordStream };

}

function hasBlockedInternalOutput(events?: ToolEventRecord[]) {
  return events?.some((event) => event.eventType === "internal_output_blocked") ?? false;
}

function createRuntimeFallbackEvent(source: "agent-backend", error: unknown, mockFallbackEnabled: boolean): ToolEventRecord {
  const message = safeRuntimeErrorMessage(error);
  const planProtocolFailure = /^Plan (?:planning|revision|execution|phase)\b/i.test(message);
  return {
    eventType: planProtocolFailure ? "agent_backend_plan_protocol_failed" : "agent_backend_runtime_failed",
    payload: {
      source,
      message,
      fallback: planProtocolFailure ? "none" : mockFallbackEnabled ? "mock" : "none"
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

function formatGenerationFailure(runtimeEvents: ToolEventRecord[]) {
  const agentBackendMessage = runtimeEvents.find((event) => event.eventType === "agent_backend_plan_protocol_failed" || event.eventType === "agent_backend_runtime_failed")?.payload?.message;
  if (typeof agentBackendMessage === "string") {
    return `AgentBackend failed: ${agentBackendMessage}`;
  }
  return "AgentBackend failed with an unknown runtime error.";
}

function runtimeGenerationError(runtimeEvents: ToolEventRecord[]) {
  const message = formatGenerationFailure(runtimeEvents);
  const code = /credential|auth|unauthorized|forbidden/i.test(message) ? "runtime_auth_failed" : "runtime_unavailable";
  return new GenerationError(code, message);
}

function isMockFallbackEnabled(deps?: GenerationServiceDeps) {
  return deps?.mockFallbackEnabled ?? process.env.FACETWRITE_MOCK_FALLBACK_ENABLED === "true";
}

async function prepareThreadModelSelection(
  payload: GenerateRequest,
  threadId: string,
  storage: SQLiteStorageRepository,
  modelRuntime?: GenerationServiceDeps["modelRuntime"]
): Promise<{ projectId: string; configuredModel?: ConfiguredModelApi }> {
  let thread = storage.getThread(threadId);
  if (!thread) {
    const projectId = safeId(payload.projectId);
    if (!projectId || !storage.getProject(projectId)) {
      throw new Error("A valid projectId is required before creating a conversation.");
    }
    await storage.ensureThread(threadId, projectId);
    thread = storage.getThread(threadId);
  }
  if (!thread) throw new Error("Conversation could not be created.");
  const configuredModelApiId = thread.configuredModelApiId?.trim();
  if (!configuredModelApiId) {
    throw new GenerationError("model_required", "Please select a conversation model before generating.");
  }
  let configuredModel: ConfiguredModelApi;
  try {
    configuredModel = await (modelRuntime?.resolveConfiguredModel ?? resolveConfiguredModelApi)(configuredModelApiId);
  } catch {
    throw new GenerationError("model_not_ready", "The selected conversation model no longer exists.");
  }
  if (!configuredModel.enabled || !configuredModel.apiKey?.trim()) {
    throw new GenerationError("model_not_ready", "The selected conversation model is disabled or has no configured API key.");
  }
  if (!(modelRuntime?.isModelReady ?? isConfiguredModelRuntimeReady)(configuredModelApiId)) {
    throw new GenerationError("model_not_ready", "The selected conversation model is not synchronized with Agent Runtime.");
  }
  return { projectId: thread.projectId, configuredModel };
}

function recordMockFallback(input: {
  storage: SQLiteStorageRepository;
  payload: GenerateRequest;
  threadId: string;
  agentCardId: string;
  agentTitle: string;
  configuredModelApiId?: string;
  modelId?: string;
  mode: "structured" | "chat";
  prompt: string;
  toolState: Parameters<typeof recordGenerationRun>[0]["toolState"];
  events: ToolEventRecord[];
}) {
  return recordGenerationRun({
    ...input,
    text: mockText(input.payload),
    provider: "mock",
    usedMock: true,
    errorMessage: formatGenerationFailure(input.events),
    finishReason: "mock_fallback"
  });
}

function withCanvasAction(payload: GenerateRequest, threadId: string, storage: SQLiteStorageRepository): GenerateRequest {
  if (payload.canvasAction || !payload.chatInstruction) return payload;
  const canvasAction = resolveCanvasAction({
    threadId,
    instruction: payload.chatInstruction,
    selectedCanvasNodeId: payload.selectedCanvasNodeId,
    sequence: storage.listMessages(threadId).length
  });
  return canvasAction
    ? { ...payload, canvasAction, contextValues: { ...payload.contextValues, canvasAction } }
    : payload;
}

function canvasActionEvents(payload: GenerateRequest): ToolEventRecord[] {
  if (!payload.canvasAction) return [];
  return [{
    eventType: "canvas_action_recognized",
    payload: {
      eventType: "canvas_action_recognized",
      actionId: payload.canvasAction.id,
      operation: payload.canvasAction.operation,
      risk: payload.canvasAction.risk,
      targetNodeId: payload.canvasAction.targetNodeId
    }
  }];
}

function withPlanGeneration(payload: GenerateRequest, threadId: string, storage: SQLiteStorageRepository): GenerateRequest {
  if (payload.planGeneration) return payload;
  const policy = resolvePlanRequestPolicy(payload);
  if (policy.phase === "chat") return payload;
  const phase = policy.stage === "execution" ? "execution" : policy.stage === "revise" ? "revise" : "intake";
  const existingPlanId = payload.planId || readString(record(payload.contextValues?.awaitingPlan).id);
  const planId = existingPlanId || storage.createPlanIntake(threadId, {
    title: "Plan intake",
    goal: payload.chatInstruction || "Clarify intent"
  }).id;
  const phaseAttemptId = `${policy.stage}_${crypto.randomUUID()}`;
  return {
    ...payload,
    contextValues: { ...payload.contextValues, planGeneration: {
      phase,
      planId,
      stepId: payload.stepId ?? policy.executionStepId,
      phaseAttemptId
    } },
    planGeneration: {
      phase,
      planId,
      stepId: payload.stepId ?? policy.executionStepId,
      phaseAttemptId
    }
  };
}

function withOrchestrationPolicy(payload: GenerateRequest): GenerateRequest {
  if (payload.orchestrationPolicy) return payload;
  const orchestrationPolicy = resolveOrchestrationPolicy(payload.chatInstruction ?? payload.freeTextPrompt ?? "");
  return { ...payload, orchestrationPolicy, contextValues: { ...payload.contextValues, orchestrationPolicy } };
}

function planPhaseEvents(payload: GenerateRequest): ToolEventRecord[] {
  const phase = payload.planGeneration?.phase;
  if (!phase) return [];
  const skill = phase === "intake" ? "brainstorming" : phase === "revise" ? "writing-plans" : undefined;
  return [{
    eventType: "agent_backend_plan_activity",
    payload: {
      eventType: phase === "intake" ? "intent_recognized" : phase === "revise" ? "plan_preparing" : "step_started",
      planId: payload.planGeneration?.planId,
      stepId: payload.planGeneration?.stepId,
      phase,
      phaseAttemptId: payload.planGeneration?.phaseAttemptId,
      ...(skill ? { skill, summary: `Using skill: ${skill}` } : {})
    }
  }];
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readString(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
