import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { StreamStatus } from "../../agentRunLoop.js";
import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { ProjectRuntimeSettings, SQLiteStorageRepository } from "../../storage.js";
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
import { commitCanvasDelivery, planCanvasDelivery, type CanvasDeliveryPlan } from "../canvasDeliveryPlanner.js";
import { stableDeliveryId } from "../canvasDelivery.js";
import { resolveCanvasDeliveryContent, type CanvasDeliveryContract } from "./canvasDeliveryContent.js";
import { isDirectCanvasDeliveryIntent } from "./canvasDeliveryIntent.js";
import { formatSourceLinks } from "./sourceLinks.js";
import { isCanvasWorkflowMode, type CanvasWorkflowMode } from "../../../shared/canvasWorkflow.js";
import {
  createRunTimelineBuilder,
  safeDecisionTimelineEvent,
  timelineEventFromToolEvent,
  timelineEventToToolEvent,
  toolEventToTimelineEvent,
  type RunTimelineEvent
} from "./runTimeline.js";

export type GenerationService = {
  generateAndRecord: (payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void) => Promise<GenerateResponse>;
  generateAndRecordStream: (
    payload: GenerateRequest,
    callbacks?: {
      onToken?: (token: string) => void;
      onReasoningToken?: (token: string) => void;
      onStatus?: (status: StreamStatus) => void;
      onToolEvent?: (event: ToolEventRecord) => void;
      onTimelineEvent?: (event: RunTimelineEvent) => void;
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

const progressiveEvidenceTools = ["web_search", "web_fetch", "read_file", "bash", "grep", "glob", "ls", "knowledge_base"] as const;
type RuntimeBudgetProfile = NonNullable<GenerateRequest["runtimeBudgetProfile"]>;

const runtimeBudgetProfiles: Record<RuntimeBudgetProfile, ProjectRuntimeSettings> = {
  low: { runtimeBudgetProfile: "low", recursionLimit: 40, modelCallLimit: 10, evidenceToolLimit: 4, bodyDraftWriteLimit: 1, synthesisReserveSteps: 10 },
  medium: { runtimeBudgetProfile: "medium", recursionLimit: 80, modelCallLimit: 20, evidenceToolLimit: 8, bodyDraftWriteLimit: 3, synthesisReserveSteps: 16 },
  high: { runtimeBudgetProfile: "high", recursionLimit: 160, modelCallLimit: 36, evidenceToolLimit: 18, bodyDraftWriteLimit: 5, synthesisReserveSteps: 24 }
};

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
    payload = withRuntimeContext(payload, context.canvasDeliveryContract);
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
          const baseEvents = [...runtimeEvents, ...(normalized.events ?? [])];
          const finalized = finalizeCanvasDelivery({
            payload,
            threadId,
            projectId: selection.projectId,
            storage,
            text: normalized.text,
            events: baseEvents
          });
          const events = [...baseEvents, ...finalized.timelineEvents.map(timelineEventToToolEvent)];
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
            text: finalized.text,
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
      onReasoningToken?: (token: string) => void;
      onStatus?: (status: StreamStatus) => void;
      onToolEvent?: (event: ToolEventRecord) => void;
      onTimelineEvent?: (event: RunTimelineEvent) => void;
    } = {}
  ): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    payload = withOrchestrationPolicy(withCanvasAction(payload, threadId, storage));
    const selection = await prepareThreadModelSelection(payload, threadId, storage, deps.modelRuntime);
    payload = withPlanGeneration(payload, threadId, storage);
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge, selection.configuredModel);
    payload = withRuntimeContext(payload, context.canvasDeliveryContract);
    payload = withProgressiveCanvasDeliveryContext(payload, context, storage.getProjectRuntimeSettings(selection.projectId));
    const agentCard = context.runtimeConfig.agentCard;
    let textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];
    const timeline = createRunTimelineBuilder({ threadId, locale: payload.locale });
    const timelineEvents: RunTimelineEvent[] = [];
    const deliveryId = stableCanvasDeliveryId(threadId, payload, storage);
    let researchDeliverySequence = 0;
    let bodyDraftWriteCount = 0;
    let progressiveDeliveryStarted = false;
    let progressiveSynthesisStarted = false;
    const progressiveEvidenceEntries: ProgressiveEvidenceEntry[] = [];
    const publicReasoning = createPublicReasoningEmitter(payload.locale, callbacks.onReasoningToken);
    const emitTimeline = (event: RunTimelineEvent) => {
      timelineEvents.push(event);
      callbacks.onTimelineEvent?.(event);
    };
    const emitRuntimeToolEvent = (event: ToolEventRecord) => {
      planOrchestrator.observe(threadId, event);
      callbacks.onToolEvent?.(event);
      publicReasoning.fromToolEvent(event);
      emitTimeline(timelineEventFromToolEvent(event) ?? toolEventToTimelineEvent(timeline, event));
    };
    const ensureProgressiveDeliveryStarted = () => {
      if (progressiveDeliveryStarted || !isProgressiveCanvasDeliveryEnabled(payload)) return;
      progressiveDeliveryStarted = true;
      const events = beginProgressiveCanvasDelivery({
        payload,
        threadId,
        projectId: selection.projectId,
        storage,
        deliveryId
      });
      for (const event of events) {
        runtimeEvents.push(event);
        emitRuntimeToolEvent(event);
      }
    };
    const observeToolEvent = (event: ToolEventRecord) => {
      emitRuntimeToolEvent(event);
      if (isProgressiveToolCompletion(event)) ensureProgressiveDeliveryStarted();
      if (progressiveSynthesisStarted) return;
      const researchEvents = commitProgressiveResearchDelivery({
        payload,
        threadId,
        projectId: selection.projectId,
        storage,
        deliveryId,
        event,
        onEvidenceEntry: (entry) => progressiveEvidenceEntries.push(entry),
        nextSequence: () => {
          researchDeliverySequence += 1;
          return researchDeliverySequence;
        }
      });
      for (const researchEvent of researchEvents) {
        runtimeEvents.push(researchEvent);
        emitRuntimeToolEvent(researchEvent);
      }
      if (researchEvents.length) {
        const budget = readProgressiveDeliveryBudget(payload);
        const bodyEvents = bodyDraftWriteCount < budget.bodyDraftWriteLimit ? commitProgressiveBodyCheckpointDelivery({
          payload,
          projectId: selection.projectId,
          storage,
          deliveryId,
          entries: progressiveEvidenceEntries,
          draftIndex: bodyDraftWriteCount + 1,
          draftLimit: budget.bodyDraftWriteLimit
        }) : [];
        if (bodyEvents.length) bodyDraftWriteCount += 1;
        for (const bodyEvent of bodyEvents) {
          runtimeEvents.push(bodyEvent);
          emitRuntimeToolEvent(bodyEvent);
        }
        if (progressiveEvidenceEntries.length >= budget.evidenceToolLimit || bodyDraftWriteCount >= budget.bodyDraftWriteLimit) {
          progressiveSynthesisStarted = true;
          const synthesisEvent = canvasDeliveryEvent("canvas_delivery_synthesis_started", deliveryId, payload.locale, undefined, {
            evidenceCount: progressiveEvidenceEntries.length,
            bodyDraftWriteCount,
            evidenceToolLimit: budget.evidenceToolLimit,
            bodyDraftWriteLimit: budget.bodyDraftWriteLimit
          });
          runtimeEvents.push(synthesisEvent);
          emitRuntimeToolEvent(synthesisEvent);
        }
      }
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
    publicReasoning.emit("prepare", payload.locale === "zh" ? "正在准备上下文、工具和运行环境。" : "Preparing context, tools, and runtime.");
    emitTimeline(timeline.event("phase_started", "running", payload.locale === "zh" ? "准备执行" : "Preparing run", payload.locale === "zh" ? "正在准备上下文、工具和运行环境。" : "Preparing context, tools, and runtime."));
    if (context.transientSkillNames.length) {
      emitTimeline(skillUsageTimelineEvent(timeline, payload.locale, context.transientSkillNames));
    }
    if (shouldStartProgressiveCanvasDeliveryImmediately(payload, context)) ensureProgressiveDeliveryStarted();

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
        onReasoningToken: callbacks.onReasoningToken,
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
          const internalOutputError = new Error("AgentBackend returned internal runtime output");
          const event = createRuntimeFallbackEvent("agent-backend", internalOutputError, isMockFallbackEnabled(deps));
          runtimeEvents.push(...(normalized.events ?? []), event);
          observeToolEvent(event);
          if (isProgressiveCanvasDeliveryEnabled(payload)) {
            ensureProgressiveDeliveryStarted();
            for (const failureEvent of commitProgressiveFailureDelivery({
              payload,
              projectId: selection.projectId,
              storage,
              deliveryId,
              error: internalOutputError,
              entries: progressiveEvidenceEntries
            })) {
              runtimeEvents.push(failureEvent);
              emitRuntimeToolEvent(failureEvent);
            }
          }
          textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
        } else {
          textGate.flush();
          callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
          publicReasoning.emit("finalize", payload.locale === "zh" ? "正在整理最终回答，并校准 Canvas 节点内容。" : "Organizing the final answer and reconciling Canvas nodes.");
          const baseEvents = [...runtimeEvents, ...(normalized.events ?? [])];
          const finalized = finalizeCanvasDelivery({
            payload,
            threadId,
            projectId: selection.projectId,
            storage,
            deliveryId,
            text: normalized.text,
            events: baseEvents,
            timeline,
            emitTimeline
          });
          const progressiveFinalized = finalizeProgressiveCanvasDelivery({
            payload,
            projectId: selection.projectId,
            storage,
            deliveryId,
            text: finalized.text || normalized.text,
            events: baseEvents,
            timeline,
            emitTimeline
          });
          for (const finalEvent of progressiveFinalized.events) {
            emitRuntimeToolEvent(finalEvent);
          }
          const completed = timeline.event("run_completed", "completed", payload.locale === "zh" ? "运行完成" : "Run completed", payload.locale === "zh" ? "最终内容已生成。" : "Final content is ready.");
          emitTimeline(completed);
          const events = [...baseEvents, ...progressiveFinalized.events, ...timelineEvents.map(timelineEventToToolEvent)];
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
            text: progressiveFinalized.text || finalized.text,
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
      if (isProgressiveCanvasDeliveryEnabled(payload)) {
        ensureProgressiveDeliveryStarted();
        for (const failureEvent of commitProgressiveFailureDelivery({
          payload,
          projectId: selection.projectId,
          storage,
          deliveryId,
          error,
          entries: progressiveEvidenceEntries
        })) {
          runtimeEvents.push(failureEvent);
          emitRuntimeToolEvent(failureEvent);
        }
      }
      const event = createRuntimeFallbackEvent("agent-backend", error, isMockFallbackEnabled(deps));
      runtimeEvents.push(event);
      observeToolEvent(event);
      emitTimeline(timeline.event("run_failed", "failed", payload.locale === "zh" ? "运行失败" : "Run failed", safeRuntimeErrorMessage(error)));
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
      events: [...runtimeEvents, ...timelineEvents.map(timelineEventToToolEvent)]
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

function stableCanvasDeliveryId(threadId: string, payload: GenerateRequest, storage: SQLiteStorageRepository) {
  const sequence = storage.listMessages(threadId).length + 1;
  const actionId = payload.canvasAction?.id ?? "direct";
  return `delivery_${threadId}_${sequence}_${actionId}`;
}

function withRuntimeContext(payload: GenerateRequest, canvasDeliveryContract?: CanvasDeliveryContract): GenerateRequest {
  if (!canvasDeliveryContract) return payload;
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      canvasDeliveryContract
    }
  };
}

