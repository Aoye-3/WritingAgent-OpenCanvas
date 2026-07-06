import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { StreamStatus } from "../../agentRunLoop.js";
import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { ProjectRuntimeSettings, SQLiteStorageRepository } from "../../storage.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { KnowledgeService } from "../../knowledge/service.js";
import type { AgentRuntimePort } from "../../runtime/agentRuntimePort.js";
import type { AgentBackendRuntimeSignal } from "../../runtime/agentBackendAdapter/client.js";
import type { AgentRuntimeMemoryService } from "../agentRuntimeMemoryService.js";
import { createAgentBackendRuntimePort } from "../../runtime/agentBackendAdapter/index.js";
import { randomThreadId, safeId } from "../../utils/ids.js";
import type { AgentBackendRunnerDeps } from "./agentBackendRunner.js";
import { runAgentRuntimeGeneration } from "./agentRuntimeRunner.js";
import { mockText } from "./mockFallback.js";
import { isInternalOutputBlockedText, normalizeAgentRunOutput } from "./outputNormalizer.js";
import { buildGenerationRunContext } from "./promptRunBuilder.js";
import { createProgressiveTextGate } from "./progressiveTextGate.js";
import type { ProviderRunnerDeps } from "./providerRunner.js";
import { recordGenerationRun } from "./runRecorder.js";
import { resolveConfiguredModelApi, type ConfiguredModelApi } from "../../domains/model-config/index.js";
import { isConfiguredModelRuntimeReady } from "../../runtime/agentBackendAdapter/modelSync.js";
import { AgentPlanOrchestrator } from "../agentPlanOrchestrator.js";
import { resolveCanvasAction } from "./canvasActionPolicy.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";
import { resolveOrchestrationPolicy } from "./orchestrationPolicy.js";
import { commitCanvasDelivery, planCanvasDelivery, type CanvasDeliveryPlan } from "../canvasDeliveryPlanner.js";
import { stableDeliveryId } from "../canvasDelivery.js";
import { resolveCanvasDeliveryContent, type CanvasDeliveryContract } from "./canvasDeliveryContent.js";
import { isDirectCanvasDeliveryIntent } from "./canvasDeliveryIntent.js";
import { extractSourceLinks, formatSourceLinks, type SourceLink } from "./sourceLinks.js";
import {
  isCanvasEligibleTaskPolicy,
  isProcessClarificationText,
  resolveTaskHandlingPolicy
} from "./taskHandlingPolicy.js";
import { isCanvasWorkflowMode, type CanvasWorkflowMode } from "../../../shared/canvasWorkflow.js";
import { sanitizeCanvasForAgentIntake } from "../../../shared/agentIntakeCanvas.js";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol.js";
import { withSanitizedAgentIntakeCanvas } from "./agentIntakePolicy.js";
import {
  archiveMarkdownOutputFromRuntime,
  readArchivedMarkdownOutputSync,
  type ArchiveMarkdownOutput
} from "../threadOutputArchive.js";
import {
  createRunTimelineBuilder,
  safeDecisionTimelineEvent,
  timelineEventFromToolEvent,
  timelineEventToToolEvent,
  toolEventToTimelineEvent,
  type RunTimelineEvent
} from "./runTimeline.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createThreadDirectoryManager, resolveFacetWritePaths } from "../../storagePaths.js";

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
      onProgressEvent?: (event: AgentProgressEvent) => void;
    }
  ) => Promise<GenerateResponse>;
};

export type AgentProgressEvent = {
  id: string;
  threadId: string;
  runId?: string;
  stageId?: string;
  loopId?: string;
  loopIndex?: number;
  stepKind?: "intake" | "context" | "decide" | "act" | "observe" | "evaluate" | "checkpoint" | "complete" | "fail";
  actionId?: string;
  observationId?: string;
  completionStatus?: "continue" | "waiting" | "finalizing" | "completed" | "partial" | "failed";
  completionReasons?: string[];
  missingRequirements?: string[];
  phase?: string;
  status?: "running" | "completed" | "failed" | "waiting";
  title?: string;
  summary: string;
  next?: string;
  evidence?: Array<{
    kind: "tool" | "subagent" | "codegraph" | "search" | "file" | "runtime";
    label: string;
    ref?: string;
  }>;
  interventionHint?: string;
  visibility?: "stage" | "raw" | "public";
  source?: string;
  createdAt: string;
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
  archiveMarkdownOutput?: ArchiveMarkdownOutput;
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
  low: { runtimeBudgetProfile: "low", recursionLimit: 80, modelCallLimit: 18, evidenceToolLimit: 8, bodyDraftWriteLimit: 2, synthesisReserveSteps: 16 },
  medium: { runtimeBudgetProfile: "medium", recursionLimit: 110, modelCallLimit: 24, evidenceToolLimit: 12, bodyDraftWriteLimit: 3, synthesisReserveSteps: 22 },
  high: { runtimeBudgetProfile: "high", recursionLimit: 140, modelCallLimit: 32, evidenceToolLimit: 16, bodyDraftWriteLimit: 4, synthesisReserveSteps: 28 }
};

