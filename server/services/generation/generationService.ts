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
import { commitCanvasDelivery, planCanvasDelivery, type CanvasDeliveryPlan } from "../canvasDeliveryPlanner.js";
import { stableDeliveryId } from "../canvasDelivery.js";
import { resolveCanvasDeliveryContent, type CanvasDeliveryContract } from "./canvasDeliveryContent.js";
import { isDirectCanvasDeliveryIntent } from "./canvasDeliveryIntent.js";
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
    const agentCard = context.runtimeConfig.agentCard;
    let textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];
    const timeline = createRunTimelineBuilder({ threadId, locale: payload.locale });
    const timelineEvents: RunTimelineEvent[] = [];
    const deliveryId = stableCanvasDeliveryId(threadId, payload, storage);
    const publicReasoning = createPublicReasoningEmitter(payload.locale, callbacks.onReasoningToken);
    const emitTimeline = (event: RunTimelineEvent) => {
      timelineEvents.push(event);
      callbacks.onTimelineEvent?.(event);
    };
    const observeToolEvent = (event: ToolEventRecord) => {
      planOrchestrator.observe(threadId, event);
      callbacks.onToolEvent?.(event);
      publicReasoning.fromToolEvent(event);
      emitTimeline(timelineEventFromToolEvent(event) ?? toolEventToTimelineEvent(timeline, event));
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
    const progressiveDeliveryEvents = beginProgressiveCanvasDelivery({
      payload,
      threadId,
      projectId: selection.projectId,
      storage,
      deliveryId
    });
    for (const event of progressiveDeliveryEvents) {
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
          const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"), isMockFallbackEnabled(deps));
          runtimeEvents.push(...(normalized.events ?? []), event);
          observeToolEvent(event);
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
          const completed = timeline.event("run_completed", "completed", payload.locale === "zh" ? "运行完成" : "Run completed", payload.locale === "zh" ? "最终内容已生成。" : "Final content is ready.");
          emitTimeline(completed);
          const events = [...baseEvents, ...timelineEvents.map(timelineEventToToolEvent)];
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
      : "检测到明确 Canvas 交付请求，按“摘要分区 -> 正文 -> 来源”提交节点。"
    : delivery.moduleId === "diagram_delivery"
      ? "Detected an explicit Canvas diagram delivery request and committed editable diagram nodes."
      : "Detected an explicit Canvas delivery request and committed outline, body, and sources nodes."));
  const committed = commitCanvasDelivery(input.storage, input.projectId, delivery);
  for (const item of committed) {
    emit(timeline.event("canvas_node_committed", "completed", item.title, input.payload.locale === "zh" ? `已创建或更新节点：${item.title}` : `Created or updated node: ${item.title}`, { nodeId: item.nodeId, title: item.title }));
  }
  return { text: content.assistantText || input.text, timelineEvents: localTimelineEvents };
}

function beginProgressiveCanvasDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
}): ToolEventRecord[] {
  const instruction = input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "";
  if (!isDirectCanvasDeliveryIntent(instruction)) return [];
  if (readCanvasWorkflowMode(input.payload.contextValues) !== "batch_delivery") return [];
  const summaryTitle = input.payload.locale === "zh" ? "摘要分区" : "Summary";
  const bodyTitle = input.payload.locale === "zh" ? "正文" : "Body";
  const outlineContent = input.payload.locale === "zh" ? "# 摘要分区\n正在准备 Canvas 交付..." : "# Summary\nPreparing Canvas delivery...";
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
  item?: { nodeId: string; title: string }
): ToolEventRecord {
  return {
    eventType: eventType as ToolEventRecord["eventType"],
    payload: {
      eventType,
      tool: "canvas_delivery",
      deliveryId,
      status: /started$/.test(eventType) ? "running" : "committed",
      summary: locale === "zh" ? "Canvas 渐进交付已更新。" : "Progressive Canvas delivery updated.",
      ...(item ? { nodeId: item.nodeId, title: item.title } : {})
    }
  };
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