function withProgressiveCanvasDeliveryContext(payload: GenerateRequest, context: Awaited<ReturnType<typeof buildGenerationRunContext>>, projectSettings: ProjectRuntimeSettings): GenerateRequest {
  if (readCanvasWorkflowMode(payload.contextValues) !== "batch_delivery") return payload;
  const budget = resolveRuntimeBudget(payload.runtimeBudgetProfile, projectSettings);
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      runtimeBudgetProfile: budget.runtimeBudgetProfile,
      progressiveCanvasDelivery: {
        enabled: true,
        runtimeBudgetProfile: budget.runtimeBudgetProfile,
        recursionLimit: budget.recursionLimit,
        modelCallLimit: budget.modelCallLimit,
        evidenceToolLimit: budget.evidenceToolLimit,
        bodyDraftWriteLimit: budget.bodyDraftWriteLimit,
        synthesisReserveSteps: budget.synthesisReserveSteps,
        forceSynthesisAfterEvidence: true,
        forceSynthesisAfterBodyDrafts: true,
        evidenceTools: [...progressiveEvidenceTools],
        trigger: progressiveCanvasDeliveryTrigger(payload, context)
      }
    }
  };
}

function resolveRuntimeBudget(profileOverride: GenerateRequest["runtimeBudgetProfile"], projectSettings: ProjectRuntimeSettings): ProjectRuntimeSettings {
  if (profileOverride) {
    return { ...runtimeBudgetProfiles[readRuntimeBudgetProfile(profileOverride)] };
  }
  return projectSettings;
}