export function createGenerationService(
  storage: SQLiteStorageRepository,
  agentRuntime: AgentRuntimeAdapter,
  deps: GenerationServiceDeps = {}
): GenerationService {
  const executionRuntime = deps.agentRuntime ?? (deps.agentBackend ? createAgentBackendRuntimePort(deps.agentBackend) : undefined);
  const agentPlanOrchestrator = new AgentPlanOrchestrator(storage);

  async function generateAndRecord(payload: GenerateRequest, onToolEvent?: (event: ToolEventRecord) => void): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    markAnsweredAgentClarification(storage, threadId, payload);
    payload = withOrchestrationPolicy(withCanvasAction(payload, threadId, storage));
    const selection = await prepareThreadModelSelection(payload, threadId, storage, deps.modelRuntime);
    const projectRuntimeSettings = storage.getProjectRuntimeSettings(selection.projectId);
    payload = withAutoPreflightPlan(payload, threadId, projectRuntimeSettings, agentPlanOrchestrator);
    payload = withPlanGeneration(payload, threadId, storage);
    payload = withSkillClarificationGuard(payload, threadId, projectRuntimeSettings);
    payload = withSanitizedAgentIntakeCanvas(payload);
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge, selection.configuredModel);
    payload = withTaskHandlingPolicy(payload, context);
    payload = withRuntimeContext(payload, context.canvasDeliveryContract);
    payload = withProgressiveCanvasDeliveryContext(payload, context, projectRuntimeSettings);
    const agentCard = context.runtimeConfig.agentCard;
    const runtimeEvents: ToolEventRecord[] = [...context.knowledgeEvents];
    const timeline = createRunTimelineBuilder({ threadId, locale: payload.locale });
    const timelineEvents: RunTimelineEvent[] = [];
    const deliveryId = stableCanvasDeliveryId(threadId, payload, storage);
    let researchDeliverySequence = 0;
    let bodyDraftWriteCount = 0;
    let progressiveDeliveryStarted = false;
    let progressiveSynthesisStarted = false;
    const progressiveEvidenceEntries: ProgressiveEvidenceEntry[] = [];
    const emitTimeline = (event: RunTimelineEvent) => {
      timelineEvents.push(event);
    };
    const emitRuntimeToolEvent = (event: ToolEventRecord) => {
      agentPlanOrchestrator.observe(threadId, event);
      emitTimeline(timelineEventFromToolEvent(event) ?? toolEventToTimelineEvent(timeline, event));
      onToolEvent?.(event);
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
      const observed = withAgentPlanEventContext(withAgentClarificationResumeContext(event, payload, deliveryId), payload);
      if (!runtimeEvents.includes(observed)) runtimeEvents.push(observed);
      emitRuntimeToolEvent(observed);
      if (isProgressiveToolCompletion(observed)) ensureProgressiveDeliveryStarted();
      const researchEvents = commitProgressiveResearchDelivery({
        payload,
        threadId,
        projectId: selection.projectId,
        storage,
        deliveryId,
        event: observed,
        onEvidenceEntry: (entry) => progressiveEvidenceEntries.push(entry),
        nextSequence: () => {
          researchDeliverySequence += 1;
          return researchDeliverySequence;
        }
      });
      const budget = researchEvents.length ? readProgressiveDeliveryBudget(payload) : undefined;
      const evidenceCount = progressiveEvidenceEntries.length;
      const enrichedResearchEvents = budget ? researchEvents.map((researchEvent) => withCanvasDeliveryProgressMetadata(researchEvent, {
        researchIndex: readCanvasDeliveryResearchIndex(researchEvent),
        evidenceCount,
        bodyDraftWriteCount,
        bodyDraftWriteLimit: budget.bodyDraftWriteLimit,
        evidenceToolLimit: budget.evidenceToolLimit,
        nextPhaseHint: progressiveEvidenceEntries.length >= budget.evidenceToolLimit || progressiveSynthesisStarted
          ? "synthesis_ready"
          : bodyDraftWriteCount < budget.bodyDraftWriteLimit ? "body_checkpoint" : "continue_research"
      })) : researchEvents;
      for (const researchEvent of enrichedResearchEvents) {
        runtimeEvents.push(researchEvent);
        emitRuntimeToolEvent(researchEvent);
      }
      if (budget && researchEvents.length && !progressiveSynthesisStarted) {
        if (bodyDraftWriteCount < budget.bodyDraftWriteLimit) {
          const bodyEvents = commitProgressiveBodyCheckpointDelivery({
            payload,
            projectId: selection.projectId,
            storage,
            deliveryId,
            entries: progressiveEvidenceEntries,
            draftIndex: bodyDraftWriteCount + 1,
            draftLimit: budget.bodyDraftWriteLimit
          });
          const nextBodyDraftWriteCount = bodyDraftWriteCount + (bodyEvents.length ? 1 : 0);
          if (bodyEvents.length) bodyDraftWriteCount = nextBodyDraftWriteCount;
          const enrichedBodyEvents = bodyEvents.map((bodyEvent) => withCanvasDeliveryProgressMetadata(bodyEvent, {
            bodyDraftWriteCount: nextBodyDraftWriteCount,
            bodyDraftWriteLimit: budget.bodyDraftWriteLimit,
            evidenceToolLimit: budget.evidenceToolLimit,
            nextPhaseHint: progressiveEvidenceEntries.length >= budget.evidenceToolLimit ? "synthesis_ready" : "continue_research"
          }));
          for (const bodyEvent of enrichedBodyEvents) {
            runtimeEvents.push(bodyEvent);
            emitRuntimeToolEvent(bodyEvent);
          }
        }
        if (progressiveEvidenceEntries.length >= budget.evidenceToolLimit) {
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
    const directCanvasIntent = isDirectCanvasDeliveryIntent(payload.chatInstruction ?? payload.freeTextPrompt ?? "");
    if (!directCanvasIntent && !isSkillClarificationGuarded(payload) && shouldStartProgressiveCanvasDeliveryImmediately(payload, context)) ensureProgressiveDeliveryStarted();
    try {
      agentPlanOrchestrator.prepare(threadId, payload);
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
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        const normalizedEvents = (normalized.events ?? []).map((event) => withAgentPlanEventContext(withAgentClarificationResumeContext(event, payload, deliveryId), payload));
        const blockedInternalOutput = hasBlockedInternalOutput(normalized.events);
        const visibleText = blockedInternalOutput ? visibleTextAfterInternalOutputBlock(normalized.text, payload.locale) : normalized.text;
        const baseEvents = dedupeToolEvents([...runtimeEvents, ...normalizedEvents]);
        if (isBlockingAgentClarificationRun(baseEvents, visibleText, agentBackendRun.finishReason)) {
          markPlanWaitingForAgentClarification(storage, threadId, payload, baseEvents);
          agentPlanOrchestrator.complete(threadId, payload, baseEvents);
          return recordGenerationRun({
            storage,
            payload,
            threadId,
            agentCardId: agentCard.id,
            agentTitle: agentCard.title[payload.locale],
            configuredModelApiId: context.modelSettings.configuredModelApiId,
            modelId: context.modelSettings.model,
            mode: context.mode,
            prompt: context.prompt,
            text: "",
            provider: "agent-backend",
            usedMock: false,
            toolState: context.effectiveToolState,
            events: baseEvents,
            finishReason: "clarification_required",
            runtimeRunId: agentBackendRun.runtimeRunId,
            runtimeThreadId: agentBackendRun.runtimeThreadId,
            usage: agentBackendRun.usage
          });
        }
        const finalized = finalizeCanvasDelivery({
          payload,
          threadId,
          projectId: selection.projectId,
          storage,
          deliveryId,
          text: visibleText,
          events: baseEvents,
          timeline,
          emitTimeline
        });
        const progressiveFinalized = await finalizeProgressiveCanvasDelivery({
          payload,
          threadId,
          projectId: selection.projectId,
          storage,
          deliveryId,
          text: finalized.text || visibleText,
          events: baseEvents,
          timeline,
          emitTimeline,
          archiveMarkdownOutput: deps.archiveMarkdownOutput
        });
        for (const finalEvent of progressiveFinalized.events) {
          emitRuntimeToolEvent(finalEvent);
        }
        const completed = timeline.event("run_completed", "completed", payload.locale === "zh" ? "运行完成" : "Run completed", payload.locale === "zh" ? "最终内容已生成。" : "Final content is ready.");
        emitTimeline(completed);
        const events = [...baseEvents, ...progressiveFinalized.events, ...timelineEvents.map(timelineEventToToolEvent)];
        agentPlanOrchestrator.assertPostcondition(threadId, payload, events);
        agentPlanOrchestrator.complete(threadId, payload, events);
        const finishReason = finalFinishReason(agentBackendRun.finishReason, events);
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
          finishReason,
          runtimeRunId: agentBackendRun.runtimeRunId,
          runtimeThreadId: agentBackendRun.runtimeThreadId,
          usage: agentBackendRun.usage
        });
        return recorded;
      } else {
        const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend is disabled or unavailable"), isMockFallbackEnabled(deps));
        runtimeEvents.push(event);
        observeToolEvent(event);
      }
    } catch (error) {
      agentPlanOrchestrator.fail(threadId, payload, error);
      if (!directCanvasIntent && isProgressiveCanvasDeliveryEnabled(payload)) {
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
      events: [...runtimeEvents, ...timelineEvents.map(timelineEventToToolEvent)]
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
      onProgressEvent?: (event: AgentProgressEvent) => void;
    } = {}
  ): Promise<GenerateResponse> {
    const threadId = safeId(payload.threadId) ?? randomThreadId();
    markAnsweredAgentClarification(storage, threadId, payload);
    payload = withOrchestrationPolicy(withCanvasAction(payload, threadId, storage));
    const selection = await prepareThreadModelSelection(payload, threadId, storage, deps.modelRuntime);
    const projectRuntimeSettings = storage.getProjectRuntimeSettings(selection.projectId);
    payload = withAutoPreflightPlan(payload, threadId, projectRuntimeSettings, agentPlanOrchestrator);
    payload = withPlanGeneration(payload, threadId, storage);
    payload = withSkillClarificationGuard(payload, threadId, projectRuntimeSettings);
    payload = withSanitizedAgentIntakeCanvas(payload);
    const context = await buildGenerationRunContext(payload, threadId, storage, agentRuntime, deps.knowledge, selection.configuredModel);
    payload = withTaskHandlingPolicy(payload, context);
    payload = withRuntimeContext(payload, context.canvasDeliveryContract);
    payload = withProgressiveCanvasDeliveryContext(payload, context, projectRuntimeSettings);
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
    let lastCanvasCommitAt: number | undefined;
    let runtimeHeartbeatTimelineEmitted = false;
    let runtimeWaitingForUser = false;
    let lastModelErrorSignal: AgentBackendRuntimeSignal | undefined;
    let runtimeFailureError: unknown;
    let runFailedTimelineEmitted = false;
    const suppressedInvalidClarifications: ToolEventRecord[] = [];
    let suppressedInvalidClarificationsEmitted = false;
    const progressiveEvidenceEntries: ProgressiveEvidenceEntry[] = [];
    const emitTimeline = (event: RunTimelineEvent) => {
      timelineEvents.push(event);
      callbacks.onTimelineEvent?.(event);
    };
    const stageProgress = createStageProgressEmitter({
      locale: payload.locale,
      threadId,
      timeline,
      agentPlanPayload: agentPlanPayload(payload),
      onProgressEvent: callbacks.onProgressEvent,
      emitTimeline
    });
    stageProgress.emit(
      "run:preparing",
      payload.locale === "zh" ? "正在准备任务上下文、工具和运行环境。" : "Preparing task context, tools, and runtime.",
      payload.locale === "zh" ? "你可以继续输入补充要求；默认会排队，选择介入后会在安全点生效。" : "You can add guidance while it runs; it queues by default and applies at a safe point when requested.",
      {
        phase: "preparing",
        title: payload.locale === "zh" ? "准备执行" : "Preparing run",
        interventionHint: payload.locale === "zh" ? "可补充目标、范围或格式要求。" : "You may add goal, scope, or format constraints."
      }
    );
    const emitRuntimeToolEvent = (event: ToolEventRecord) => {
      agentPlanOrchestrator.observe(threadId, event);
      callbacks.onToolEvent?.(event);
      stageProgress.fromToolEvent(event);
      emitTimeline(timelineEventFromToolEvent(event) ?? toolEventToTimelineEvent(timeline, event));
    };
    const emitSuppressedInvalidClarifications = () => {
      if (suppressedInvalidClarificationsEmitted) return;
      suppressedInvalidClarificationsEmitted = true;
      for (const event of suppressedInvalidClarifications) emitRuntimeToolEvent(event);
    };
    const observeRuntimeSignal = (signal: AgentBackendRuntimeSignal) => {
      if (signal.type === "run_metadata" || signal.type === "agent_progress_reported" || signal.type === "agent_intervention_checkpoint") {
        if (signal.type === "agent_progress_reported" && signal.payload?.status !== "waiting") runtimeWaitingForUser = false;
        stageProgress.fromRuntimeSignal(signal);
        return;
      }
      if (signal.type === "waiting_for_user") {
        runtimeWaitingForUser = true;
        lastCanvasCommitAt = undefined;
        runtimeHeartbeatTimelineEmitted = false;
        emitTimeline(timeline.event(
          "decision",
          "waiting",
          payload.locale === "zh" ? "等待用户选择" : "Waiting for your choice",
          signal.label,
            { ...agentPlanPayload(payload), signal: signal.type, ...(signal.payload ?? {}) }
        ));
        return;
      }
      if (signal.type === "heartbeat") {
        if (runtimeWaitingForUser) return;
        if (lastCanvasCommitAt && !runtimeHeartbeatTimelineEmitted) {
          runtimeHeartbeatTimelineEmitted = true;
          emitTimeline(timeline.event(
            "decision",
            "running",
            payload.locale === "zh" ? "Agent Runtime 仍在运行" : "Agent Runtime active",
            payload.locale === "zh" ? "Canvas 已更新，正在等待下一次模型决策或工具调用。" : "Canvas is updated; waiting for the next model decision or tool call.",
            {
              ...agentPlanPayload(payload),
              signal: "canvas_committed_runtime_still_active",
              runtimeSignal: signal.type,
              elapsedMsSinceCanvasCommit: Date.now() - lastCanvasCommitAt
            }
          ));
        }
        return;
      }
      if (signal.type === "llm_call_error") {
        lastModelErrorSignal = signal;
      }
      runtimeWaitingForUser = false;
      if (lastCanvasCommitAt) {
        lastCanvasCommitAt = undefined;
        runtimeHeartbeatTimelineEmitted = false;
      }
      const signalReason = typeof signal.payload?.reason === "string" ? signal.payload.reason : "";
      const activeTitle = signal.type === "llm_call_start"
        ? (payload.locale === "zh" ? "等待模型返回" : "Waiting for model response")
        : signal.type === "llm_call_end"
          ? (payload.locale === "zh" ? "模型已返回" : "Model response received")
          : signal.type === "llm_call_error"
            ? signalReason === "stream_chunk_timeout"
              ? (payload.locale === "zh" ? "模型流式超时" : "Model stream timeout")
              : (payload.locale === "zh" ? "模型请求异常" : "Model request error")
            : signal.type === "synthesis_gate"
              ? (payload.locale === "zh" ? "最终综合中" : "Final synthesis")
              : signal.type === "thinking_disabled_for_tool_choice_compatibility"
                ? (payload.locale === "zh" ? "已关闭本轮思考" : "Thinking disabled for tool call")
                : (payload.locale === "zh" ? "模型请求重试" : "Model request retry");
      emitTimeline(timeline.event(
        "decision",
        signal.type === "llm_call_end" ? "completed" : "waiting",
        activeTitle,
        signal.label,
        { ...agentPlanPayload(payload), signal: signal.type, ...(signal.payload ?? {}) }
      ));
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
    const observeToolEventForPayload = (event: ToolEventRecord, eventPayload: GenerateRequest) => {
      const observed = withAgentPlanEventContext(withAgentClarificationResumeContext(event, eventPayload, deliveryId), eventPayload);
      if (!runtimeEvents.includes(observed)) runtimeEvents.push(observed);
      if (isInvalidAgentClarificationEvent(observed)) {
        suppressedInvalidClarifications.push(observed);
        return;
      }
      emitRuntimeToolEvent(observed);
      if (isAgentClarificationEvent(observed)) {
        runtimeWaitingForUser = true;
        lastCanvasCommitAt = undefined;
        runtimeHeartbeatTimelineEmitted = false;
      } else {
        runtimeWaitingForUser = false;
      }
      if (isCanvasCommitEvent(observed)) {
        lastCanvasCommitAt = Date.now();
        runtimeHeartbeatTimelineEmitted = false;
      }
      if (lastCanvasCommitAt && (/(?:^|_)tool_started$/.test(observed.eventType) || observed.eventType === "agent_backend_agent_intake_complete")) {
        emitTimeline(timeline.event(
          "decision",
          "completed",
          payload.locale === "zh" ? "下一轮工具调用开始" : "Next tool call started",
          payload.locale === "zh" ? "Canvas 更新后的静默间隔已结束。" : "The quiet interval after the Canvas update ended.",
          { ...agentPlanPayload(payload), elapsedMsSinceCanvasCommit: Date.now() - lastCanvasCommitAt }
        ));
        lastCanvasCommitAt = undefined;
        runtimeHeartbeatTimelineEmitted = false;
      }
      if (isProgressiveToolCompletion(observed)) ensureProgressiveDeliveryStarted();
      const researchEvents = commitProgressiveResearchDelivery({
        payload,
        threadId,
        projectId: selection.projectId,
        storage,
        deliveryId,
        event: observed,
        onEvidenceEntry: (entry) => progressiveEvidenceEntries.push(entry),
        nextSequence: () => {
          researchDeliverySequence += 1;
          return researchDeliverySequence;
        }
      });
      const budget = researchEvents.length ? readProgressiveDeliveryBudget(payload) : undefined;
      const evidenceCount = progressiveEvidenceEntries.length;
      const enrichedResearchEvents = budget ? researchEvents.map((researchEvent) => withCanvasDeliveryProgressMetadata(researchEvent, {
        researchIndex: readCanvasDeliveryResearchIndex(researchEvent),
        evidenceCount,
        bodyDraftWriteCount,
        bodyDraftWriteLimit: budget.bodyDraftWriteLimit,
        evidenceToolLimit: budget.evidenceToolLimit,
        nextPhaseHint: progressiveEvidenceEntries.length >= budget.evidenceToolLimit || progressiveSynthesisStarted
          ? "synthesis_ready"
          : bodyDraftWriteCount < budget.bodyDraftWriteLimit ? "body_checkpoint" : "continue_research"
      })) : researchEvents;
      for (const researchEvent of enrichedResearchEvents) {
        runtimeEvents.push(researchEvent);
        emitRuntimeToolEvent(researchEvent);
      }
      if (budget && researchEvents.length && !progressiveSynthesisStarted) {
        if (bodyDraftWriteCount < budget.bodyDraftWriteLimit) {
          const bodyEvents = commitProgressiveBodyCheckpointDelivery({
            payload,
            projectId: selection.projectId,
            storage,
            deliveryId,
            entries: progressiveEvidenceEntries,
            draftIndex: bodyDraftWriteCount + 1,
            draftLimit: budget.bodyDraftWriteLimit
          });
          const nextBodyDraftWriteCount = bodyDraftWriteCount + (bodyEvents.length ? 1 : 0);
          if (bodyEvents.length) bodyDraftWriteCount = nextBodyDraftWriteCount;
          const enrichedBodyEvents = bodyEvents.map((bodyEvent) => withCanvasDeliveryProgressMetadata(bodyEvent, {
            bodyDraftWriteCount: nextBodyDraftWriteCount,
            bodyDraftWriteLimit: budget.bodyDraftWriteLimit,
            evidenceToolLimit: budget.evidenceToolLimit,
            nextPhaseHint: progressiveEvidenceEntries.length >= budget.evidenceToolLimit ? "synthesis_ready" : "continue_research"
          }));
          for (const bodyEvent of enrichedBodyEvents) {
            runtimeEvents.push(bodyEvent);
            emitRuntimeToolEvent(bodyEvent);
          }
        }
        if (progressiveEvidenceEntries.length >= budget.evidenceToolLimit) {
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
    const emitRunFailedTimeline = (error: unknown) => {
      if (runFailedTimelineEmitted) return;
      runFailedTimelineEmitted = true;
      emitTimeline(timeline.event("run_failed", "failed", payload.locale === "zh" ? "运行失败" : "Run failed", safeRuntimeErrorMessage(error, lastModelErrorSignal), { ...agentPlanPayload(payload), ...budgetStatusPayload(error) }));
    };
    const observeToolEvent = (event: ToolEventRecord) => observeToolEventForPayload(event, payload);
    for (const event of canvasActionEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }
    for (const event of planPhaseEvents(payload)) {
      runtimeEvents.push(event);
      observeToolEvent(event);
    }

    callbacks.onStatus?.({ phase: "thinking", label: streamLabels.thinking });
    emitTimeline(timeline.event("phase_started", "running", payload.locale === "zh" ? "准备执行" : "Preparing run", payload.locale === "zh" ? "正在准备上下文、工具和运行环境。" : "Preparing context, tools, and runtime.", agentPlanPayload(payload)));
    if (context.transientSkillNames.length) {
      emitTimeline(skillUsageTimelineEvent(timeline, payload.locale, context.transientSkillNames));
    }
    if (!isSkillClarificationGuarded(payload) && shouldStartProgressiveCanvasDeliveryImmediately(payload, context)) ensureProgressiveDeliveryStarted();

    try {
      agentPlanOrchestrator.prepare(threadId, payload);
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
        onStatus: callbacks.onStatus,
        onRuntimeSignal: observeRuntimeSignal
      }, executionRuntime);

      if (agentBackendRun) {
        const normalized = normalizeAgentRunOutput({
          text: agentBackendRun.text,
          locale: payload.locale,
          source: "agent-backend",
          events: agentBackendRun.events
        });
        const normalizedEvents = (normalized.events ?? []).map((event) => withAgentPlanEventContext(withAgentClarificationResumeContext(event, payload, deliveryId), payload));
        const blockedInternalOutput = hasBlockedInternalOutput(normalized.events);
        const visibleText = blockedInternalOutput ? visibleTextAfterInternalOutputBlock(normalized.text, payload.locale) : normalized.text;
        const baseEvents = dedupeToolEvents([...runtimeEvents, ...normalizedEvents]);
        if (blockedInternalOutput) {
          textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
          if (visibleText) textGate.push(visibleText);
          textGate.flush();
        } else {
          textGate.flush();
        }
          callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
          stageProgress.emit(
            "run:finalizing",
            payload.locale === "zh" ? "正在整理最终回答，并校准 Canvas 节点内容。" : "Organizing the final answer and reconciling Canvas nodes.",
            payload.locale === "zh" ? "下一步会给出最终答复和可查看的交付物。" : "Next, the final answer and deliverables will be ready.",
            { phase: "finalizing", title: payload.locale === "zh" ? "最终整理" : "Final review" }
          );
          if (shouldRepairAgentClarification(baseEvents, visibleText, agentBackendRun.finishReason)) {
            callbacks.onStatus?.({ phase: "thinking", label: payload.locale === "zh" ? "正在重新生成澄清选项..." : "Regenerating clarification choices..." });
            const repairPayload = withAgentClarificationRepairPolicy(payload, latestInvalidAgentClarificationEvent(baseEvents));
            const repairRun = await runAgentRuntimeGeneration({
              payload: repairPayload,
              threadId,
              projectId: selection.projectId,
              configuredModelApiId: context.modelSettings.configuredModelApiId!,
              modelSettings: context.modelSettings,
              runtimeConfig: context.runtimeConfig,
              messages: context.messages,
              prompt: context.prompt,
              onToolEvent: (event) => observeToolEventForPayload(event, repairPayload),
              onReasoningToken: callbacks.onReasoningToken,
              onStatus: callbacks.onStatus,
              onRuntimeSignal: observeRuntimeSignal
            }, executionRuntime);
            if (repairRun) {
              const repairNormalized = normalizeAgentRunOutput({
                text: repairRun.text,
                locale: payload.locale,
                source: "agent-backend",
                events: repairRun.events
              });
              const repairedBaseEvents = dedupeToolEvents([
                ...runtimeEvents.filter((event) => !isInvalidAgentClarificationEvent(event)),
                ...(repairNormalized.events ?? []).map((event) => withAgentPlanEventContext(withAgentClarificationResumeContext(event, repairPayload, deliveryId), repairPayload))
              ]);
              if (hasAgentClarificationEvent(repairedBaseEvents) && isBlockingAgentClarificationRun(repairedBaseEvents, repairNormalized.text, repairRun.finishReason)) {
                textGate.flush();
                callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
                const events = [...repairedBaseEvents, ...timelineEvents.map(timelineEventToToolEvent)];
                agentPlanOrchestrator.complete(threadId, payload, events);
                return recordGenerationRun({
                  storage,
                  payload,
                  threadId,
                  agentCardId: agentCard.id,
                  agentTitle: agentCard.title[payload.locale],
                  configuredModelApiId: context.modelSettings.configuredModelApiId,
                  modelId: context.modelSettings.model,
                  mode: context.mode,
                  prompt: context.prompt,
                  text: "",
                  provider: "agent-backend",
                  usedMock: false,
                  toolState: context.effectiveToolState,
                  events,
                  finishReason: "clarification_required",
                  runtimeRunId: repairRun.runtimeRunId ?? agentBackendRun.runtimeRunId,
                  runtimeThreadId: repairRun.runtimeThreadId ?? agentBackendRun.runtimeThreadId,
                  usage: repairRun.usage ?? agentBackendRun.usage
                });
              }
            }
            emitSuppressedInvalidClarifications();
          }
          if (isBlockingAgentClarificationRun(baseEvents, visibleText, agentBackendRun.finishReason)) {
            textGate.flush();
            callbacks.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
            const events = [...baseEvents, ...timelineEvents.map(timelineEventToToolEvent)];
            markPlanWaitingForAgentClarification(storage, threadId, payload, events);
            agentPlanOrchestrator.complete(threadId, payload, events);
            return recordGenerationRun({
              storage,
              payload,
              threadId,
              agentCardId: agentCard.id,
              agentTitle: agentCard.title[payload.locale],
              configuredModelApiId: context.modelSettings.configuredModelApiId,
              modelId: context.modelSettings.model,
              mode: context.mode,
              prompt: context.prompt,
              text: "",
              provider: "agent-backend",
              usedMock: false,
              toolState: context.effectiveToolState,
              events,
              finishReason: "clarification_required",
              runtimeRunId: agentBackendRun.runtimeRunId,
              runtimeThreadId: agentBackendRun.runtimeThreadId,
              usage: agentBackendRun.usage
            });
          }
          const finalized = finalizeCanvasDelivery({
            payload,
            threadId,
            projectId: selection.projectId,
            storage,
            deliveryId,
            text: visibleText,
            events: baseEvents,
            timeline,
            emitTimeline
          });
          const progressiveFinalized = await finalizeProgressiveCanvasDelivery({
            payload,
            threadId,
            projectId: selection.projectId,
            storage,
            deliveryId,
            text: finalized.text || visibleText,
            events: baseEvents,
            timeline,
            emitTimeline,
            archiveMarkdownOutput: deps.archiveMarkdownOutput
          });
          for (const finalEvent of progressiveFinalized.events) {
            emitRuntimeToolEvent(finalEvent);
          }
          const completed = timeline.event("run_completed", "completed", payload.locale === "zh" ? "运行完成" : "Run completed", payload.locale === "zh" ? "最终内容已生成。" : "Final content is ready.");
          emitTimeline(completed);
          const events = [...baseEvents, ...progressiveFinalized.events, ...timelineEvents.map(timelineEventToToolEvent)];
          agentPlanOrchestrator.assertPostcondition(threadId, payload, events);
          agentPlanOrchestrator.complete(threadId, payload, events);
          const finishReason = finalFinishReason(agentBackendRun.finishReason, events);
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
            finishReason,
            runtimeRunId: agentBackendRun.runtimeRunId,
            runtimeThreadId: agentBackendRun.runtimeThreadId,
            usage: agentBackendRun.usage
          });
          return recorded;
      } else {
        runtimeFailureError = new Error("AgentBackend is disabled or unavailable");
        const event = createRuntimeFallbackEvent("agent-backend", runtimeFailureError, isMockFallbackEnabled(deps));
        runtimeEvents.push(event);
        observeToolEvent(event);
        emitRunFailedTimeline(runtimeFailureError);
      }
    } catch (error) {
      runtimeFailureError = error;
      agentPlanOrchestrator.fail(threadId, payload, error);
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
      const event = createRuntimeFallbackEvent("agent-backend", error, isMockFallbackEnabled(deps), lastModelErrorSignal);
      runtimeEvents.push(event);
      observeToolEvent(event);
      emitRunFailedTimeline(error);
      textGate = createProgressiveTextGate(payload.locale, callbacks.onToken);
    }

    if (!isMockFallbackEnabled(deps)) {
      const events = dedupeToolEvents([...runtimeEvents, ...timelineEvents.map(timelineEventToToolEvent)]);
      const errorMessage = formatGenerationFailure(runtimeEvents);
      const failureStatus = runtimeFailureError ? budgetStatusPayload(runtimeFailureError)?.status : undefined;
      return recordGenerationRun({
        storage,
        payload,
        threadId,
        agentCardId: agentCard.id,
        agentTitle: agentCard.title[payload.locale],
        configuredModelApiId: context.modelSettings.configuredModelApiId,
        modelId: context.modelSettings.model,
        mode: context.mode,
        prompt: context.prompt,
        text: "",
        provider: "agent-backend",
        usedMock: false,
        toolState: context.effectiveToolState,
        events,
        finishReason: failureStatus === "budget_exhausted" ? "budget_exhausted" : "runtime_failed",
        errorMessage
      });
    }
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

function progressEventFromRuntimeSignal(signal: AgentBackendRuntimeSignal, threadId: string): AgentProgressEvent | undefined {
  const payload = record(signal.payload);
  const visibility = readProgressVisibility(payload.visibility);
  const summary = safeProgressText(readString(payload.summary) || signal.label);
  if (!summary) return undefined;
  if (visibility !== "raw" && isLowValueRuntimeProgress(summary, readString(payload.phase), signal.type)) return undefined;
  const status = readProgressStatus(payload.status);
  return {
    id: `progress_${crypto.randomUUID()}`,
    threadId: readString(payload.threadId) || threadId,
    ...(readString(payload.runId) ? { runId: readString(payload.runId) } : {}),
    ...(readString(payload.stageId) ? { stageId: readString(payload.stageId) } : {}),
    ...(readString(payload.loopId) ? { loopId: readString(payload.loopId) } : {}),
    ...(readOptionalNumber(payload.loopIndex) !== undefined ? { loopIndex: readOptionalNumber(payload.loopIndex) } : {}),
    ...(readStepKind(payload.stepKind) ? { stepKind: readStepKind(payload.stepKind) } : {}),
    ...(readString(payload.actionId) ? { actionId: readString(payload.actionId) } : {}),
    ...(readString(payload.observationId) ? { observationId: readString(payload.observationId) } : {}),
    ...(readCompletionStatus(payload.completionStatus) ? { completionStatus: readCompletionStatus(payload.completionStatus) } : {}),
    ...(readStringList(payload.completionReasons).length ? { completionReasons: readStringList(payload.completionReasons) } : {}),
    ...(readStringList(payload.missingRequirements).length ? { missingRequirements: readStringList(payload.missingRequirements) } : {}),
    ...(readString(payload.phase) ? { phase: readString(payload.phase) } : {}),
    ...(status ? { status } : {}),
    ...(readString(payload.title) ? { title: safeProgressText(readString(payload.title)) } : {}),
    summary,
    ...(readString(payload.next) ? { next: safeProgressText(readString(payload.next)) } : {}),
    ...(readProgressEvidence(payload.evidence).length ? { evidence: readProgressEvidence(payload.evidence) } : {}),
    ...(readString(payload.interventionHint) ? { interventionHint: safeProgressText(readString(payload.interventionHint)) } : {}),
    visibility: visibility ?? "stage",
    ...(readString(payload.source) ? { source: readString(payload.source) } : {}),
    createdAt: readString(payload.createdAt) || new Date().toISOString()
  };
}

function safeProgressText(value: string) {
  if (isSentinelText(value)) return "";
  if (/prompt|reasoning|chain[_\s-]?of[_\s-]?thought|arguments?|contextValues|api.?key|token|secret|password/i.test(value)) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 360);
}