function readRuntimeBudgetProfile(value: GenerateRequest["runtimeBudgetProfile"] | unknown): RuntimeBudgetProfile {
  return value === "low" || value === "high" ? value : "medium";
}

function readProgressiveDeliveryBudget(payload: GenerateRequest): ProjectRuntimeSettings {
  const delivery = record(payload.contextValues?.progressiveCanvasDelivery);
  const profile = readRuntimeBudgetProfile(delivery.runtimeBudgetProfile);
  const fallback = runtimeBudgetProfiles[profile];
  return {
    runtimeBudgetProfile: profile,
    evidenceToolLimit: readPositiveInt(delivery.evidenceToolLimit, fallback.evidenceToolLimit),
    bodyDraftWriteLimit: readPositiveInt(delivery.bodyDraftWriteLimit, fallback.bodyDraftWriteLimit),
    modelCallLimit: readPositiveInt(delivery.modelCallLimit, fallback.modelCallLimit),
    recursionLimit: readPositiveInt(delivery.recursionLimit, fallback.recursionLimit),
    synthesisReserveSteps: readPositiveInt(delivery.synthesisReserveSteps, fallback.synthesisReserveSteps)
  };
}

function readPositiveInt(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function progressiveCanvasDeliveryTrigger(payload: GenerateRequest, context: Awaited<ReturnType<typeof buildGenerationRunContext>>) {
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  if (isDirectCanvasDeliveryIntent(instruction)) return "direct_canvas_intent";
  if (context.transientSkillNames.length > 0) return "skill_long_task";
  if (context.modelSettings.thinkingMode === "enabled") return "thinking_long_task";
  const policy = resolveOrchestrationPolicy(instruction);
  if (policy.deliveryPolicy === "canvas_required") return "orchestration_canvas_required";
  return "tool_event_long_task";
}

function isProgressiveCanvasDeliveryEnabled(payload: GenerateRequest) {
  return record(payload.contextValues?.progressiveCanvasDelivery).enabled === true;
}

function shouldStartProgressiveCanvasDeliveryImmediately(payload: GenerateRequest, context: Awaited<ReturnType<typeof buildGenerationRunContext>>) {
  if (!isProgressiveCanvasDeliveryEnabled(payload)) return false;
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  return isDirectCanvasDeliveryIntent(instruction)
    || context.transientSkillNames.length > 0
    || context.modelSettings.thinkingMode === "enabled"
    || resolveOrchestrationPolicy(instruction).deliveryPolicy === "canvas_required";
}

function skillUsageTimelineEvent(
  timeline: ReturnType<typeof createRunTimelineBuilder>,
  locale: GenerateRequest["locale"],
  skillNames: string[]
): RunTimelineEvent {
  const refs = Array.from(new Set(skillNames));
  return timeline.event(
    "decision",
    "running",
    locale === "zh" ? "使用技能" : "Using skills",
    locale === "zh" ? `使用技能：${refs.join(", ")}` : `Using skills: ${refs.join(", ")}`,
    { source: "composer", skillRefs: refs }
  );
}

function finalizeCanvasDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId?: string;
  text: string;
  events: ToolEventRecord[];
  timeline?: ReturnType<typeof createRunTimelineBuilder>;
  emitTimeline?: (event: RunTimelineEvent) => void;
}) {
  const instruction = input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "";
  if (!isDirectCanvasDeliveryIntent(instruction)) return { text: input.text, timelineEvents: [] as RunTimelineEvent[] };
  const assistantText = input.text.trim();
  if (!assistantText) {
    throw new Error("Direct Canvas delivery completed without assistant content.");
  }
  const timeline = input.timeline ?? createRunTimelineBuilder({ threadId: input.threadId, locale: input.payload.locale });
  const localTimelineEvents: RunTimelineEvent[] = [];
  const emit = input.emitTimeline ?? ((event: RunTimelineEvent) => localTimelineEvents.push(event));
  const content = resolveCanvasDeliveryContent({
    instruction,
    locale: input.payload.locale,
    text: assistantText,
    events: input.events
  });
  const delivery = planCanvasDelivery({
    deliveryId: input.deliveryId ?? stableCanvasDeliveryId(input.threadId, input.payload, input.storage),
    projectId: input.projectId,
    instruction,
    locale: input.payload.locale,
    content,
    workflowMode: readCanvasWorkflowMode(input.payload.contextValues)
  });
  if (!delivery.required) return { text: content.assistantText || input.text, timelineEvents: localTimelineEvents };

  emit(safeDecisionTimelineEvent(timeline, input.payload.locale === "zh"
      ? delivery.moduleId === "diagram_delivery"
        ? "检测到明确 Canvas 图形交付请求，按可编辑图形节点提交。"
        : "检测到明确 Canvas 交付请求，按“整体概述 -> 正文 -> 来源”提交节点。"
    : delivery.moduleId === "diagram_delivery"
      ? "Detected an explicit Canvas diagram delivery request and committed editable diagram nodes."
      : "Detected an explicit Canvas delivery request and committed outline, body, and sources nodes."));
  const committed = commitCanvasDelivery(input.storage, input.projectId, delivery);
  for (const item of committed) {
    emit(timeline.event("canvas_node_committed", "completed", item.title, input.payload.locale === "zh" ? `已创建或更新节点：${item.title}` : `Created or updated node: ${item.title}`, { nodeId: item.nodeId, title: item.title }));
  }
  return { text: content.assistantText || input.text, timelineEvents: localTimelineEvents };
}