function readProgressStatus(value: unknown): AgentProgressEvent["status"] | undefined {
  return value === "running" || value === "completed" || value === "failed" || value === "waiting" ? value : undefined;
}

function readProgressVisibility(value: unknown): AgentProgressEvent["visibility"] | undefined {
  return value === "stage" || value === "raw" || value === "public" ? value : undefined;
}

function readProgressEvidence(value: unknown): NonNullable<AgentProgressEvent["evidence"]> {
  if (!Array.isArray(value)) return [];
  const evidence: NonNullable<AgentProgressEvent["evidence"]> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const label = safeProgressText(item);
      if (label) evidence.push({ kind: "runtime", label: label.slice(0, 120) });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const source = item as Record<string, unknown>;
      const kind = readProgressEvidenceKind(source.kind);
      const label = safeProgressText(readString(source.label)).slice(0, 120);
      const ref = safeProgressText(readString(source.ref)).slice(0, 160);
      if (kind && label) evidence.push({ kind, label, ...(ref ? { ref } : {}) });
    }
    if (evidence.length >= 5) break;
  }
  return evidence;
}

function readProgressEvidenceKind(value: unknown): NonNullable<AgentProgressEvent["evidence"]>[number]["kind"] | undefined {
  return value === "tool" || value === "subagent" || value === "codegraph" || value === "search" || value === "file" || value === "runtime"
    ? value
    : undefined;
}

function readStepKind(value: unknown): AgentProgressEvent["stepKind"] | undefined {
  return value === "intake" || value === "context" || value === "decide" || value === "act" || value === "observe" || value === "evaluate" || value === "checkpoint" || value === "complete" || value === "fail"
    ? value
    : undefined;
}

function readCompletionStatus(value: unknown): AgentProgressEvent["completionStatus"] | undefined {
  return value === "continue" || value === "waiting" || value === "finalizing" || value === "completed" || value === "partial" || value === "failed"
    ? value
    : undefined;
}

function readOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isLowValueRuntimeProgress(summary: string, phase: string, signalType: AgentBackendRuntimeSignal["type"]) {
  if (signalType === "run_metadata") return true;
  if (phase === "intervention" && /intervention|instruction|constraint/i.test(summary)) return false;
  if (signalType === "agent_intervention_checkpoint") return true;
  return /^(?:Agent runtime run opened\.?|Agent run started\.?|Agent runtime is ready\.?|Preparing the next model step\.?|Model step completed\.?|Using .+\.?|.+ completed\.?|Agent reached a safe point .*|Agent is deciding the next action.*|Agent is running .+\.?|.+ returned an observation for the next decision\.?)$/i.test(summary);
}

function hasBlockedInternalOutput(events?: ToolEventRecord[]) {
  return events?.some((event) => event.eventType === "internal_output_blocked") ?? false;
}

function visibleTextAfterInternalOutputBlock(text: string, locale: GenerateRequest["locale"]) {
  if (
    isInternalOutputBlockedText(text, locale)
    || isInternalOutputBlockedText(text, "en")
    || isInternalOutputBlockedText(text, "zh")
  ) {
    return "";
  }
  return text;
}

function hasVisibleAgentDeliveryEvidence(text: string, events: ToolEventRecord[]) {
  if (
    hasBlockedInternalOutput(events)
    && (
      isInternalOutputBlockedText(text, "en")
      || isInternalOutputBlockedText(text, "zh")
    )
  ) {
    return false;
  }
  if (text.trim()) return true;
  if (outputMarkdownPathsFromEvents(events).length > 0) return true;
  return events.some((event) => {
    if (event.eventType === "internal_output_blocked") return false;
    if (event.eventType === "canvas_delivery_failed_summary_committed") return false;
    if (isFinalCanvasDeliveryEvidence(event)) return true;
    if (isAgentClarificationEvent(event)) return true;
    if (/(?:^|_)artifact_(?:staged|committed)$/.test(event.eventType)) return true;
    if (/(?:^|_)tool_completed$/.test(event.eventType)) {
      const payload = record(event.payload);
      const toolName = readString(payload.toolName) || readString(payload.tool);
      return toolName === "write_file" || toolName === "present_files";
    }
    return false;
  });
}

function isFinalCanvasDeliveryEvidence(event: ToolEventRecord) {
  return /^canvas_delivery_(?:body_final|file_document|clarification)_committed$/.test(event.eventType)
    || /(?:^|_)canvas_mutation_committed$/.test(event.eventType)
    || /(?:^|_)canvas_node_committed$/.test(event.eventType);
}

function createRuntimeFallbackEvent(source: "agent-backend", error: unknown, mockFallbackEnabled: boolean, modelErrorSignal?: AgentBackendRuntimeSignal): ToolEventRecord {
  const message = safeRuntimeErrorMessage(error, modelErrorSignal);
  const planProtocolFailure = /^Plan (?:planning|revision|execution|phase)\b/i.test(message);
  const budgetStatus = budgetStatusPayload(error);
  return {
    eventType: planProtocolFailure ? "agent_backend_plan_protocol_failed" : "agent_backend_runtime_failed",
    payload: {
      source,
      message,
      ...(budgetStatus ? budgetStatus : {}),
      fallback: planProtocolFailure ? "none" : mockFallbackEnabled ? "mock" : "none"
    }
  };
}

function budgetStatusPayload(error: unknown): Record<string, unknown> | undefined {
  const status = error && typeof error === "object" ? (error as { facetwriteBudgetStatus?: unknown }).facetwriteBudgetStatus : undefined;
  if (status && typeof status === "object" && !Array.isArray(status)) return status as Record<string, unknown>;
  const message = error instanceof Error ? error.message : "";
  if (/Recursion limit of \d+ reached|GRAPH_RECURSION_LIMIT|GraphRecursionError/i.test(message)) {
    const recursionLimit = Number.parseInt(message.match(/Recursion limit of (\d+) reached/i)?.[1] ?? "", 10);
    return {
      status: "budget_exhausted",
      canResume: true,
      ...(Number.isInteger(recursionLimit) ? { recursionLimit } : {})
    };
  }
  return undefined;
}

function safeRuntimeErrorMessage(error: unknown, modelErrorSignal?: AgentBackendRuntimeSignal) {
  const message = error instanceof Error ? error.message : "Unknown runtime error";
  const signalReason = typeof modelErrorSignal?.payload?.reason === "string" ? modelErrorSignal.payload.reason : "";
  if (/AgentBackend returned internal runtime output/i.test(message) && isThinkingToolChoiceCompatibilityMessage(signalReason)) {
    return "Current model does not support thinking with forced tool calls. Disable thinking for this step or switch to a model verified for thinking + tool use.";
  }
  if (isThinkingToolChoiceCompatibilityMessage(message) || isThinkingToolChoiceCompatibilityMessage(signalReason)) {
    return "Current model does not support thinking with forced tool calls. Disable thinking for this step or switch to a model verified for thinking + tool use.";
  }
  if (/api[_-]?key|authorization|token|password|secret/i.test(message)) {
    return "Runtime failed with a credential-related error.";
  }
  return message.slice(0, 240);
}

function isThinkingToolChoiceCompatibilityMessage(message: string) {
  return /thinking\b[\s\S]{0,120}\btool[_-]?choice|\btool[_-]?choice\b[\s\S]{0,120}\bthinking/i.test(message);
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

function withAutoPreflightPlan(payload: GenerateRequest, threadId: string, projectRuntimeSettings: ProjectRuntimeSettings, agentPlanOrchestrator: AgentPlanOrchestrator): GenerateRequest {
  if (skillScopeIntake(payload).needsClarification) return payload;
  return agentPlanOrchestrator.prepareAutoPreflight(threadId, payload, projectRuntimeSettings);
}

function withPlanGeneration(payload: GenerateRequest, threadId: string, storage: SQLiteStorageRepository): GenerateRequest {
  if (payload.planGeneration) return payload;
  const policy = resolvePlanRequestPolicy(payload);
  if (policy.phase === "chat") return payload;
  const phase = policy.stage === "execution" ? "execution" : policy.stage === "revise" ? "revise" : policy.stage === "preflight" ? "preflight" : "intake";
  const existingPlanId = payload.planId || readString(record(payload.contextValues?.awaitingPlan).id);
  const planId = existingPlanId || storage.createPlanIntake(threadId, {
    title: "Plan intake",
    goal: payload.chatInstruction || "Clarify intent",
    origin: policy.stage === "execution" ? "approved_execution" : "explicit_plan",
    complexity: payload.contextValues?.taskComplexity as Record<string, unknown> | undefined,
    preflight: {
      summary: (payload.chatInstruction || "Clarify intent").slice(0, 240),
      phase
    }
  }).id;
  if (existingPlanId) {
    storage.updatePlanMetadata(threadId, existingPlanId, {
      origin: policy.stage === "execution" ? "approved_execution" : "explicit_plan",
      complexity: payload.contextValues?.taskComplexity as Record<string, unknown> | undefined
    });
  }
  const phaseAttemptId = `${policy.stage}_${crypto.randomUUID()}`;
  return {
    ...payload,
    contextValues: { ...payload.contextValues, agentPlan: {
      id: planId,
      stepId: payload.stepId ?? policy.executionStepId,
      origin: policy.stage === "execution" ? "approved_execution" : "explicit_plan",
      phase
    }, planGeneration: {
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
  const skill = phase === "intake" ? "brainstorming" : phase === "revise" || phase === "preflight" ? "writing-plans" : undefined;
  return [{
    eventType: "agent_backend_plan_activity",
    payload: {
      eventType: phase === "intake" ? "intent_recognized" : phase === "revise" || phase === "preflight" ? "plan_preparing" : "step_started",
      planId: payload.planGeneration?.planId,
      stepId: payload.planGeneration?.stepId,
      phase,
      phaseAttemptId: payload.planGeneration?.phaseAttemptId,
      ...(skill ? { skill, summary: `Using skill: ${skill}` } : {})
    }
  }];
}

function withAgentPlanEventContext(event: ToolEventRecord, payload: GenerateRequest): ToolEventRecord {
  const context = agentPlanPayload(payload);
  if (!Object.keys(context).length) return event;
  return {
    ...event,
    payload: {
      ...context,
      ...event.payload,
      phase: readString(event.payload.phase) || context.phase
    }
  };
}

function agentPlanPayload(payload: GenerateRequest): Record<string, unknown> {
  const generation = payload.planGeneration;
  const agentPlan = record(payload.contextValues?.agentPlan);
  const planId = readString(agentPlan.id) || generation?.planId || payload.planId;
  const stepId = readString(agentPlan.stepId) || generation?.stepId || payload.stepId;
  const phase = readString(agentPlan.phase) || generation?.phase || payload.planPhase;
  return {
    ...(planId ? { planId, agentPlanId: planId } : {}),
    ...(stepId ? { stepId, agentPlanStepId: stepId } : {}),
    ...(phase ? { phase } : {}),
    ...(readString(agentPlan.origin) ? { agentPlanOrigin: readString(agentPlan.origin) } : {})
  };
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readString(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return isSentinelText(text) ? "" : text;
}

function readPlanExecutionContext(value: unknown) {
  const source = record(value);
  const planId = readString(source.planId);
  const stepId = readString(source.stepId);
  return planId && stepId ? { planId, stepId } : undefined;
}

function planExecutionContextForPayload(payload: GenerateRequest) {
  if (payload.planGeneration?.phase === "execution" && payload.planGeneration.stepId) {
    return { planId: payload.planGeneration.planId, stepId: payload.planGeneration.stepId };
  }
  if (payload.planPhase === "execution" && payload.planId && payload.stepId) {
    return { planId: payload.planId, stepId: payload.stepId };
  }
  return readPlanExecutionContext(payload.contextValues?.planExecution);
}

function isSentinelText(value: string) {
  return /^(?:undefined|null|none|nan)$/i.test(value.trim());
}

export function stableCanvasDeliveryId(threadId: string, payload: GenerateRequest, storage: SQLiteStorageRepository) {
  const resumeDeliveryId = readAgentClarificationResumeDeliveryId(threadId, payload);
  if (resumeDeliveryId) return resumeDeliveryId;
  const sequence = storage.listMessages(threadId).length + 1;
  const actionId = payload.canvasAction?.id ?? "direct";
  return `delivery_${threadId}_${sequence}_${actionId}`;
}

function readAgentClarificationResumeDeliveryId(threadId: string, payload: GenerateRequest) {
  const clarification = record(payload.contextValues?.agentClarification);
  if (!Object.keys(clarification).length) return "";
  const resumeContext = record(clarification.resumeContext);
  const resumeCanvas = record(resumeContext.canvas);
  const contextCanvas = record(payload.contextValues?.canvas);
  const deliveryId = readString(resumeCanvas.deliveryId) || readString(contextCanvas.deliveryId);
  return deliveryId.startsWith(`delivery_${threadId}_`) ? deliveryId : "";
}

function withTaskHandlingPolicy(payload: GenerateRequest, context: Awaited<ReturnType<typeof buildGenerationRunContext>>): GenerateRequest {
  const taskHandlingPolicy = resolveTaskHandlingPolicy({
    payload,
    transientSkillCount: context.transientSkillNames.length,
    thinkingMode: context.modelSettings.thinkingMode
  });
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      taskHandlingPolicy
    }
  };
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
  if (!isCanvasEligibleTaskPolicy(payload.contextValues?.taskHandlingPolicy)) return payload;
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
  return value === "low" || value === "medium" || value === "high" ? value : "low";
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
  return record(payload.contextValues?.progressiveCanvasDelivery).enabled === true
    && isCanvasEligibleTaskPolicy(payload.contextValues?.taskHandlingPolicy);
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

function withSkillClarificationGuard(payload: GenerateRequest, threadId: string, projectSettings: ProjectRuntimeSettings): GenerateRequest {
  if (!needsSkillScopeClarification(payload)) return payload;
  const intake = skillScopeIntake(payload);
  const skillRefs = (payload.transientSkillRefs ?? []).map((skillRef) => skillRef.toLowerCase());
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  const clarificationId = `skill_clarification_${hashString(`${threadId}:${skillRefs.join("|")}:${instruction}`).toString(36)}`;
  const budget = resolveRuntimeBudget(payload.runtimeBudgetProfile, projectSettings);
  const missingSlots = intake.missingSlots.length ? intake.missingSlots.join(", ") : "none";
  const answeredSlots = intake.answeredSlots.length ? intake.answeredSlots.map(intakeSlotLabel).join(", ") : "none";
  const answeredSummary = intake.answeredSummary || "No intake answers yet.";
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      facetwrite_clarification_policy: {
        mode: "skill_scope_guard",
        intakeState: "intake_collecting",
        intakeRound: intake.nextRound,
        maxIntakeRounds: MAX_SKILL_INTAKE_ROUNDS,
        answeredSummary,
        answeredSlots: intake.answeredSlots,
        missingSlots: intake.missingSlots,
        allowEvidenceTools: false,
        source: "server_guard",
        clarificationId,
        originalInstruction: stripSelectedClarificationInstruction(instruction),
        skillRefs: payload.transientSkillRefs ?? [],
        disabledSkillRefs: payload.disabledSkillRefs ?? [],
        runtimeBudgetProfile: budget.runtimeBudgetProfile,
        canvas: record(payload.contextValues?.canvas),
        instruction: payload.locale === "zh"
          ? `当前文献/数据库类任务还处于搜索前 intake 阶段。你必须依据已加载 Skill 调用 ask_clarification，最多进行 ${MAX_SKILL_INTAKE_ROUNDS} 轮高价值澄清；当前是第 ${intake.nextRound} 轮。已回答摘要：${answeredSummary}。已回答槽位：${answeredSlots}。仍缺失：${missingSlots}。只能围绕仍缺失槽位提问，不要重复询问已回答槽位；若缺失槽位为 none，请继续执行任务而不是继续澄清。每轮只问一个最有价值的问题，参数必须包含 question 和 2-3 个 options；每个 option 必须有 id、label、detail 或 description，最多一个 recommended:true。不要输出普通澄清话术、Markdown 选项列表或自然语言阶段说明；如果无法调用工具，只能输出完整 JSON 对象 {"type":"agent_clarification_requested","question":"...","options":[...]}，不能包含任何额外文本。在用户回答前不要调用 web_search、web_fetch、knowledge_base、write_file、present_files 或其他证据工具。`
          : `This literature/database task is still in the pre-search intake stage. Use the loaded Skill instructions to call ask_clarification, for up to ${MAX_SKILL_INTAKE_ROUNDS} high-value clarification rounds; this is round ${intake.nextRound}. Answers so far: ${answeredSummary}. Answered slots: ${answeredSlots}. Missing slots: ${missingSlots}. Ask only about the missing slots and do not repeat answered slots; if missing slots is none, continue the task instead of clarifying again. Ask only one highest-value question per round, and the arguments must include question plus 2-3 options; every option must include id, label, and detail or description, with at most one recommended:true. Do not output ordinary clarification prose, Markdown option lists, or phase narration. If tool calling is unavailable, output only a complete JSON object {"type":"agent_clarification_requested","question":"...","options":[...]} with no surrounding text. Do not call web_search, web_fetch, knowledge_base, write_file, present_files, or other evidence tools until intake is sufficient.`
      }
    }
  };
}

function needsSkillScopeClarification(payload: GenerateRequest) {
  if (resolvePlanRequestPolicy(payload).phase === "planning" || payload.planGeneration) return false;
  if (payload.planPhase === "preflight") return false;
  return skillScopeIntake(payload).needsClarification;
}

const MAX_SKILL_INTAKE_ROUNDS = 3;

function skillScopeIntake(payload: GenerateRequest) {
  const skillRefs = (payload.transientSkillRefs ?? []).map((skillRef) => skillRef.toLowerCase());
  const needsClarification = skillRefs.some(isClarificationSensitiveSkill);
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  const scopeSensitiveTask = /(?:literature|review|survey|paper|database|lookup|search|research|citation|bibliography|github|repo|repository|market|industry|competitive|competitor|newsletter|digest|roundup|news|briefing|文献|综述|调研|检索|搜索|查找|数据库|论文|引用|参考文献|市场|行业|竞品|竞争|简报|周报|新闻|仓库|开源项目)/i.test(instruction);
  if (!needsClarification || !scopeSensitiveTask) {
    return { needsClarification: false, nextRound: 1, answeredSummary: "", answeredSlots: [] as string[], missingSlots: [] as string[] };
  }
  const currentAnswer = readCurrentAgentClarificationAnswer(payload);
  const resumeContext = record(record(payload.contextValues?.agentClarification).resumeContext);
  const priorRound = readPositiveInteger(resumeContext.intakeRound) ?? 0;
  const nextRound = Math.min(MAX_SKILL_INTAKE_ROUNDS, priorRound + (currentAnswer ? 1 : 0) + (priorRound ? 0 : 1));
  const answeredSummary = mergeIntakeAnsweredSummary(readString(resumeContext.answeredSummary), currentAnswer);
  const assessmentText = [instruction, answeredSummary].filter(Boolean).join("\n");
  const answeredSlots = intakeSlotIds(answeredSummary);
  const missingSlots = missingIntakeSlots(assessmentText, new Set(answeredSlots));
  const allowEvidenceTools = Boolean(currentAnswer) && (
    priorRound >= MAX_SKILL_INTAKE_ROUNDS
    || missingSlots.length === 0
    || isExplicitContinueAnswer(currentAnswer)
  );
  return {
    needsClarification: !allowEvidenceTools,
    nextRound,
    answeredSummary,
    answeredSlots,
    missingSlots
  };
}

function isSkillClarificationGuarded(payload: GenerateRequest) {
  return record(payload.contextValues?.facetwrite_clarification_policy).mode === "skill_scope_guard";
}

function isClarificationSensitiveSkill(skillRef: string) {
  const names = [
    "database-lookup",
    "paper-lookup",
    "literature-review",
    "systematic-literature-review",
    "deep-research",
    "github-deep-research",
    "citation-management",
    "newsletter-generation",
    "consulting-analysis"
  ];
  return names.some((name) => skillRef === name || skillRef.endsWith(`:${name}`) || skillRef.endsWith(`/${name}`));
}

function readCurrentAgentClarificationAnswer(payload: GenerateRequest) {
  const clarification = record(payload.contextValues?.agentClarification);
  const option = record(clarification.option);
  const label = readString(option.label);
  const detail = readString(option.detail) || readString(option.description);
  return readString(clarification.answer)
    || [label, detail].filter(Boolean).join(" - ")
    || readString(clarification.selectedOptionId);
}

function mergeIntakeAnsweredSummary(existing: string, current: string) {
  const answers = existing
    .split(/\r?\n|;\s*/)
    .map((item) => item.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
  if (current && !answers.some((answer) => answer.toLowerCase() === current.toLowerCase())) answers.push(current);
  return answers.join("; ");
}

const INTAKE_SLOT_DEFINITIONS = [
  { id: "topic_subdomain", label: "topic/subdomain", pattern: /agent|multi-agent|mas|llm|workflow|framework|autonomous|协作|智能体|多智能体|代理/ },
  { id: "time_range", label: "time range", pattern: /\b20\d{2}\b|\brecent\b|last\s+\d+\s+years|近|最近|年/ },
  { id: "paper_count_depth", label: "paper count/depth", pattern: /\b\d+\s*(?:papers?|sources?|studies?)\b|focused|broad|comprehensive|survey|review|篇|论文|文献|综述/ },
  { id: "citation_format", label: "citation format", pattern: /\bapa\b|\bieee\b|\bmla\b|\bnature\b|citation|format|style|参考文献|引用|格式/ },
  { id: "output_structure", label: "output structure", pattern: /systematic|literature review|review|survey|table|section|structure|synthesis|综述|结构|表格|章节|输出/ }
] as const;

function intakeSlotIds(value: string) {
  const text = value.toLowerCase();
  return INTAKE_SLOT_DEFINITIONS.flatMap((slot) => slot.pattern.test(text) ? [slot.id] : []);
}

function intakeSlotLabel(slotId: string) {
  return INTAKE_SLOT_DEFINITIONS.find((slot) => slot.id === slotId)?.label ?? slotId;
}

function missingIntakeSlots(value: string, answeredSlots = new Set<string>()) {
  const text = value.toLowerCase();
  return INTAKE_SLOT_DEFINITIONS.flatMap((slot) => (
    answeredSlots.has(slot.id) || slot.pattern.test(text) ? [] : [slot.label]
  ));
}

function isExplicitContinueAnswer(value: string) {
  return /(?:continue|go ahead|start search|search now|use your judgment|proceed|开始搜索|继续|直接开始|你来决定|按你的判断)/i.test(value);
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function markAnsweredAgentClarification(storage: SQLiteStorageRepository, threadId: string, payload: GenerateRequest) {
  const clarification = record(payload.contextValues?.agentClarification);
  const clarificationId = readString(clarification.clarificationId);
  if (!clarificationId) return;
  const option = record(clarification.option);
  const answer = {
    selectedOptionId: readString(clarification.selectedOptionId) || readString(option.id),
    selectedOptionLabel: readString(option.label) || readString(clarification.answer),
    answer: readString(clarification.answer) || readString(option.label)
  };
  if (storage.answerAgentClarification(threadId, clarificationId, answer)) {
    resumePlanExecutionForAgentClarificationAnswer(storage, threadId, payload, answer);
    return;
  }
  const question = readString(clarification.question);
  if (!question) return;
  const matchingPending = storage.listAgentClarifications(threadId).find((item) => item.status === "pending" && item.question === question);
  if (matchingPending && storage.answerAgentClarification(threadId, matchingPending.id, answer)) {
    resumePlanExecutionForAgentClarificationAnswer(storage, threadId, payload, answer);
  }
}

function markPlanWaitingForAgentClarification(storage: SQLiteStorageRepository, threadId: string, payload: GenerateRequest, events: ToolEventRecord[]) {
  const planExecution = planExecutionContextForPayload(payload);
  if (!planExecution || !events.some(isAgentClarificationEvent)) return;
  const question = latestAgentClarificationQuestion(events);
  storage.recordPlanActivity(threadId, planExecution.planId, {
    stepId: planExecution.stepId,
    type: "clarification_ready",
    status: "waiting",
    summary: question || "Waiting for user clarification",
    detail: { source: "agent_clarification" }
  });
  storage.setPlanWaitingForUser(threadId, planExecution.planId, question || "Waiting for user clarification");
}

function resumePlanExecutionForAgentClarificationAnswer(
  storage: SQLiteStorageRepository,
  threadId: string,
  payload: GenerateRequest,
  answer: { selectedOptionId?: string; selectedOptionLabel?: string; answer?: string }
) {
  const planExecution = readPlanExecutionContext(record(payload.contextValues?.planExecution))
    ?? readPlanExecutionContext(record(record(payload.contextValues?.agentClarification).resumeContext).planExecution);
  if (!planExecution) return;
  const plan = storage.getPlanRun(threadId, planExecution.planId);
  if (plan?.status !== "awaiting_user") return;
  storage.resumePlanWithAnswer(threadId, planExecution.planId, {
    optionId: answer.selectedOptionId,
    answer: answer.answer || answer.selectedOptionLabel
  });
}

function isBlockingAgentClarificationRun(events: ToolEventRecord[], text: string, finishReason?: string) {
  if (!hasAgentClarificationEvent(events)) return false;
  if (hasPostClarificationProgress(events)) return false;
  const visible = stripAppendedSources(text).trim();
  return finishReason === "clarification_required"
    || !visible
    || isProcessClarificationText(visible)
    || /(?:need(?:s|ed)?\s+(?:to\s+)?(?:confirm|clarif|supplement)|clarif(?:y|ication)|supplement(?:al)?\s+information|范围|确认|补充|澄清)/i.test(visible) && visible.length < 500;
}

function latestAgentClarificationQuestion(events: ToolEventRecord[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isAgentClarificationEvent(event)) continue;
    const question = readString(record(event.payload).question);
    if (question) return question;
  }
  return "";
}

function finalFinishReason(finishReason: string | undefined, events: ToolEventRecord[]) {
  return finishReason === "clarification_required" && hasPostClarificationProgress(events)
    ? "agent_backend_completed"
    : finishReason;
}

function stripAppendedSources(text: string) {
  return text.replace(/\n+##\s*(?:Sources|来源|鏉ユ簮)\s*\n[\s\S]*$/i, "").trim();
}

function stripSelectedClarificationInstruction(value: unknown) {
  const text = readString(value);
  if (!text) return "";
  return text.replace(/\n+Selected clarification:[\s\S]*$/i, "").trim();
}

function dedupeToolEvents(events: ToolEventRecord[]) {
  const byKey = new Map<string, ToolEventRecord>();
  const order: string[] = [];
  for (const event of events) {
    const key = toolEventDedupeKey(event);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, mergePreferredToolEvent(existing, event));
      continue;
    }
    byKey.set(key, event);
    order.push(key);
  }
  return order.map((key) => byKey.get(key)!);
}

function toolEventDedupeKey(event: ToolEventRecord) {
  const payload = record(event.payload);
  const question = readString(payload.question);
  const toolCallId = readString(payload.toolCallId);
  const clarificationId = readString(payload.clarificationId);
  if (/agent_clarification/.test(event.eventType) || question) {
    return [event.eventType, clarificationId || question || toolCallId, agentClarificationOptionsKey(payload.options)].join("|");
  }
  return `${event.eventType}|${JSON.stringify(event.payload)}`;
}

function mergePreferredToolEvent(existing: ToolEventRecord, incoming: ToolEventRecord) {
  if (!isAgentClarificationEvent(existing) || !isAgentClarificationEvent(incoming)) return existing;
  const existingHasResume = hasCompleteRuntimeResume(existing);
  const incomingHasResume = hasCompleteRuntimeResume(incoming);
  if (!incomingHasResume && existingHasResume) return existing;
  if (!incomingHasResume && !existingHasResume) return existing;
  const existingPayload = record(existing.payload);
  const incomingPayload = record(incoming.payload);
  const existingResumeContext = record(existingPayload.resumeContext);
  const incomingResumeContext = record(incomingPayload.resumeContext);
  const runtimeResume = readRuntimeResume(incomingResumeContext.runtimeResume)
    ?? readRuntimeResume(existingResumeContext.runtimeResume);
  return {
    ...existing,
    ...incoming,
    payload: {
      ...existingPayload,
      ...incomingPayload,
      resumeContext: {
        ...existingResumeContext,
        ...incomingResumeContext,
        ...(runtimeResume ? { runtimeResume } : {})
      }
    }
  };
}

function hasCompleteRuntimeResume(event: ToolEventRecord) {
  const payload = record(event.payload);
  const resumeContext = record(payload.resumeContext);
  return Boolean(readRuntimeResume(resumeContext.runtimeResume));
}

function readRuntimeResume(value: unknown) {
  const resume = record(value);
  const runtimeThreadId = readString(resume.runtimeThreadId);
  const runtimeRunId = readString(resume.runtimeRunId);
  const interruptId = readString(resume.interruptId);
  if (!runtimeThreadId || !runtimeRunId || !interruptId) return undefined;
  const checkpointId = readString(resume.checkpointId);
  return {
    runtimeThreadId,
    runtimeRunId,
    interruptId,
    ...(checkpointId ? { checkpointId } : {})
  };
}

function agentClarificationOptionsKey(value: unknown) {
  if (!Array.isArray(value)) return "";
  return JSON.stringify(value.map((option) => {
    if (typeof option === "string") return option.trim();
    const item = record(option);
    return {
      id: readString(item.id),
      label: readString(item.label) || readString(item.title)
    };
  }));
}

export function withAgentClarificationResumeContext(event: ToolEventRecord, payload: GenerateRequest, deliveryId?: string): ToolEventRecord {
  if (!isAgentClarificationEvent(event)) return event;
  const eventPayload = record(event.payload);
  const existingResumeContext = record(eventPayload.resumeContext);
  const policy = record(payload.contextValues?.facetwrite_clarification_policy);
  const answeredClarification = record(payload.contextValues?.agentClarification);
  const repeatedSlots = repeatedAnsweredIntakeSlots(eventPayload, payload, policy);
  if (repeatedSlots.length) {
    return {
      eventType: "agent_backend_duplicate_clarification_suppressed",
      payload: {
        source: "server_guard",
        reason: "answered_intake_slot",
        originalEventType: event.eventType,
        originalQuestion: readString(eventPayload.question),
        repeatedSlots
      }
    };
  }
  const existingSkillRefs = readStringList(existingResumeContext.transientSkillRefs);
  const existingDisabledSkillRefs = readStringList(existingResumeContext.disabledSkillRefs);
  const existingCanvas = sanitizeCanvasForAgentIntake(existingResumeContext.canvas);
  const payloadCanvas = sanitizeCanvasForAgentIntake(payload.contextValues?.canvas);
  const policyCanvas = isSkillClarificationGuarded(payload) ? sanitizeCanvasForAgentIntake(policy.canvas) : {};
  const canvas = mergeSkillClarificationResumeCanvas(policyCanvas, existingCanvas);
  const mergedCanvas = {
    ...(Object.keys(canvas).length ? canvas : payloadCanvas),
    ...(deliveryId ? { deliveryId } : {})
  };
  const runtimeBudgetProfile = readOptionalRuntimeBudgetProfile(existingResumeContext.runtimeBudgetProfile)
    ?? readOptionalRuntimeBudgetProfile(policy.runtimeBudgetProfile)
    ?? payload.runtimeBudgetProfile;
  const intakeRound = readPositiveInteger(existingResumeContext.intakeRound)
    ?? readPositiveInteger(policy.intakeRound);
  const maxIntakeRounds = readPositiveInteger(existingResumeContext.maxIntakeRounds)
    ?? readPositiveInteger(policy.maxIntakeRounds);
  const answeredSummary = readString(existingResumeContext.answeredSummary)
    || readString(policy.answeredSummary);
  const missingSlots = readStringList(existingResumeContext.missingSlots).length
    ? readStringList(existingResumeContext.missingSlots)
    : readStringList(policy.missingSlots);
  const intakeState = readString(existingResumeContext.intakeState)
    || readString(policy.intakeState);
  const originalInstruction = stripSelectedClarificationInstruction(readString(existingResumeContext.originalInstruction))
    || stripSelectedClarificationInstruction(policy.originalInstruction)
    || stripSelectedClarificationInstruction(answeredClarification.originalInstruction)
    || stripSelectedClarificationInstruction(payload.chatInstruction)
    || stripSelectedClarificationInstruction(payload.freeTextPrompt)
    || "";
  const planExecution = readPlanExecutionContext(existingResumeContext.planExecution)
    ?? planExecutionContextForPayload(payload);
  return {
    ...event,
    payload: {
      ...eventPayload,
      resumeContext: {
        ...existingResumeContext,
        originalInstruction,
        transientSkillRefs: existingSkillRefs.length ? existingSkillRefs : readStringList(policy.skillRefs).length ? readStringList(policy.skillRefs) : payload.transientSkillRefs ?? [],
        disabledSkillRefs: existingDisabledSkillRefs.length ? existingDisabledSkillRefs : readStringList(policy.disabledSkillRefs).length ? readStringList(policy.disabledSkillRefs) : payload.disabledSkillRefs ?? [],
        ...(runtimeBudgetProfile ? { runtimeBudgetProfile } : {}),
        ...(intakeState ? { intakeState } : {}),
        ...(intakeRound ? { intakeRound } : {}),
        ...(maxIntakeRounds ? { maxIntakeRounds } : {}),
        ...(answeredSummary ? { answeredSummary } : {}),
        ...(missingSlots.length ? { missingSlots } : {}),
        ...(planExecution ? { planExecution } : {}),
        canvas: mergedCanvas
      }
    }
  };
}

function repeatedAnsweredIntakeSlots(eventPayload: Record<string, unknown>, payload: GenerateRequest, policy: Record<string, unknown>) {
  const answeredSlots = new Set([
    ...readStringList(policy.answeredSlots),
    ...intakeSlotIds([
      readString(policy.answeredSummary),
      readCurrentAgentClarificationAnswer(payload)
    ].filter(Boolean).join("; "))
  ]);
  if (answeredSlots.size === 0) return [];
  const eventSlots = intakeSlotIds([
    readString(eventPayload.question),
    ...readClarificationOptionTexts(eventPayload.options)
  ].filter(Boolean).join("; "));
  if (eventSlots.length === 0) return [];
  const uniqueEventSlots = [...new Set(eventSlots)];
  if (!uniqueEventSlots.every((slot) => answeredSlots.has(slot))) return [];
  return uniqueEventSlots;
}

function readClarificationOptionTexts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const option = record(item);
    return [
      readString(option.label),
      readString(option.detail),
      readString(option.description)
    ].filter(Boolean);
  });
}