function finalizeProgressiveCanvasDelivery(input: {
  payload: GenerateRequest;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  text: string;
  events: ToolEventRecord[];
  timeline?: ReturnType<typeof createRunTimelineBuilder>;
  emitTimeline?: (event: RunTimelineEvent) => void;
}) {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return { text: input.text, events: [] as ToolEventRecord[] };
  const instruction = input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "";
  if (isDirectCanvasDeliveryIntent(instruction)) return { text: input.text, events: [] as ToolEventRecord[] };
  const assistantText = input.text.trim();
  if (!assistantText) return { text: input.text, events: [] as ToolEventRecord[] };
  const timeline = input.timeline ?? createRunTimelineBuilder({ threadId: input.payload.threadId ?? "pending", locale: input.payload.locale });
  const emit = input.emitTimeline ?? (() => undefined);
  const content = resolveCanvasDeliveryContent({
    instruction,
    locale: input.payload.locale,
    text: assistantText,
    events: input.events
  });
  const overviewTitle = input.payload.locale === "zh" ? "整体概述" : "Overview";
  const bodyTitle = input.payload.locale === "zh" ? "正文" : "Body";
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [
      {
        id: stableDeliveryId("node", input.deliveryId, 1),
        kind: "document",
        title: overviewTitle,
        content: content.outlineMarkdown || outlineFromFinalBody(content.bodyMarkdown || assistantText, input.payload.locale),
        x: 560,
        y: 120,
        width: 520,
        height: 260,
        metadata: { deliveryId: input.deliveryId, phase: "outline", progressive: true, status: "final" }
      },
      {
        id: stableDeliveryId("node", input.deliveryId, 2),
        kind: "document",
        title: bodyTitle,
        content: content.bodyMarkdown || assistantText,
        x: 1280,
        y: 120,
        width: 640,
        height: 520,
        metadata: { deliveryId: input.deliveryId, phase: "body", progressive: true, status: "final" }
      }
    ],
    edges: []
  };
  const committed = commitCanvasDelivery(input.storage, input.projectId, plan);
  for (const item of committed) {
    emit(timeline.event(
      "canvas_node_committed",
      "completed",
      item.title,
      input.payload.locale === "zh" ? `最终内容已写入节点：${item.title}` : `Final content written to node: ${item.title}`,
      { nodeId: item.nodeId, title: item.title, deliveryId: input.deliveryId }
    ));
  }
  const body = committed.find((item) => item.nodeId === stableDeliveryId("node", input.deliveryId, 2));
  return {
    text: content.assistantText || input.text,
    events: body ? [canvasDeliveryEvent("canvas_delivery_body_final_committed", input.deliveryId, input.payload.locale, body, {
      displayTitle: input.payload.locale === "zh" ? "最终正文" : "Final body"
    })] : [] as ToolEventRecord[]
  };
}