function mergeSkillClarificationResumeCanvas(policyCanvas: Record<string, unknown>, existingCanvas: Record<string, unknown>) {
  const canvas = { ...policyCanvas, ...existingCanvas };
  const hasExistingWorkflow = Object.keys(record(existingCanvas.workflow)).length > 0;
  const hasPolicyWorkflow = Object.keys(record(policyCanvas.workflow)).length > 0;
  if (!hasExistingWorkflow && hasPolicyWorkflow) canvas.workflow = policyCanvas.workflow;
  return canvas;
}

function readOptionalRuntimeBudgetProfile(value: unknown): GenerateRequest["runtimeBudgetProfile"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
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
    if (hasVisibleAgentDeliveryEvidence("", input.events)) return { text: input.text, timelineEvents: [] as RunTimelineEvent[] };
    throw new Error("Direct Canvas delivery completed without assistant content.");
  }
  if (containsInternalRuntimeProtocol(assistantText)) {
    return { text: "", timelineEvents: [] as RunTimelineEvent[] };
  }
  const timeline = input.timeline ?? createRunTimelineBuilder({ threadId: input.threadId, locale: input.payload.locale });
  const localTimelineEvents: RunTimelineEvent[] = [];
  const emit = input.emitTimeline ?? ((event: RunTimelineEvent) => localTimelineEvents.push(event));
  if (isProcessClarificationText(assistantText)) {
    const deliveryId = input.deliveryId ?? stableCanvasDeliveryId(input.threadId, input.payload, input.storage);
    const sources = extractSourceLinks({ text: assistantText, limit: 20 });
    const recovery = processClarificationRecoveryNode(input.payload.locale, deliveryId, sources.length);
    const committed = commitCanvasDelivery(input.storage, input.projectId, {
      required: true,
      moduleId: "document_batch",
      nodes: [recovery],
      edges: []
    });
    for (const item of committed) {
      emit(timeline.event(
        "canvas_node_committed",
        "completed",
        item.title,
        input.payload.locale === "zh" ? `已创建或更新节点：${item.title}` : `Created or updated node: ${item.title}`,
        { nodeId: item.nodeId, title: item.title, recoverable: true }
      ));
    }
    return { text: processClarificationAssistantText(input.payload.locale), timelineEvents: localTimelineEvents };
  }
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

async function finalizeProgressiveCanvasDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  text: string;
  events: ToolEventRecord[];
  timeline?: ReturnType<typeof createRunTimelineBuilder>;
  emitTimeline?: (event: RunTimelineEvent) => void;
  archiveMarkdownOutput?: ArchiveMarkdownOutput;
}) {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return { text: input.text, events: [] as ToolEventRecord[] };
  const instruction = input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "";
  if (isDirectCanvasDeliveryIntent(instruction)) return { text: input.text, events: [] as ToolEventRecord[] };
  let assistantText = input.text.trim();
  const existingFilePaths = outputMarkdownPathsFromEvents(input.events);
  if (!assistantText && existingFilePaths.length === 0) return { text: input.text, events: [] as ToolEventRecord[] };
  if (containsInternalRuntimeProtocol(assistantText)) {
    if (existingFilePaths.length === 0) return { text: "", events: [] as ToolEventRecord[] };
    assistantText = "";
  }
  const timeline = input.timeline ?? createRunTimelineBuilder({ threadId: input.payload.threadId ?? "pending", locale: input.payload.locale });
  const emit = input.emitTimeline ?? (() => undefined);
  const content = resolveCanvasDeliveryContent({
    instruction,
    locale: input.payload.locale,
    text: assistantText,
    events: input.events
  });
  const archiveResult = await archiveProgressiveMarkdownOutputs({
    threadId: input.threadId,
    deliveryId: input.deliveryId,
    locale: input.payload.locale,
    paths: existingFilePaths,
    archiveMarkdownOutput: input.archiveMarkdownOutput ?? archiveMarkdownOutputFromRuntime
  });
  const events: ToolEventRecord[] = [...archiveResult.events];
  const existingFileMarkdown = archiveResult.archivedPaths
    .map((filePath) => ({ filePath, markdown: readThreadOutputMarkdown(input.threadId, filePath) }))
    .filter((entry): entry is { filePath: string; markdown: string } => Boolean(entry.markdown) && isLikelyDeliverableMarkdown(entry.markdown));
  const existingBodyMarkdown = readExistingFinalBodyMarkdown(input.storage, input.projectId, input.deliveryId);
  const finalBodyMarkdown = selectFinalBodyMarkdown({
    content,
    assistantText,
    events: input.events,
    existingFileMarkdown: existingFileMarkdown.map((entry) => entry.markdown).filter((markdown): markdown is string => Boolean(markdown))
  });
  const processClarificationText = isProcessClarificationText(assistantText);
  const requiresFileDelivery = requiresMarkdownFileDelivery({
    payload: input.payload,
    text: finalBodyMarkdown || content.bodyMarkdown || assistantText,
    events: input.events,
    existingFilePaths
  });
  const fallbackMarkdown = finalBodyMarkdown && isLikelyDeliverableMarkdown(finalBodyMarkdown)
    ? markdownDeliverableContent(content, finalBodyMarkdown)
    : "";
  const fallbackFilePath = requiresFileDelivery && existingFileMarkdown.length === 0 && fallbackMarkdown
    ? writeFallbackMarkdownDeliverable(input.threadId, input.deliveryId, fallbackMarkdown)
    : undefined;
  const deliveryFilePaths = fallbackFilePath ? [fallbackFilePath] : existingFileMarkdown.map((entry) => entry.filePath);
  const availableFilePaths = new Set(deliveryFilePaths);
  let finalFileDocumentSequence = 100;
  if (fallbackFilePath) {
    const syntheticWriteEvent: ToolEventRecord = {
      eventType: "agent_backend_tool_completed",
      payload: {
        type: "tool_completed",
        toolName: "write_file",
        path: fallbackFilePath,
        source: "server_fallback"
      }
    };
    events.push(syntheticWriteEvent);
    const fileDocumentEvents = commitProgressiveFileDocumentDelivery({
      payload: input.payload,
      threadId: input.threadId,
      projectId: input.projectId,
      storage: input.storage,
      deliveryId: input.deliveryId,
      event: syntheticWriteEvent,
      availableFilePaths,
      nextSequence: () => {
        finalFileDocumentSequence += 1;
        return finalFileDocumentSequence;
      }
    });
    for (const fileDocumentEvent of fileDocumentEvents) {
      events.push(fileDocumentEvent);
      const fileDocumentPayload = record(fileDocumentEvent.payload);
      emit(timeline.event(
        "canvas_node_committed",
        "completed",
        readString(fileDocumentPayload.title) || (input.payload.locale === "zh" ? "文档节点" : "Document file"),
        input.payload.locale === "zh" ? "Markdown 文档已写入 Canvas。" : "Markdown document was written to Canvas.",
        fileDocumentPayload
      ));
    }
  }
  for (const event of input.events) {
    const fileDocumentEvents = commitProgressiveFileDocumentDelivery({
      payload: input.payload,
      threadId: input.threadId,
      projectId: input.projectId,
      storage: input.storage,
      deliveryId: input.deliveryId,
      event,
      availableFilePaths,
      nextSequence: () => {
        finalFileDocumentSequence += 1;
        return finalFileDocumentSequence;
      }
    });
    for (const fileDocumentEvent of fileDocumentEvents) {
      events.push(fileDocumentEvent);
      const fileDocumentPayload = record(fileDocumentEvent.payload);
      emit(timeline.event(
        "canvas_node_committed",
        "completed",
        readString(fileDocumentPayload.title) || (input.payload.locale === "zh" ? "文档节点" : "Document file"),
        input.payload.locale === "zh" ? "Markdown 文档入口已写入 Canvas。" : "Markdown document entry was written to Canvas.",
        fileDocumentPayload
      ));
    }
  }
  if (requiresFileDelivery && deliveryFilePaths.length > 0) {
    const syntheticPresentEvent: ToolEventRecord = {
      eventType: "agent_backend_tool_completed",
      payload: {
        toolName: "present_files",
        filepaths: deliveryFilePaths
      }
    };
    const fileDocumentEvents = commitProgressiveFileDocumentDelivery({
      payload: input.payload,
      threadId: input.threadId,
      projectId: input.projectId,
      storage: input.storage,
      deliveryId: input.deliveryId,
      event: syntheticPresentEvent,
      availableFilePaths,
      nextSequence: () => {
        finalFileDocumentSequence += 1;
        return finalFileDocumentSequence;
      }
    });
    for (const fileDocumentEvent of fileDocumentEvents) {
      events.push(fileDocumentEvent);
      const fileDocumentPayload = record(fileDocumentEvent.payload);
      emit(timeline.event(
        "canvas_node_committed",
        "completed",
        readString(fileDocumentPayload.title) || (input.payload.locale === "zh" ? "文档节点" : "Document file"),
        input.payload.locale === "zh" ? "Markdown 文档入口已写入 Canvas。" : "Markdown document entry was written to Canvas.",
        fileDocumentPayload
      ));
    }
  }
  const overviewTitle = input.payload.locale === "zh" ? "整体概述" : "Overview";
  const bodyTitle = input.payload.locale === "zh" ? "正文" : "Body";
  const referenceTitle = input.payload.locale === "zh" ? "参考文献" : "References";
  const sources = mergeSourceLinks(content.sources, finalBodyMarkdown ? extractSourceLinks({ text: finalBodyMarkdown, limit: 40 }) : []);
  const bodyMarkdownForCanvas = finalBodyMarkdown
    || usableExistingBodyMarkdown(existingBodyMarkdown ?? "")
    || unavailableFinalBodySummary(input.payload.locale, sources.length);
  const overviewMarkdownForCanvas = finalBodyMarkdown && content.outlineMarkdown
    ? content.outlineMarkdown
    : outlineFromFinalBody(bodyMarkdownForCanvas, input.payload.locale);
  const referenceContent = sources.length
    ? `# ${referenceTitle}\n${formatSourceLinks(sources)}`
    : "";
  const fileDocumentNodes: CanvasDeliveryPlan["nodes"] = deliveryFilePaths
    .flatMap((filePath) => fileDocumentEntries(input.payload.locale, "present_files", { filepaths: [filePath] }))
    .map((document, index) => ({
      id: stableFileDocumentNodeId(input.deliveryId, document.path),
      kind: "file_document" as const,
      title: document.title,
      content: fileDocumentNodeContent(input.payload.locale, document),
      x: referenceContent ? 2720 + index * 420 : 2000 + index * 420,
      y: 120,
      width: 360,
      height: 220,
      metadata: {
        deliveryId: input.deliveryId,
        phase: "file_document",
        progressive: true,
        status: "final",
        fileDocument: { ...document, threadId: input.threadId }
      },
      includeInProjectContext: false
    }));
  const recoveryNode = processClarificationText && !finalBodyMarkdown && !hasAgentClarificationEvent(input.events)
    ? processClarificationRecoveryNode(input.payload.locale, input.deliveryId, sources.length)
    : undefined;
  const nodes: CanvasDeliveryPlan["nodes"] = [
    {
      id: stableDeliveryId("node", input.deliveryId, 1),
      kind: "document",
      title: overviewTitle,
      content: overviewMarkdownForCanvas,
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
      content: deliveryFilePaths.length
        ? fileDeliveryBodySummary(input.payload.locale, bodyMarkdownForCanvas)
        : bodyMarkdownForCanvas,
      x: 1280,
      y: 120,
      width: 640,
      height: 520,
      metadata: { deliveryId: input.deliveryId, phase: "body", progressive: true, status: "final" }
    }
  ];
  if (referenceContent) {
    nodes.push({
      id: stableDeliveryId("node", input.deliveryId, 3),
      kind: "reference",
      title: referenceTitle,
      content: referenceContent,
      x: 2000,
      y: 120,
      width: 560,
      height: 360,
      metadata: { deliveryId: input.deliveryId, phase: "sources", progressive: true, status: "final" }
    });
  }
  if (recoveryNode) nodes.push(recoveryNode);
  nodes.push(...fileDocumentNodes);
  const chainNodeIds = [
    stableDeliveryId("node", input.deliveryId, 1),
    stableDeliveryId("node", input.deliveryId, 2),
    ...(referenceContent ? [stableDeliveryId("node", input.deliveryId, 3)] : []),
    ...(recoveryNode ? [recoveryNode.id] : []),
    ...fileDocumentNodes.map((node) => node.id)
  ];
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes,
    edges: chainNodeIds.slice(1).map((targetNodeId, index) => ({
      id: stableDeliveryId("edge", input.deliveryId, 5000 + index + 1),
      sourceNodeId: chainNodeIds[index]!,
      targetNodeId,
      label: "next"
    }))
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
    text: deliveryFilePaths.length
      ? fileDeliveryAssistantText(input.payload.locale, deliveryFilePaths)
      : processClarificationText && !finalBodyMarkdown
        ? processClarificationAssistantText(input.payload.locale)
      : content.assistantText || input.text,
    events: [
      ...events,
      ...(body ? [canvasDeliveryEvent("canvas_delivery_body_final_committed", input.deliveryId, input.payload.locale, body, {
      displayTitle: input.payload.locale === "zh" ? "最终正文" : "Final body"
      })] : []),
      ...committed
        .filter((item) => item.nodeId === stableDeliveryId("node", input.deliveryId, 3))
        .map((item) => canvasDeliveryEvent("canvas_delivery_sources_committed", input.deliveryId, input.payload.locale, item, {
          displayTitle: referenceTitle,
          sourceCount: sources.length
        }))
    ]
  };
}

function requiresMarkdownFileDelivery(input: {
  payload: GenerateRequest;
  text: string;
  events: ToolEventRecord[];
  existingFilePaths: string[];
}) {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return false;
  if (isDirectCanvasDeliveryIntent(input.payload.chatInstruction ?? input.payload.freeTextPrompt ?? "")) return false;
  if (input.existingFilePaths.length > 0) return true;
  if (isLikelyDeliverableMarkdown(input.text)) return true;
  if (completedToolCount(input.events, "web_search") >= 2) return true;
  if (hasLongFormSkill(input.payload.transientSkillRefs)) return true;
  return input.text.trim().length >= 3000;
}

function completedToolCount(events: ToolEventRecord[], toolName: string) {
  return events.filter((event) => {
    if (!/completed$/.test(event.eventType)) return false;
    const payload = record(event.payload);
    return (readString(payload.toolName) || readString(payload.tool)) === toolName;
  }).length;
}

function hasLongFormSkill(skillRefs: string[] | undefined) {
  return (skillRefs ?? []).some((skillRef) => {
    const normalized = skillRef.toLowerCase();
    return normalized === "literature-review" || normalized.endsWith(":literature-review") || normalized.endsWith("/literature-review");
  });
}

function outputMarkdownPathsFromEvents(events: ToolEventRecord[]) {
  const paths: string[] = [];
  for (const event of events) {
    const payload = record(event.payload);
    const toolName = readString(payload.toolName) || readString(payload.tool);
    for (const document of fileDocumentEntries("en", toolName, payload)) {
      paths.push(document.path);
    }
  }
  return uniqueStrings(paths);
}

async function archiveProgressiveMarkdownOutputs(input: {
  threadId: string;
  deliveryId: string;
  locale: GenerateRequest["locale"];
  paths: string[];
  archiveMarkdownOutput: ArchiveMarkdownOutput;
}) {
  const archivedPaths: string[] = [];
  const events: ToolEventRecord[] = [];
  for (const filePath of uniqueStrings(input.paths)) {
    let archiveError: unknown;
    try {
      await input.archiveMarkdownOutput(input.threadId, filePath);
    } catch (error) {
      archiveError = error;
    }
    if (readThreadOutputMarkdown(input.threadId, filePath)) {
      archivedPaths.push(filePath);
      continue;
    }
    if (archiveError) {
      events.push(canvasDeliveryEvent("canvas_delivery_file_document_archive_failed", input.deliveryId, input.locale, undefined, {
        status: "failed",
        path: filePath,
        summary: input.locale === "zh" ? "Markdown 文档归档失败，未创建不可预览的文档节点。" : "Markdown document archive failed, so no unreadable document node was created.",
        error: archiveError instanceof Error ? archiveError.message : "Unable to archive Markdown output"
      }));
    }
  }
  return { archivedPaths, events };
}

function markdownDeliverableContent(content: ReturnType<typeof resolveCanvasDeliveryContent>, bodyMarkdown: string) {
  const body = bodyMarkdown.trim();
  if (content.bodyMarkdown.trim() === body && content.outlineMarkdown && !isProcessOrDeliveryChatter(content.outlineMarkdown) && !body.includes(content.outlineMarkdown)) {
    return `${content.outlineMarkdown.trim()}\n\n---\n\n${body.trim()}\n`;
  }
  return `${body.trim()}\n`;
}

function selectFinalBodyMarkdown(input: {
  content: ReturnType<typeof resolveCanvasDeliveryContent>;
  assistantText: string;
  events: ToolEventRecord[];
  existingFileMarkdown: string[];
}) {
  const candidates = [
    ...input.existingFileMarkdown,
    ...deliverableMarkdownCandidatesFromEvents(input.events),
    input.content.bodyMarkdown,
    input.assistantText
  ]
    .map((candidate) => sanitizeFinalBodyCandidate(candidate))
    .filter(Boolean);
  return candidates.find(isUsableFinalBodyMarkdown) ?? "";
}

function deliverableMarkdownCandidatesFromEvents(events: ToolEventRecord[]) {
  const candidates: string[] = [];
  for (const event of events) {
    const payload = record(event.payload);
    const toolName = readString(payload.toolName) || readString(payload.tool);
    const eventType = readString(payload.eventType) || event.eventType;
    if (toolName !== "canvas_write" && !/canvas_mutation_committed$/.test(eventType) && !/^canvas_delivery_body_final_committed$/.test(event.eventType)) {
      continue;
    }
    for (const key of ["bodyMarkdown", "body_markdown", "markdown", "content", "text", "summary"]) {
      const value = readString(payload[key]);
      if (value) candidates.push(value);
    }
  }
  return candidates;
}

function readExistingFinalBodyMarkdown(storage: SQLiteStorageRepository, projectId: string, deliveryId: string) {
  const existing = storage.listCanvasNodes(projectId).find((node) => node.id === stableDeliveryId("node", deliveryId, 2));
  const metadata = record(existing?.metadata);
  if (readString(metadata.status) !== "final") return undefined;
  return typeof existing?.content === "string" ? existing.content : undefined;
}

function progressiveBodyDraftNodeId(deliveryId: string) {
  return stableDeliveryId("node", deliveryId, 4);
}

function readThreadOutputMarkdown(threadId: string, virtualPath: string) {
  return readArchivedMarkdownOutputSync(threadId, virtualPath);
}

function sanitizeFinalBodyCandidate(value: string) {
  return value
    .replace(/<facetwrite_canvas_delivery>[\s\S]*?<\/facetwrite_canvas_delivery>/gi, "")
    .replace(/```facetwrite_canvas_delivery\s*[\s\S]*?```/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !isRawToolOutputLine(line))
    .join("\n")
    .trim();
}

function usableExistingBodyMarkdown(value: string) {
  const candidate = sanitizeFinalBodyCandidate(value);
  return isUsableFinalBodyMarkdown(candidate) ? candidate : "";
}