function outlineFromFinalBody(body: string, locale: GenerateRequest["locale"]) {
  const title = locale === "zh" ? "整体概述" : "Overview";
  const firstParagraph = body
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return [`# ${title}`, "", firstParagraph ?? (locale === "zh" ? "最终内容已生成。" : "Final content is ready.")].join("\n");
}

function beginProgressiveCanvasDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
}): ToolEventRecord[] {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return [];
  if (readCanvasWorkflowMode(input.payload.contextValues) !== "batch_delivery") return [];
  const summaryTitle = input.payload.locale === "zh" ? "整体概述" : "Overview";
  const bodyTitle = input.payload.locale === "zh" ? "正文" : "Body";
  const outlineContent = input.payload.locale === "zh" ? "# 整体概述\n正在准备 Canvas 交付..." : "# Overview\nPreparing Canvas delivery...";
  const bodyContent = input.payload.locale === "zh" ? "# 正文\n正在生成内容..." : "# Body\nGenerating content...";
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [
      {
        id: stableDeliveryId("node", input.deliveryId, 1),
        kind: "document",
        title: summaryTitle,
        content: outlineContent,
        x: 560,
        y: 120,
        width: 520,
        height: 260,
        metadata: { deliveryId: input.deliveryId, phase: "outline", progressive: true, status: "placeholder" }
      },
      {
        id: stableDeliveryId("node", input.deliveryId, 2),
        kind: "document",
        title: bodyTitle,
        content: bodyContent,
        x: 1280,
        y: 120,
        width: 640,
        height: 520,
        metadata: { deliveryId: input.deliveryId, phase: "body", progressive: true, status: "placeholder" }
      }
    ],
    edges: [{
      id: stableDeliveryId("edge", input.deliveryId, 1),
      sourceNodeId: stableDeliveryId("node", input.deliveryId, 1),
      targetNodeId: stableDeliveryId("node", input.deliveryId, 2),
      label: "next"
    }]
  };
  const committed = commitCanvasDelivery(input.storage, input.projectId, plan);
  return [
    canvasDeliveryEvent("canvas_delivery_outline_started", input.deliveryId, input.payload.locale),
    ...committed.map((item, index) => canvasDeliveryEvent(
      index === 0 ? "canvas_delivery_outline_committed" : "canvas_delivery_body_started",
      input.deliveryId,
      input.payload.locale,
      item
    ))
  ];
}

function canvasDeliveryEvent(
  eventType: string,
  deliveryId: string,
  locale: GenerateRequest["locale"],
  item?: { nodeId: string; title: string },
  extraPayload: Record<string, unknown> = {}
): ToolEventRecord {
  return {
    eventType: eventType as ToolEventRecord["eventType"],
    payload: {
      eventType,
      tool: "canvas_delivery",
      deliveryId,
      status: /started$/.test(eventType) ? "running" : "committed",
      summary: locale === "zh" ? "Canvas 渐进交付已更新。" : "Progressive Canvas delivery updated.",
      ...(item ? { nodeId: item.nodeId, title: item.title } : {}),
      ...extraPayload
    }
  };
}

function commitProgressiveResearchDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  event: ToolEventRecord;
  onEvidenceEntry?: (entry: ProgressiveEvidenceEntry) => void;
  nextSequence: () => number;
}): ToolEventRecord[] {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return [];
  if (!isProgressiveToolCompletion(input.event)) return [];
  const payload = record(input.event.payload);
  const toolName = readString(payload.toolName) || readString(payload.tool);
  if (!isProgressiveEvidenceTool(toolName)) return [];
  const sequence = input.nextSequence();
  const entry = progressiveEvidenceEntry(input.payload.locale, toolName, payload, sequence);
  if (!entry) return [];
  input.onEvidenceEntry?.(entry);
  const direct = isDirectCanvasDeliveryIntent(input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "");
  const title = input.payload.locale === "zh"
    ? `${direct ? "研究摘录" : "进度摘录"} ${sequence}`
    : `${direct ? "Research note" : "Progress note"} ${sequence}`;
  const content = researchNoteMarkdown(entry);
  if (!content.trim()) return [];
  const nodeId = stableDeliveryId("node", input.deliveryId, 100 + sequence);
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [{
      id: nodeId,
      kind: "reference",
      title,
      content,
      x: 560 + sequence * 240,
      y: 720 + sequence * 80,
      width: 560,
      height: 300,
      metadata: { deliveryId: input.deliveryId, phase: "research", researchIndex: sequence, toolName }
    }],
    edges: []
  };
  const [committed] = commitCanvasDelivery(input.storage, input.projectId, plan);
  return committed ? [canvasDeliveryEvent("canvas_delivery_research_committed", input.deliveryId, input.payload.locale, committed)] : [];
}

type ProgressiveEvidenceEntry = {
  sequence: number;
  locale: GenerateRequest["locale"];
  toolName: string;
  query?: string;
  url?: string;
  path?: string;
  command?: string;
  summary?: string;
  snippet?: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
};

function commitProgressiveBodyCheckpointDelivery(input: {
  payload: GenerateRequest;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  entries: ProgressiveEvidenceEntry[];
  draftIndex: number;
  draftLimit: number;
}): ToolEventRecord[] {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload) || input.entries.length === 0) return [];
  const title = input.payload.locale === "zh" ? "正文" : "Body";
  const content = progressiveBodyCheckpointMarkdown(input.payload.locale, input.entries);
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [{
      id: stableDeliveryId("node", input.deliveryId, 2),
      kind: "document",
      title,
      content,
      x: 960,
      y: 240,
      width: 620,
      height: 520,
      metadata: { deliveryId: input.deliveryId, phase: "body", checkpoint: true, evidenceCount: input.entries.length }
    }],
    edges: []
  };
  const [committed] = commitCanvasDelivery(input.storage, input.projectId, plan);
  return committed ? [canvasDeliveryEvent("canvas_delivery_body_checkpoint_committed", input.deliveryId, input.payload.locale, committed, {
    draftIndex: input.draftIndex,
    draftLimit: input.draftLimit,
    evidenceCount: input.entries.length,
    displayTitle: input.payload.locale === "zh" ? `正文草稿 ${input.draftIndex}` : `Body draft ${input.draftIndex}`
  })] : [];
}