function isLikelyDeliverableMarkdown(value: string) {
  const text = value.trim();
  if (!text || isProcessClarificationText(text) || isProcessOrDeliveryChatter(text)) return false;
  if (containsInternalRuntimeProtocol(text)) return false;
  const plainLength = text.replace(/\s+/g, " ").length;
  const headingCount = (text.match(/^#{1,3}\s+\S/gm) ?? []).length;
  const listCount = (text.match(/^(?:[-*+]\s+|\d+[.)]\s+)\S/gm) ?? []).length;
  const tableRowCount = (text.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
  const sourceCount = extractSourceLinks({ text, limit: 20 }).length;
  const hasStructure = headingCount > 0 || listCount >= 3 || tableRowCount >= 3;
  if (plainLength >= 1200 && hasStructure) return true;
  if (plainLength >= 700 && sourceCount >= 3 && hasStructure) return true;
  if (plainLength >= 700 && tableRowCount >= 3 && /(summary|findings|research gaps|综述|摘要|核心|发现|研究空白|参考文献)/i.test(text)) return true;
  return false;
}

function isUsableFinalBodyMarkdown(value: string) {
  const text = value.trim();
  if (!text || isProcessClarificationText(text) || isProcessOrDeliveryChatter(text)) return false;
  if (containsInternalRuntimeProtocol(text)) return false;
  const plainLength = text.replace(/\s+/g, " ").length;
  const hasHeading = /^#{1,3}\s+\S/m.test(text);
  const hasList = /^(?:[-*+]\s+|\d+[.)]\s+)\S/m.test(text);
  const hasTable = /^\s*\|.+\|\s*$/m.test(text);
  const hasSentence = /[.!?。！？]/.test(text);
  return plainLength >= 40 && (hasHeading || hasList || hasTable || hasSentence);
}

function isProcessOrDeliveryChatter(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (/i['’]?ve loaded .{0,80}skill/i.test(text)) return true;
  if (/let me clarify .{0,120}before proceeding/i.test(text)) return true;
  if (/need to execute .{0,80}workflow/i.test(text) && /clarify|confirm|question/i.test(text)) return true;
  if (/^(?:document ready|文档已生成|完整 Markdown 已保存|The full Markdown has been saved)\b/i.test(text)) return true;
  if (/^#\s*(?:Document ready|文档已生成)\b/i.test(text)) return true;
  return false;
}

function writeFallbackMarkdownDeliverable(threadId: string, deliveryId: string, markdown: string) {
  const manager = createThreadDirectoryManager(resolveFacetWritePaths().appRoot);
  const outputsRoot = path.resolve(manager.threadDataRoot(threadId), "user-data", "outputs");
  mkdirSync(outputsRoot, { recursive: true });
  const fileName = `${safeOutputFileStem(`facetwrite-delivery-${deliveryId}`)}.md`;
  const resolved = path.resolve(outputsRoot, fileName);
  if (!resolved.startsWith(`${outputsRoot}${path.sep}`)) {
    throw new Error("Markdown deliverable path must stay inside this thread's outputs directory");
  }
  writeFileSync(resolved, markdown, "utf8");
  return `/mnt/user-data/outputs/${fileName}`;
}

function safeOutputFileStem(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "facetwrite-delivery";
}

function mergeSourceLinks(...groups: SourceLink[][]) {
  const seen = new Set<string>();
  const merged: SourceLink[] = [];
  for (const group of groups) {
    for (const source of group) {
      if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) continue;
      seen.add(source.url);
      merged.push(source);
      if (merged.length >= 40) return merged;
    }
  }
  return merged;
}

function fileDeliveryBodySummary(locale: GenerateRequest["locale"], bodyMarkdown: string) {
  const title = locale === "zh" ? "正文摘要" : "Body summary";
  const summary = canvasBodyExcerpt(bodyMarkdown, locale);
  return [
    `# ${title}`,
    "",
    summary
  ].join("\n");
}

function fileDeliveryAssistantText(locale: GenerateRequest["locale"], filePaths: string[]) {
  const heading = locale === "zh" ? "文档已生成" : "Document ready";
  const message = locale === "zh"
    ? "完整 Markdown 已保存为画布文档节点，可打开预览；正文节点保留本次结果摘要。"
    : "The full Markdown has been saved as a Canvas document node for preview; the Body node contains the result summary.";
  return [
    `# ${heading}`,
    "",
    message,
    "",
    ...filePaths.map((filePath) => `- ${locale === "zh" ? "文档" : "Document"}: \`${filePath}\``)
  ].join("\n");
}

function processClarificationAssistantText(locale: GenerateRequest["locale"]) {
  return locale === "zh"
    ? "Agent 返回了需要补充信息的过程话术。已保留画布上的中间产物和参考来源，可继续补充选择后推进。"
    : "The Agent returned a clarification prompt instead of a final body. The Canvas progress notes and references were preserved so you can continue with the needed choice.";
}

function processClarificationRecoveryNode(locale: GenerateRequest["locale"], deliveryId: string, sourceCount: number): CanvasDeliveryPlan["nodes"][number] {
  const title = locale === "zh" ? "需要补充信息" : "Clarification needed";
  const content = [
    `# ${title}`,
    "",
    locale === "zh"
      ? "Agent 返回了过程澄清话术，而不是最终正文。系统没有把该话术写入正文或 Markdown 文档；已保留当前 Canvas 中间产物和参考来源，便于继续运行。"
      : "The Agent returned process clarification text instead of final body content. That text was not written into the Body or Markdown file; existing Canvas progress notes and references were preserved for continuation.",
    "",
    `- ${locale === "zh" ? "已收集来源" : "Collected sources"}: ${sourceCount}`
  ].join("\n");
  return {
    id: stableDeliveryId("node", deliveryId, 901),
    kind: "reference",
    title,
    content,
    x: 2720,
    y: 520,
    width: 520,
    height: 260,
    metadata: {
      deliveryId,
      phase: "process_clarification",
      progressive: true,
      status: "recoverable"
    },
    includeInProjectContext: false
  };
}

function hasAgentClarificationEvent(events: ToolEventRecord[]) {
  return events.some(isAgentClarificationEvent);
}

function latestInvalidAgentClarificationEvent(events: ToolEventRecord[]) {
  return events.findLast(isInvalidAgentClarificationEvent);
}

function shouldRepairAgentClarification(events: ToolEventRecord[], text: string, finishReason?: string) {
  if (!latestInvalidAgentClarificationEvent(events)) return false;
  if (hasAgentClarificationEvent(events)) return false;
  const visible = stripAppendedSources(text).trim();
  return finishReason === "clarification_required"
    || !visible
    || isProcessClarificationText(visible);
}

function hasPostClarificationProgress(events: ToolEventRecord[]) {
  const clarificationIndex = events.findIndex(isAgentClarificationEvent);
  if (clarificationIndex < 0) return false;
  return events.slice(clarificationIndex + 1).some((event) => {
    if (isAgentClarificationEvent(event)) return false;
    const payload = record(event.payload);
    const toolName = readString(payload.toolName) || readString(payload.tool);
    const eventType = readString(payload.eventType) || event.eventType;
    return /(?:^|_)tool_(?:started|completed)$/.test(event.eventType)
      || /^canvas_delivery_(?:research|body_checkpoint|body_final|file_document)_committed$/.test(eventType)
      || /^(?:write_file|present_files|web_search|web_fetch|knowledge_base)$/.test(toolName);
  });
}

function unavailableFinalBodySummary(locale: GenerateRequest["locale"], sourceCount: number) {
  const title = locale === "zh" ? "正文摘要" : "Body summary";
  const message = locale === "zh"
    ? "本次运行没有返回可作为最终正文的完整综述内容。已保留画布上的中间摘录和参考来源，请重试或继续运行以生成正式正文。"
    : "This run did not return complete deliverable body content. The Canvas keeps the progress notes and references; retry or continue the run to generate the final body.";
  return [
    `# ${title}`,
    "",
    message,
    "",
    `- ${locale === "zh" ? "已收集来源" : "Collected sources"}: ${sourceCount}`
  ].join("\n");
}

function canvasBodyExcerpt(value: string, locale: GenerateRequest["locale"]) {
  const cleaned = value
    .replace(/<facetwrite_canvas_delivery>[\s\S]*?<\/facetwrite_canvas_delivery>/gi, "")
    .replace(/^#+\s*(?:sources|references|来源|参考文献)\b[\s\S]*$/gim, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*(?:完整 Markdown|The full Markdown|Document:|文档:).*(?:\/mnt\/user-data\/outputs|document node|文档节点)/i.test(line))
    .filter((line) => !isRawToolOutputLine(line))
    .join("\n")
    .trim();
  if (!cleaned) return locale === "zh" ? "最终摘要已生成，完整内容请打开文档节点预览。" : "The final summary is ready. Open the document node for the full content.";
  const limit = 2600;
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trimEnd()}\n\n...`;
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
  item?: { nodeId: string; title: string; node?: unknown },
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
      ...(item ? { nodeId: item.nodeId, title: item.title, ...(item.node ? { node: item.node } : {}) } : {}),
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
  const entryDraft = progressiveEvidenceEntry(input.payload.locale, toolName, payload);
  if (!entryDraft) return [];
  if (!entryDraft.sources.length) return [];
  const evidenceKey = progressiveEvidenceKey(entryDraft);
  if (evidenceKey && hasCommittedProgressiveEvidence(input.storage, input.projectId, input.deliveryId, evidenceKey)) return [];
  const sequence = input.nextSequence();
  const entry: ProgressiveEvidenceEntry = { ...entryDraft, sequence };
  if (!entry.diagnostic) input.onEvidenceEntry?.(entry);
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
      metadata: { deliveryId: input.deliveryId, phase: "research", researchIndex: sequence, toolName, ...(evidenceKey ? { evidenceKey } : {}) }
    }],
    edges: []
  };
  const [committed] = commitCanvasDelivery(input.storage, input.projectId, plan);
  return committed ? [canvasDeliveryEvent("canvas_delivery_research_committed", input.deliveryId, input.payload.locale, committed)] : [];
}

function commitProgressiveFileDocumentDelivery(input: {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  storage: SQLiteStorageRepository;
  deliveryId: string;
  event: ToolEventRecord;
  availableFilePaths?: Set<string>;
  nextSequence: () => number;
}): ToolEventRecord[] {
  if (!isProgressiveCanvasDeliveryEnabled(input.payload)) return [];
  if (!isProgressiveToolCompletion(input.event)) return [];
  const payload = record(input.event.payload);
  const toolName = readString(payload.toolName) || readString(payload.tool);
  const documents = fileDocumentEntries(input.payload.locale, toolName, payload)
    .filter((document) => !input.availableFilePaths || input.availableFilePaths.has(document.path));
  if (!documents.length) return [];
  const committed: Array<{ nodeId: string; title: string; path: string; node?: unknown }> = [];
  for (const document of documents) {
    const sequence = input.nextSequence();
    const nodeId = stableFileDocumentNodeId(input.deliveryId, document.path);
    const existing = input.storage.listCanvasNodes(input.projectId).find((node) => node.id === nodeId);
    const node = {
      id: nodeId,
      kind: "file_document" as const,
      title: document.title,
      content: fileDocumentNodeContent(input.payload.locale, document),
      x: 1280 + (sequence % 3) * 280,
      y: 760 + Math.floor(sequence / 3) * 220,
      width: 360,
      height: 220,
      metadata: {
        canvasDelivery: true,
        deliveryId: input.deliveryId,
        phase: "file_document",
        fileDocument: { ...document, threadId: input.threadId }
      },
      includeInProjectContext: false
    };
    let committedNode: unknown;
    if (existing) {
      committedNode = input.storage.updateCanvasNode(input.projectId, nodeId, {
        kind: node.kind,
        title: node.title,
        content: node.content,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        metadata: node.metadata,
        includeInProjectContext: node.includeInProjectContext
      });
    } else {
      committedNode = input.storage.createCanvasNode(input.projectId, node);
    }
    committed.push({ nodeId, title: document.title, path: document.path, node: committedNode });
  }
  return committed.map((item) => canvasDeliveryEvent("canvas_delivery_file_document_committed", input.deliveryId, input.payload.locale, item, {
    displayTitle: input.payload.locale === "zh" ? "文档节点" : "Document file"
  }));
}

type ProgressiveEvidenceEntry = {
  sequence: number;
  locale: GenerateRequest["locale"];
  toolName: string;
  diagnostic?: boolean;
  query?: string;
  url?: string;
  path?: string;
  command?: string;
  summary?: string;
  snippet?: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
};

function isAgentClarificationEvent(event: ToolEventRecord) {
  const payload = record(event.payload);
  const type = readString(payload.type) || readString(payload.eventType);
  return /agent_clarification_requested$/.test(event.eventType) || type === "agent_clarification_requested";
}

function isInvalidAgentClarificationEvent(event: ToolEventRecord) {
  const payload = record(event.payload);
  const type = readString(payload.type) || readString(payload.eventType);
  return /agent_clarification_invalid$/.test(event.eventType) || type === "agent_clarification_invalid";
}

function withAgentClarificationRepairPolicy(payload: GenerateRequest, invalidEvent: ToolEventRecord | undefined): GenerateRequest {
  const invalidPayload = record(invalidEvent?.payload);
  const existingPolicy = record(payload.contextValues?.facetwrite_clarification_policy);
  const existingSkillRefs = readStringList(existingPolicy.skillRefs);
  const existingDisabledSkillRefs = readStringList(existingPolicy.disabledSkillRefs);
  const existingCanvas = record(existingPolicy.canvas);
  const payloadCanvas = record(payload.contextValues?.canvas);
  const reason = readString(invalidPayload.reason) || "invalid_payload";
  const optionCount = typeof invalidPayload.optionCount === "number" ? invalidPayload.optionCount : undefined;
  const originalInstruction = stripSelectedClarificationInstruction(existingPolicy.originalInstruction)
    || stripSelectedClarificationInstruction(payload.chatInstruction)
    || stripSelectedClarificationInstruction(payload.freeTextPrompt);
  const optionCountText = optionCount ? ` It had ${optionCount} options.` : "";
  const instruction = payload.locale === "zh"
    ? `上一轮 ask_clarification 参数无效，原因：${reason}${optionCount ? `，选项数为 ${optionCount}` : ""}。请立即重新调用 ask_clarification，保留相同澄清意图，但必须只给 2-3 个互斥选项；每个选项必须有 id、label、detail 或 description，最多一个 recommended:true。不要继续执行任务，不要调用搜索或写文件工具，不要输出普通文本。`
    : `The previous ask_clarification payload was invalid: ${reason}.${optionCountText} Immediately call ask_clarification again with the same clarification intent, but with only 2-3 mutually exclusive options. Every option must include id, label, and detail or description, with at most one recommended:true. Do not continue the task, do not call search or file tools, and do not output ordinary text.`;
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      facetwrite_clarification_policy: {
        ...existingPolicy,
        mode: "skill_scope_guard",
        source: "server_clarification_repair",
        originalInstruction,
        skillRefs: existingSkillRefs.length ? existingSkillRefs : payload.transientSkillRefs ?? [],
        disabledSkillRefs: existingDisabledSkillRefs.length ? existingDisabledSkillRefs : payload.disabledSkillRefs ?? [],
        ...(readOptionalRuntimeBudgetProfile(existingPolicy.runtimeBudgetProfile) ?? payload.runtimeBudgetProfile
          ? { runtimeBudgetProfile: readOptionalRuntimeBudgetProfile(existingPolicy.runtimeBudgetProfile) ?? payload.runtimeBudgetProfile }
          : {}),
        ...(Object.keys(existingCanvas).length || Object.keys(payloadCanvas).length ? { canvas: Object.keys(existingCanvas).length ? existingCanvas : payloadCanvas } : {}),
        invalidReason: reason,
        ...(optionCount ? { invalidOptionCount: optionCount } : {}),
        instruction
      }
    }
  };
}

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
  const title = input.payload.locale === "zh" ? "正文草稿" : "Body draft";
  const content = progressiveBodyCheckpointMarkdown(input.payload.locale, input.entries);
  const plan: CanvasDeliveryPlan = {
    required: true,
    moduleId: "document_batch",
    nodes: [{
      id: progressiveBodyDraftNodeId(input.deliveryId),
      kind: "document",
      title,
      content,
      x: 960,
      y: 240,
      width: 620,
      height: 520,
      metadata: { deliveryId: input.deliveryId, phase: "body_draft", checkpoint: true, evidenceCount: input.entries.length }
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

function progressiveEvidenceEntry(locale: GenerateRequest["locale"], toolName: string, payload: Record<string, unknown>): Omit<ProgressiveEvidenceEntry, "sequence"> | undefined {
  const entry: Omit<ProgressiveEvidenceEntry, "sequence"> = {
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
  if (!entry.query && !entry.url && !entry.path && !entry.command && !entry.summary && !entry.snippet && !entry.sources.length) {
    if (toolName !== "web_search") return undefined;
    return {
      locale,
      toolName,
      diagnostic: true,
      summary: locale === "zh" ? "本轮联网搜索已完成，但未捕获可展示的来源或摘要。" : "This web search completed, but no displayable sources or summary were captured.",
      sources: []
    };
  }
  return entry;
}

function researchNoteMarkdown(input: ProgressiveEvidenceEntry) {
  const label = input.locale === "zh"
    ? { sources: "来源" }
    : { sources: "Sources" };
  const lines = [
    `# ${input.locale === "zh" ? "进度摘录" : "Progress note"}`,
    "",
    `## ${label.sources}`,
    formatSourceLinks(input.sources)
  ];
  return lines.join("\n");
}

function progressiveBodyCheckpointMarkdown(locale: GenerateRequest["locale"], entries: ProgressiveEvidenceEntry[]) {
  const recent = entries.slice(-8);
  const heading = locale === "zh" ? "正文草稿" : "Body draft";
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

function isCanvasCommitEvent(event: ToolEventRecord) {
  return /^canvas_delivery_.*_committed$/.test(event.eventType)
    || /(?:^|_)canvas_mutation_committed$/.test(event.eventType)
    || /(?:^|_)canvas_node_committed$/.test(event.eventType);
}

function withCanvasDeliveryProgressMetadata(event: ToolEventRecord, metadata: Record<string, unknown>): ToolEventRecord {
  const payload = record(event.payload);
  const compactMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
  return { ...event, payload: { ...payload, ...compactMetadata } };
}

function readCanvasDeliveryResearchIndex(event: ToolEventRecord) {
  const payload = record(event.payload);
  if (typeof payload.researchIndex === "number" && Number.isFinite(payload.researchIndex)) return payload.researchIndex;
  const node = record(payload.node);
  const metadata = record(node.metadata);
  return typeof metadata.researchIndex === "number" && Number.isFinite(metadata.researchIndex)
    ? metadata.researchIndex
    : undefined;
}

function isProgressiveEvidenceTool(toolName: string) {
  return (progressiveEvidenceTools as readonly string[]).includes(toolName);
}

type FileDocumentEntry = {
  path: string;
  fileName: string;
  title: string;
  status: "written" | "presented";
  sourceTool: string;
};

function fileDocumentEntries(locale: GenerateRequest["locale"], toolName: string, payload: Record<string, unknown>): FileDocumentEntry[] {
  if (toolName !== "write_file" && toolName !== "present_files") return [];
  const status = toolName === "present_files" ? "presented" : "written";
  const paths = toolName === "present_files"
    ? readStringList(payload.filepaths ?? payload.file_paths ?? payload.paths ?? payload.files)
    : [readString(payload.path) || readString(payload.file_path) || readString(payload.filePath) || readString(payload.filepath)];
  return uniqueStrings(paths)
    .map(normalizeOutputMarkdownPath)
    .filter((path): path is string => Boolean(path))
    .map((path) => {
      const fileName = outputFileName(path);
      return {
        path,
        fileName,
        title: locale === "zh" ? `文档：${fileName}` : `Document: ${fileName}`,
        status,
        sourceTool: toolName
      };
    });
}

function fileDocumentNodeContent(locale: GenerateRequest["locale"], document: FileDocumentEntry) {
  const status = document.status === "presented"
    ? locale === "zh" ? "已呈现，可预览" : "Presented, ready to preview"
    : locale === "zh" ? "已写入，等待呈现" : "Written, waiting to be presented";
  return [
    `# ${document.title}`,
    "",
    `- ${locale === "zh" ? "文件" : "File"}: ${document.fileName}`,
    `- ${locale === "zh" ? "路径" : "Path"}: \`${document.path}\``,
    `- ${locale === "zh" ? "状态" : "Status"}: ${status}`
  ].join("\n");
}

function normalizeOutputMarkdownPath(value: string) {
  const path = value.trim().replace(/\\/g, "/");
  if (!path) return undefined;
  const match = path.match(/(?:^|\/)mnt\/user-data\/outputs\/(.+\.md)$/i);
  if (!match) return undefined;
  const relative = match[1].split("/").filter((part) => part && part !== "." && part !== "..").join("/");
  if (!relative || !/\.md$/i.test(relative)) return undefined;
  return `/mnt/user-data/outputs/${relative}`;
}

function outputFileName(path: string) {
  const decoded = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "document.md");
  return decoded || "document.md";
}

function stableFileDocumentNodeId(deliveryId: string, path: string) {
  return stableDeliveryId("node", deliveryId, 7000 + (hashString(path) % 2000));
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function readStringList(value: unknown) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function sanitizeProgressText(value: string, options: { allowPaths?: boolean } = {}) {
  if (containsInternalRuntimeProtocol(value)) return "";
  if (isRawToolOutputText(value, options)) return "";
  const sanitized = value
    .replace(/__FACETWRITE_EVENT__[\s\S]*/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(redactSecretLikeText)
    .filter((line) => !isRawToolOutputLine(line, options))
    .filter((line) => line && !/^#\s*(?:AgentCard|Loaded Skills|Current User Instruction|Context|Output Contract)\b/i.test(line))
    .filter((line) => !/^\[redacted credential\]$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  return containsInternalRuntimeProtocol(sanitized) ? "" : sanitized;
}

function isRawToolOutputText(value: string, options: { allowPaths?: boolean } = {}) {
  const text = value.trim();
  if (!text) return false;
  if (!options.allowPaths && /(?:^|\s)\/mnt\/skills\//i.test(text)) return true;
  if (/<\/?(?:html|body|head|script|style|main|nav|footer|p|div|span|a)\b/i.test(text)) return true;
  if (/\b(?:Skip to main content|Donate\s*>|Error invoking tool|Traceback \(most recent call last\)|kwargs?\s*\{)/i.test(text)) return true;
  if (/\bdescription:\s*Use this skill\b/i.test(text) || /\bSKILL\.md\b/i.test(text)) return true;
  if (/[A-Za-z0-9+/]{180,}={0,2}/.test(text)) return true;
  return false;
}

function isRawToolOutputLine(value: string, options: { allowPaths?: boolean } = {}) {
  const line = value.trim();
  if (!line) return false;
  if (!options.allowPaths && /\/mnt\/skills\//i.test(line)) return true;
  if (/<\/?(?:html|body|head|script|style|main|nav|footer|p|div|span|a)\b/i.test(line)) return true;
  if (/\b(?:Skip to main content|Donate\s*>|Error invoking tool|Traceback \(most recent call last\)|kwargs?\s*\{)/i.test(line)) return true;
  if (/\bdescription:\s*Use this skill\b/i.test(line) || /\bSKILL\.md\b/i.test(line)) return true;
  if (/[A-Za-z0-9+/]{180,}={0,2}/.test(line)) return true;
  return false;
}

function redactSecretLikeText(value: string) {
  return value
    .replace(/\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|token|password|secret|cookie)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted credential]");
}

function progressiveEvidenceKey(input: Omit<ProgressiveEvidenceEntry, "sequence">) {
  const sourceUrl = input.sources[0]?.url;
  const key = sourceUrl || input.url || input.query || input.path || input.command;
  return key ? `${input.toolName}:${key.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240)}` : "";
}

function hasCommittedProgressiveEvidence(storage: SQLiteStorageRepository, projectId: string, deliveryId: string, evidenceKey: string) {
  return storage.listCanvasNodes(projectId).some((node) => {
    const metadata = record(node.metadata);
    return metadata.deliveryId === deliveryId && metadata.phase === "research" && metadata.evidenceKey === evidenceKey;
  });
}

function readResearchSources(value: unknown): Array<{ title: string; url: string; snippet?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const url = readString(source.url);
    if (!/^https?:\/\//i.test(url)) return [];
    const title = sanitizeProgressText(readString(source.title)) || url;
    const snippet = sanitizeProgressText(readString(source.snippet));
    return [{ title, url, ...(snippet ? { snippet } : {}) }];
  }).slice(0, 10);
}

function readCanvasWorkflowMode(contextValues: GenerateRequest["contextValues"]): CanvasWorkflowMode {
  const canvas = record(contextValues?.canvas);
  const workflow = record(canvas.workflow);
  return isCanvasWorkflowMode(workflow.mode) ? workflow.mode : "batch_delivery";
}

function createStageProgressEmitter(input: {
  locale: GenerateRequest["locale"];
  threadId: string;
  timeline: ReturnType<typeof createRunTimelineBuilder>;
  agentPlanPayload: Record<string, unknown>;
  onProgressEvent?: (event: AgentProgressEvent) => void;
  emitTimeline: (event: RunTimelineEvent) => void;
}) {
  const emitted = new Set<string>();
  const emit = (key: string, text: string, next?: string, options: {
    phase?: string;
    status?: AgentProgressEvent["status"];
    title?: string;
    interventionHint?: string;
    source?: string;
    loopId?: string;
    loopIndex?: number;
    stepKind?: AgentProgressEvent["stepKind"];
    actionId?: string;
    observationId?: string;
  } = {}) => {
    if (emitted.has(key)) return;
    const summary = safeProgressText(text);
    if (!summary) return;
    emitted.add(key);
    const safeNext = next ? safeProgressText(next) : "";
    const safeTitle = options.title ? safeProgressText(options.title) : "";
    const safeInterventionHint = options.interventionHint ? safeProgressText(options.interventionHint) : "";
    const progress: AgentProgressEvent = {
      id: `progress_${crypto.randomUUID()}`,
      threadId: input.threadId,
      stageId: key,
      ...(options.loopId ? { loopId: options.loopId } : {}),
      ...(options.loopIndex !== undefined ? { loopIndex: options.loopIndex } : {}),
      ...(options.stepKind ? { stepKind: options.stepKind } : {}),
      ...(options.actionId ? { actionId: options.actionId } : {}),
      ...(options.observationId ? { observationId: options.observationId } : {}),
      status: options.status ?? "running",
      ...(options.phase ? { phase: options.phase } : {}),
      ...(safeTitle ? { title: safeTitle } : {}),
      summary,
      ...(safeNext ? { next: safeNext } : {}),
      ...(safeInterventionHint ? { interventionHint: safeInterventionHint } : {}),
      visibility: "stage",
      source: options.source ?? "facetwrite_stage",
      createdAt: new Date().toISOString()
    };
    input.onProgressEvent?.(progress);
    emitProgressTimeline(progress);
  };
  const emitProgressTimeline = (progress: AgentProgressEvent) => {
    const timelineEvent = input.timeline.event(
      "decision",
      progress.status ?? "running",
      progress.title || (input.locale === "zh" ? "阶段汇报" : "Stage update"),
      progress.summary,
      {
        ...input.agentPlanPayload,
        kind: "progress_report",
        progressId: progress.id,
        stageId: progress.stageId,
        loopId: progress.loopId,
        loopIndex: progress.loopIndex,
        stepKind: progress.stepKind,
        actionId: progress.actionId,
        observationId: progress.observationId,
        completionStatus: progress.completionStatus,
        completionReasons: progress.completionReasons,
        missingRequirements: progress.missingRequirements,
        phase: progress.phase,
        next: progress.next,
        evidence: progress.evidence,
        interventionHint: progress.interventionHint,
        source: progress.source,
        visibility: progress.visibility ?? "stage",
        signal: progress.stepKind ? "loop_progress" : "stage_progress"
      }
    );
    input.emitTimeline(progress.runId ? { ...timelineEvent, runId: progress.runId } : timelineEvent);
  };
  const emitEvidenceStage = (phase: "started" | "completed") => {
    if (phase === "started") {
      emit(
        "evidence:collecting",
        input.locale === "zh" ? "正在收集和整理可用于回答的资料。" : "Collecting and organizing material for the answer.",
        input.locale === "zh" ? "你可以补充来源偏好、范围或格式要求。" : "You can still add source, scope, or format guidance.",
        {
          phase: "evidence",
          title: input.locale === "zh" ? "资料收集" : "Evidence collection",
          interventionHint: input.locale === "zh" ? "可补充来源偏好或研究范围。" : "You may add source preferences or scope constraints."
        }
      );
      return;
    }
    emit(
      "evidence:reviewing",
      input.locale === "zh" ? "资料已返回，正在筛选能支撑最终回答和 Canvas 的内容。" : "Material returned; selecting what supports the final answer and Canvas.",
      input.locale === "zh" ? "下一步会把可用内容整理成交付物。" : "Next, the useful material will be shaped into the deliverable.",
      { phase: "evidence", title: input.locale === "zh" ? "资料筛选" : "Evidence review" }
    );
  };
  const emitDeliveryStage = (key: string, started: boolean) => {
    emit(
      key,
      started
        ? input.locale === "zh" ? "正在准备交付物和 Canvas 更新。" : "Preparing deliverables and Canvas updates."
        : input.locale === "zh" ? "交付物或 Canvas 节点已更新，正在校对最终内容。" : "Deliverables or Canvas nodes were updated; reviewing the final content.",
      started
        ? input.locale === "zh" ? "此阶段适合补充文风、格式或交付目标。" : "This is a good moment to add tone, format, or delivery constraints."
        : input.locale === "zh" ? "下一步会整理最终答复。" : "Next, the final response will be assembled.",
      {
        phase: "delivery",
        title: input.locale === "zh" ? "交付物更新" : "Deliverable update",
        interventionHint: started
          ? input.locale === "zh" ? "可调整文风、格式或交付目标。" : "You may adjust tone, format, or delivery goals."
          : undefined
      }
    );
  };
  return {
    emit,
    fromRuntimeSignal(signal: AgentBackendRuntimeSignal) {
      const progress = progressEventFromRuntimeSignal(signal, input.threadId);
      if (!progress) return;
      if (progress.visibility === "raw") {
        input.onProgressEvent?.(progress);
        return;
      }
      const key = progress.stageId || progress.loopId || `${progress.phase || "runtime"}:${progress.status || "running"}:${progress.summary}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      input.onProgressEvent?.(progress);
      emitProgressTimeline(progress);
    },
    fromToolEvent(event: ToolEventRecord) {
      if (/^canvas_delivery_outline_started$/.test(event.eventType)) {
        emitDeliveryStage("delivery:canvas:started", true);
        return;
      }
      if (/^canvas_delivery_outline_committed$/.test(event.eventType)) {
        emitDeliveryStage("delivery:canvas:outlined", false);
        return;
      }
      if (/^canvas_delivery_body_started$/.test(event.eventType)) {
        emitDeliveryStage("delivery:body:started", true);
        return;
      }
      if (/^canvas_delivery_body_checkpoint_committed$/.test(event.eventType)) {
        emitDeliveryStage("delivery:body:updated", false);
        return;
      }
      if (/(?:^|_)canvas_mutation_committed$/.test(event.eventType) || /(?:^|_)artifact_(?:committed|staged)$/.test(event.eventType)) {
        emitDeliveryStage("delivery:artifact:updated", false);
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
      if (phase === "failed") {
        emit(
          `tool:${toolName}:failed`,
          input.locale === "zh" ? "有一个工具步骤失败，Agent 会基于可用结果继续或恢复。" : "A tool step failed; the agent will continue or recover with available results.",
          input.locale === "zh" ? "原生日志里保留了失败细节。" : "The raw log keeps the failure detail.",
          { phase: "recovery", status: "failed", title: input.locale === "zh" ? "工具恢复" : "Tool recovery" }
        );
      } else if (isEvidenceTool(toolName)) {
        emitEvidenceStage(phase === "started" ? "started" : "completed");
      } else if (isDeliveryTool(toolName)) {
        emitDeliveryStage(`delivery:${phase}`, phase === "started");
      }
    }
  };
}

function isEvidenceTool(toolName: string) {
  return /^(?:web_search|web_fetch|knowledge_base|ask_clarification|read_file|readfile|grep|glob|ls)$/i.test(toolName);
}

function isDeliveryTool(toolName: string) {
  return /^(?:canvas_write|canvas_delivery|write_file|present_files|artifact_stage)$/i.test(toolName);
}