function commitProgressiveFailureDelivery(input: {
  payload: GenerateRequest;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  error: unknown;
  entries: ProgressiveEvidenceEntry[];
}): ToolEventRecord[] {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return [];
  const title = input.payload.locale === "zh" ? "运行失败" : "Run failed";
  const message = safeRuntimeErrorMessage(input.error);
  const overviewTitle = input.payload.locale === "zh" ? "整体概述" : "Overview";
  const overviewContent = [
    `# ${overviewTitle}`,
    "",
    input.payload.locale === "zh"
      ? "运行在最终综合前失败。画布中已保留可恢复的中间产物和最新正文草稿。"
      : "The run failed before final synthesis. The Canvas keeps recoverable progress notes and the latest body draft.",
    "",
    `- ${input.payload.locale === "zh" ? "已保留摘录" : "Preserved notes"}: ${input.entries.length}`,
    `- ${input.payload.locale === "zh" ? "错误" : "Error"}: ${message}`
  ].join("\n");
  const content = [
    `# ${title}`,
    "",
    input.payload.locale === "zh"
      ? "运行在生成最终结果前失败。已保留此前完成的 Canvas 中间产物，便于继续排查或重试。"
      : "The run failed before producing the final result. Completed Canvas progress notes were preserved for recovery or retry.",
    "",
    `- ${input.payload.locale === "zh" ? "错误" : "Error"}: ${message}`
  ].join("\n");
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [
      {
        id: stableDeliveryId("node", input.deliveryId, 1),
        kind: "document",
        title: overviewTitle,
        content: overviewContent,
        x: 560,
        y: 240,
        width: 560,
        height: 300,
        metadata: { deliveryId: input.deliveryId, phase: "outline", status: "failed" }
      },
      {
        id: stableDeliveryId("node", input.deliveryId, 900),
        kind: "reference",
        title,
        content,
        x: 560,
        y: 1080,
        width: 560,
        height: 260,
        metadata: { deliveryId: input.deliveryId, phase: "failure", status: "failed" }
      }
    ],
    edges: []
  };
  const committed = commitCanvasDelivery(input.storage, input.projectId, plan);
  return committed.length ? [canvasDeliveryEvent("canvas_delivery_failed_summary_committed", input.deliveryId, input.payload.locale, committed[0]!)] : [];
}

function progressiveEvidenceEntry(locale: GenerateRequest["locale"], toolName: string, payload: Record<string, unknown>, sequence: number): ProgressiveEvidenceEntry | undefined {
  const entry: ProgressiveEvidenceEntry = {
    sequence,
    locale,
    toolName,
    query: sanitizeProgressText(readString(payload.query)),
    url: readString(payload.url),
    path: sanitizeProgressText(readString(payload.path)),
    command: sanitizeProgressText(readString(payload.command)),
    summary: sanitizeProgressText(readString(payload.summary)),
    snippet: sanitizeProgressText(readString(payload.snippet)),
    sources: readResearchSources(payload.sources)
  };
  if (!entry.query && !entry.url && !entry.path && !entry.command && !entry.summary && !entry.snippet && !entry.sources.length) return undefined;
  return entry;
}

function researchNoteMarkdown(input: ProgressiveEvidenceEntry) {
  const label = input.locale === "zh"
    ? { tool: "工具", query: "查询", url: "URL", path: "路径", command: "命令", summary: "摘要", snippet: "摘录", sources: "来源", snippets: "来源摘录" }
    : { tool: "Tool", query: "Query", url: "URL", path: "Path", command: "Command", summary: "Summary", snippet: "Snippet", sources: "Sources", snippets: "Source snippets" };
  const lines = [
    `# ${input.locale === "zh" ? "进度摘录" : "Progress note"}`,
    `- ${label.tool}: ${input.toolName}`,
    input.query ? `- ${label.query}: ${input.query}` : "",
    input.url ? `- ${label.url}: ${input.url}` : "",
    input.path ? `- ${label.path}: ${input.path}` : "",
    input.command ? `- ${label.command}: ${input.command}` : "",
    input.summary ? `- ${label.summary}: ${input.summary}` : "",
    input.snippet ? `- ${label.snippet}: ${input.snippet}` : ""
  ].filter(Boolean);
  if (input.sources.length) {
    lines.push("", `## ${label.sources}`, formatSourceLinks(input.sources));
    const snippets = input.sources.filter((source) => source.snippet);
    if (snippets.length) {
      lines.push("", `## ${label.snippets}`, ...snippets.map((source) => `- ${source.title}: ${source.snippet}`));
    }
  }
  return lines.join("\n");
}

function progressiveBodyCheckpointMarkdown(locale: GenerateRequest["locale"], entries: ProgressiveEvidenceEntry[]) {
  const recent = entries.slice(-8);
  const heading = locale === "zh" ? "正文" : "Body";
  const status = locale === "zh" ? "工作正文草稿" : "Working body draft";
  const findings = locale === "zh" ? "已形成的正文要点" : "Draft points";
  const basis = locale === "zh" ? "依据" : "Basis";
  const next = locale === "zh" ? "待最终综合" : "Pending final synthesis";
  const lines = [
    `# ${heading}`,
    "",
    `> ${status}: ${locale === "zh" ? "以下内容由服务端根据已完成工具事件自动汇总，最终成功后会被正式正文替换。" : "This section is server-built from completed tool events and will be replaced by the final body after a successful run."}`,
    "",
    `## ${findings}`
  ];
  for (const entry of recent) {
    const point = entry.summary || entry.snippet || entry.query || entry.url || entry.path || entry.command || "";
    if (!point) continue;
    const source = entry.url || entry.path || entry.query || entry.command || entry.toolName;
    lines.push(`- ${point}${source ? ` (${basis}: ${source})` : ""}`);
  }
  lines.push("", `## ${next}`, locale === "zh"
    ? "- 基于上述材料压缩重复信息，形成完整结论、步骤和来源说明。"
    : "- Compress repeated evidence into complete conclusions, steps, and source notes.");
  return lines.join("\n");
}

function isProgressiveToolCompletion(event: ToolEventRecord) {
  return /(?:^|_)tool_completed$/.test(event.eventType);
}

function isProgressiveEvidenceTool(toolName: string) {
  return (progressiveEvidenceTools as readonly string[]).includes(toolName);
}

function sanitizeProgressText(value: string) {
  return value
    .replace(/__FACETWRITE_EVENT__[\s\S]*/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(redactSecretLikeText)
    .filter((line) => line && !/^#\s*(?:AgentCard|Loaded Skills|Current User Instruction|Context|Output Contract)\b/i.test(line))
    .filter((line) => !/^\[redacted credential\]$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function redactSecretLikeText(value: string) {
  return value
    .replace(/\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|token|password|secret|cookie)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted credential]");
}

function readResearchSources(value: unknown): Array<{ title: string; url: string; snippet?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const url = readString(source.url);
    if (!/^https?:\/\//i.test(url)) return [];
    const title = readString(source.title) || url;
    const snippet = sanitizeProgressText(readString(source.snippet));
    return [{ title, url, ...(snippet ? { snippet } : {}) }];
  }).slice(0, 10);
}

function readCanvasWorkflowMode(contextValues: GenerateRequest["contextValues"]): CanvasWorkflowMode {
  const canvas = record(contextValues?.canvas);
  const workflow = record(canvas.workflow);
  return isCanvasWorkflowMode(workflow.mode) ? workflow.mode : "batch_delivery";
}

function createPublicReasoningEmitter(locale: GenerateRequest["locale"], onReasoningToken?: (token: string) => void) {
  const emitted = new Set<string>();
  const emit = (key: string, text: string) => {
    if (!onReasoningToken || emitted.has(key)) return;
    emitted.add(key);
    onReasoningToken(`${text}\n`);
  };
  return {
    emit,
    fromToolEvent(event: ToolEventRecord) {
      if (/^canvas_delivery_outline_started$/.test(event.eventType)) {
        emit("canvas:outline:start", locale === "zh" ? "检测到明确 Canvas 交付请求，先搭建摘要和正文节点。" : "Detected an explicit Canvas delivery request, so I am creating outline and body placeholders first.");
        return;
      }
      if (/^canvas_delivery_outline_committed$/.test(event.eventType)) {
        emit("canvas:outline:commit", locale === "zh" ? "摘要节点已就位，后续会用最终内容校准。" : "The outline node is in place and will be reconciled with the final content.");
        return;
      }
      if (/^canvas_delivery_body_started$/.test(event.eventType)) {
        emit("canvas:body:start", locale === "zh" ? "正文节点已就位，等待完整答案后写入分节内容。" : "The body node is in place and will receive section content after the answer stabilizes.");
        return;
      }
      if (/^canvas_delivery_body_checkpoint_committed$/.test(event.eventType)) {
        emit("canvas:body:checkpoint", locale === "zh" ? "正文草稿已根据当前工具结果更新。" : "The body draft was updated from the current tool results.");
        return;
      }
      const payload = record(event.payload);
      const toolName = readString(payload.toolName) || readString(payload.tool);
      if (!toolName) return;
      const phase = /failed$/.test(event.eventType)
        ? "failed"
        : /completed$/.test(event.eventType)
          ? "completed"
          : /started$|requested$/.test(event.eventType)
            ? "started"
            : "";
      if (!phase) return;
      const label = publicToolLabel(toolName, locale);
      if (phase === "started") {
        emit(`tool:${toolName}:started`, locale === "zh" ? `正在使用 ${label} 收集中间依据。` : `Using ${label} to gather supporting information.`);
      } else if (phase === "completed") {
        emit(`tool:${toolName}:completed`, locale === "zh" ? `${label} 已返回结果，正在筛选可用于回答和 Canvas 的信息。` : `${label} returned results; selecting what is useful for the answer and Canvas.`);
      } else if (phase === "failed") {
        emit(`tool:${toolName}:failed`, locale === "zh" ? `${label} 有部分失败，继续使用可用结果推进。` : `${label} had a partial failure; continuing with available results.`);
      }
    }
  };
}

function publicToolLabel(toolName: string, locale: GenerateRequest["locale"]) {
  if (toolName === "web_search") return locale === "zh" ? "网页搜索" : "web search";
  if (toolName === "web_fetch") return locale === "zh" ? "网页读取" : "web fetch";
  if (toolName === "knowledge_base") return locale === "zh" ? "知识库" : "knowledge base";
  if (toolName === "canvas_write") return locale === "zh" ? "Canvas 写入" : "Canvas write";
  if (toolName === "canvas_delivery") return locale === "zh" ? "Canvas 交付" : "Canvas delivery";
  return toolName.replace(/[_-]+/g, " ");
}
