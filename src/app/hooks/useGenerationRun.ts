import { useEffect, useRef, useState } from "react";
import type { AgentCard, AgentClarification, CanvasNode, CanvasWriteSuggestion, PlanRun, RunTimelineEvent, StoredOutputVersion, StoredToolEvent, ThreadStateResponse } from "../../features/agents/types";
import { generateText, generateTextStream, requestRunIntervention } from "../../features/generation/generationClient";
import type { AgentProgressEvent, CollaborationMessage, GenerateRequest, GenerateResponse, QueuedRunInput } from "../../features/generation/types";
import type { Locale } from "../../features/i18n/types";
import { buildRequestToolState } from "../../features/workspace/planUiPolicy";
import {
  enqueueTypewriterToken,
  getTypewriterFinalPatch,
  reconcileCollaborationMessages,
  takeTypewriterText,
  TYPEWRITER_TICK_MS,
  type TypewriterState
} from "./streamingTypewriter";
import {
  createLiveToolEventState,
  readLiveCanvasNodeSnapshot,
  reduceLiveToolEvent,
  threadStateRefreshModeForToolEvent
} from "./toolEventPresentation";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol";

type UseGenerationRunOptions = {
  activeAgent: AgentCard;
  locale: Locale;
  toolState: GenerateRequest["toolState"];
  selectedCanvasNodeId?: string;
  getContextValues: () => Record<string, unknown>;
  currentThreadId: string;
  currentProjectId: string;
  ensureThreadId: () => Promise<string>;
  onPersistThreadId: (threadId: string) => void;
  onRefreshThreadState: (threadId: string) => Promise<void>;
  onFetchAndApplyThreadState: (threadId: string) => Promise<ThreadStateResponse>;
  onApplyThreadState: (state: ThreadStateResponse) => void;
  onApplyLiveThreadState: (state: ThreadStateResponse) => void;
  onApplyLiveCanvasNode: (node: CanvasNode) => void;
  onApproveCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRefreshProjectSurfaces: () => Promise<void>;
  getPendingCanvasWriteRequestIds: () => string[];
  beforeGenerate: () => Promise<void>;
};

type TypewriterTarget = "editable" | `message:${string}`;

type QueuedChatInput = {
  id: string;
  text: string;
  status: QueuedRunInput["status"];
  createdAt: string;
  modelOverrides?: GenerateRequest["modelOverrides"];
  requestContext?: Record<string, unknown>;
};

export type ChatSendResult =
  | { ok: true; state: ThreadStateResponse }
  | { ok: false; error: string; threadId?: string; aborted?: boolean };

type LiveThreadStateRefreshRequest = {
  threadId: string;
  operationId: number;
  currentOperationId: () => number;
  fetchAndApply: (threadId: string) => Promise<ThreadStateResponse>;
  apply: (state: ThreadStateResponse) => void;
  onSettled?: () => void;
};

export function createLiveThreadStateRefreshScheduler() {
  let inFlight: Promise<void> | null = null;
  let pending: LiveThreadStateRefreshRequest | null = null;
  let deferredTimer: ReturnType<typeof setTimeout> | null = null;
  let deferred: LiveThreadStateRefreshRequest | null = null;
  let generation = 0;
  let sequence = 0;

  const run = (request: LiveThreadStateRefreshRequest, runGeneration = generation) => {
    const refreshId = `live_refresh_${++sequence}`;
    const startedAt = performance.now();
    traceLiveRefresh("start", refreshId, request, { generation: runGeneration });
    const refresh = request.fetchAndApply(request.threadId)
      .then((state) => {
        if (runGeneration !== generation || request.operationId !== request.currentOperationId() || state.thread.id !== request.threadId) {
          traceLiveRefresh("skip_stale", refreshId, request, {
            elapsedMs: Math.round(performance.now() - startedAt),
            generation: runGeneration,
            currentOperationId: request.currentOperationId(),
            stateThreadId: state.thread.id
          });
          return;
        }
        request.apply(state);
        traceLiveRefresh("applied", refreshId, request, {
          elapsedMs: Math.round(performance.now() - startedAt),
          planCount: state.plans?.length ?? 0,
          messageCount: state.messages.length
        });
      })
      .catch((error) => {
        console.warn("Live thread state refresh failed", error instanceof Error ? error.message : "Unknown error");
        traceLiveRefresh("failed", refreshId, request, {
          elapsedMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : "Unknown error"
        });
      })
      .finally(() => {
        request.onSettled?.();
        traceLiveRefresh("settled", refreshId, request, {
          elapsedMs: Math.round(performance.now() - startedAt),
          hasPending: Boolean(pending)
        });
        if (runGeneration !== generation) return;
        if (inFlight === refresh) inFlight = null;
        const next = pending;
        pending = null;
        if (next) run(next, runGeneration);
      });
    inFlight = refresh;
  };

  const clearDeferred = () => {
    if (deferredTimer) globalThis.clearTimeout(deferredTimer);
    deferredTimer = null;
    deferred = null;
  };

  const requestNow = (request: LiveThreadStateRefreshRequest) => {
    if (inFlight) {
      traceLiveRefresh("queued", `live_refresh_pending_${sequence + 1}`, request);
      pending = request;
      return;
    }
    run(request);
  };

  return {
    request: requestNow,
    requestDeferred(request: LiveThreadStateRefreshRequest, delayMs = 800) {
      clearDeferred();
      deferred = request;
      traceLiveRefresh("deferred", `live_refresh_deferred_${sequence + 1}`, request, { delayMs });
      deferredTimer = globalThis.setTimeout(() => {
        const next = deferred;
        deferredTimer = null;
        deferred = null;
        if (next) requestNow(next);
      }, delayMs);
    },
    cancelDeferred() {
      clearDeferred();
    },
    reset() {
      clearDeferred();
      generation += 1;
      inFlight = null;
      pending = null;
      console.info("[FacetWrite live refresh trace]", { phase: "reset", generation });
    }
  };
}

export function useGenerationRun(options: UseGenerationRunOptions) {
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [collaborationMessages, setCollaborationMessages] = useState<CollaborationMessage[]>([]);
  const [outputVersions, setOutputVersions] = useState<StoredOutputVersion[]>([]);
  const [toolEvents, setToolEvents] = useState<StoredToolEvent[]>([]);
  const [runTimelineEvents, setRunTimelineEvents] = useState<RunTimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanRun[]>([]);
  const [agentClarifications, setAgentClarifications] = useState<AgentClarification[]>([]);
  const [canvasWriteSuggestions, setCanvasWriteSuggestions] = useState<CanvasWriteSuggestion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const typewriterRef = useRef<Partial<Record<TypewriterTarget, TypewriterState<TypewriterTarget>>>>({});
  const drainWaitersRef = useRef<Partial<Record<TypewriterTarget, Array<() => void>>>>({});
  const operationIdRef = useRef(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const activeChatMessageIdRef = useRef<string | null>(null);
  const activeRunRef = useRef<{ threadId: string; runId: string } | null>(null);
  const queuedInputsRef = useRef<QueuedChatInput[]>([]);
  const drainingQueuedInputsRef = useRef(false);
  const blockedReasoningMessageIdsRef = useRef<Set<string>>(new Set());
  const liveToolEventStateRef = useRef(createLiveToolEventState());
  const liveStateRefreshRef = useRef(createLiveThreadStateRefreshScheduler());

  useEffect(() => {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    activeChatMessageIdRef.current = null;
    activeRunRef.current = null;
    queuedInputsRef.current = [];
    drainingQueuedInputsRef.current = false;
    blockedReasoningMessageIdsRef.current = new Set();
    liveToolEventStateRef.current = createLiveToolEventState();
    liveStateRefreshRef.current.reset();
    operationIdRef.current += 1;
    setIsGenerating(false);
    setIsChatSending(false);
  }, [options.currentProjectId, options.currentThreadId]);

  useEffect(() => () => {
    liveStateRefreshRef.current.reset();
    for (const state of Object.values(typewriterRef.current)) {
      if (state?.timer) window.clearTimeout(state.timer);
    }
    Object.values(drainWaitersRef.current).flat().forEach((resolve) => resolve?.());
  }, []);

  const resetGeneration = () => {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    activeChatMessageIdRef.current = null;
    activeRunRef.current = null;
    queuedInputsRef.current = [];
    drainingQueuedInputsRef.current = false;
    blockedReasoningMessageIdsRef.current = new Set();
    liveToolEventStateRef.current = createLiveToolEventState();
    liveStateRefreshRef.current.reset();
    operationIdRef.current += 1;
    setGeneration(null);
    setEditableOutput("");
    setCollaborationMessages([]);
    setOutputVersions([]);
    setToolEvents([]);
    setRunTimelineEvents([]);
    setPlans([]);
    setAgentClarifications([]);
    setCanvasWriteSuggestions([]);
    setActiveVersionId(undefined);
  };

  const stopChatGeneration = () => {
    const messageId = activeChatMessageIdRef.current;
    chatAbortControllerRef.current?.abort();
    if (messageId) {
      flushStreamingText(`message:${messageId}`);
      updateStreamingMessage(messageId, {
        isStreaming: false,
        isReasoningStreaming: false,
        status: "stopped",
        statusLabel: undefined
      });
    }
    setIsChatSending(false);
  };

  const refreshLiveThreadState = (threadId: string, operationId: number, onSettled?: () => void) => {
    liveStateRefreshRef.current.request({
      threadId,
      operationId,
      currentOperationId: () => operationIdRef.current,
      fetchAndApply: options.onFetchAndApplyThreadState,
      apply: options.onApplyLiveThreadState,
      onSettled
    });
  };

  const appendToolEvent = (event: unknown, threadId: string, operationId: number) => {
    const eventType = String((event as { eventType?: unknown }).eventType ?? "tool_event");
    const payload = (event as { payload?: Record<string, unknown> }).payload ?? {};
    const liveEvent = { eventType, payload };
    setToolEvents((current) => [{
      id: crypto.randomUUID(),
      threadId,
      runId: "pending",
      eventType,
      payload,
      createdAt: new Date().toISOString()
    }, ...current]);

    const reduction = reduceLiveToolEvent(liveToolEventStateRef.current, liveEvent, options.locale);
    liveToolEventStateRef.current = reduction.state;
    const activeMessageId = activeChatMessageIdRef.current;
    if (activeMessageId && reduction.statusLabel) {
      updateStreamingMessage(activeMessageId, {
        status: eventStatusPhase(eventType),
        statusLabel: reduction.statusLabel
      });
    } else {
      const chatActivityText = reduction.chatActivityText;
      if (!chatActivityText) return;
      setCollaborationMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: chatActivityText,
        usedMock: false,
        kind: "activity",
        createdAt: new Date().toISOString()
      }]);
    }

    const refreshMode = threadStateRefreshModeForToolEvent(liveEvent);
    if (refreshMode !== "none") {
      const liveNode = readLiveCanvasNodeSnapshot(liveEvent);
      if (liveNode) options.onApplyLiveCanvasNode(liveNode);
      if (activeMessageId && refreshMode === "immediate") {
        updateStreamingMessage(activeMessageId, {
          status: "writing",
          statusLabel: canvasSyncingLabel(options.locale)
        });
      }
      const refreshSettled = activeMessageId && refreshMode === "immediate" ? () => {
        if (operationId !== operationIdRef.current) return;
        updateStreamingMessage(activeMessageId, {
          statusLabel: canvasSyncedLabel(options.locale)
        });
      } : undefined;
      if (refreshMode === "deferred") {
        liveStateRefreshRef.current.requestDeferred({
          threadId,
          operationId,
          currentOperationId: () => operationIdRef.current,
          fetchAndApply: options.onFetchAndApplyThreadState,
          apply: options.onApplyLiveThreadState
        });
      } else {
        liveStateRefreshRef.current.cancelDeferred();
        refreshLiveThreadState(threadId, operationId, refreshSettled);
      }
    }
  };

  const appendTimelineEvent = (event: RunTimelineEvent) => {
    setRunTimelineEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]);
    const activeMessageId = activeChatMessageIdRef.current;
    if (!activeMessageId) return;
    setCollaborationMessages((messages) => messages.map((message) => {
      if (message.id !== activeMessageId) return message;
      const timeline = [...(message.timeline ?? []).filter((item) => item.id !== event.id), event]
        .sort((left, right) => left.sequence - right.sequence);
      return { ...message, timeline };
    }));
  };

  const appendProgressEvent = (event: AgentProgressEvent, assistantMessageId = activeChatMessageIdRef.current) => {
    if (event.runId && event.threadId) {
      activeRunRef.current = { runId: event.runId, threadId: event.threadId };
      if (assistantMessageId) {
        setCollaborationMessages((messages) => messages.map((message) => (
          message.id === assistantMessageId
            ? { ...message, runtimeRun: { runId: event.runId!, threadId: event.threadId! } }
            : message
        )));
      }
    }
    if (event.phase === "intervention" && event.status === "completed") {
      markFirstRequestedInterventionInjected();
    }
    if (event.visibility === "raw") return;
    if (!assistantMessageId || !event.summary.trim()) return;
    setCollaborationMessages((messages) => messages.map((message) => {
      if (message.id !== assistantMessageId) return message;
      const progressSegments = [...(message.progressSegments ?? []).filter((item) => item.id !== event.id), event]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return { ...message, progressSegments };
    }));
  };

  const markQueuedInputStatus = (id: string, status: QueuedRunInput["status"]) => {
    queuedInputsRef.current = queuedInputsRef.current.map((item) => (
      item.id === id ? { ...item, status } : item
    ));
    setCollaborationMessages((messages) => messages.map((message) => (
      message.queuedInput?.id === id
        ? { ...message, queuedInput: { ...message.queuedInput, status } }
        : message
    )));
  };

  const markFirstRequestedInterventionInjected = () => {
    const requested = queuedInputsRef.current.find((item) => item.status === "intervention_requested");
    if (requested) markQueuedInputStatus(requested.id, "injected");
  };

  const updateStreamingMessage = (messageId: string, patch: Partial<CollaborationMessage>) => {
    setCollaborationMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, ...patch } : message
    )));
  };

  const appendReasoningToken = (messageId: string, token: string) => {
    if (!token || blockedReasoningMessageIdsRef.current.has(messageId)) return;
    if (looksUnsafeForReasoningStream(token)) {
      blockedReasoningMessageIdsRef.current.add(messageId);
      updateStreamingMessage(messageId, {
        reasoningText: reasoningBlockedMessage(options.locale),
        isReasoningStreaming: false
      });
      return;
    }
    setCollaborationMessages((messages) => messages.map((message) => (
      message.id === messageId
        ? { ...message, reasoningText: `${message.reasoningText ?? ""}${token}`, isReasoningStreaming: true }
        : message
    )));
  };

  const appendTypewriterText = (target: TypewriterTarget, text: string) => {
    if (target === "editable") {
      setEditableOutput((current) => current + text);
      return;
    }

    const messageId = target.slice("message:".length);
    setCollaborationMessages((messages) => messages.map((message) => (
      message.id === messageId
        ? { ...message, text: `${message.text}${text}`, status: "writing", statusLabel: undefined }
        : message
    )));
  };

  const replaceTypewriterText = (target: TypewriterTarget, text: string) => {
    if (target === "editable") {
      setEditableOutput(text);
      return;
    }

    const messageId = target.slice("message:".length);
    setCollaborationMessages((messages) => messages.map((message) => (
      message.id === messageId ? { ...message, text } : message
    )));
  };

  const resolveDrainWaiters = (target: TypewriterTarget) => {
    const waiters = drainWaitersRef.current[target] ?? [];
    delete drainWaitersRef.current[target];
    waiters.forEach((resolve) => resolve());
  };

  const scheduleTypewriterTick = (target: TypewriterTarget) => {
    const state = typewriterRef.current[target];
    if (!state || state.timer) return;
    state.timer = window.setTimeout(() => {
      const current = typewriterRef.current[target];
      if (!current) return;
      current.timer = null;
      const next = takeTypewriterText(current.queue);
      current.queue = next.rest;
      if (next.text) appendTypewriterText(current.target, next.text);
      if (current.queue.length > 0) {
        scheduleTypewriterTick(target);
      } else {
        delete typewriterRef.current[target];
        resolveDrainWaiters(target);
      }
    }, TYPEWRITER_TICK_MS);
  };

  const enqueueStreamingText = (target: TypewriterTarget, token: string) => {
    if (!token) return;
    typewriterRef.current[target] = enqueueTypewriterToken(typewriterRef.current[target] ?? null, target, token) ?? undefined;
    scheduleTypewriterTick(target);
  };

  const drainStreamingText = (target: TypewriterTarget) => {
    const state = typewriterRef.current[target];
    if (!state || state.queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      drainWaitersRef.current[target] = [...(drainWaitersRef.current[target] ?? []), resolve];
      scheduleTypewriterTick(target);
    });
  };

  const flushStreamingText = (target: TypewriterTarget) => {
    const state = typewriterRef.current[target];
    if (!state) return;
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    const rest = state.queue.join("");
    state.queue = [];
    if (rest) appendTypewriterText(target, rest);
    delete typewriterRef.current[target];
    resolveDrainWaiters(target);
  };

  const syncFinalTypewriterText = async (target: TypewriterTarget, visibleText: string, finalText: string) => {
    const patch = getTypewriterFinalPatch(visibleText, finalText);
    if (!patch) return;
    replaceTypewriterText(target, patch.text);
  };

  const applyCollaborationMessagesFromThreadState = (state: ThreadStateResponse) => {
    const activityMessages = dedupePlanActivities(state.planActivities ?? []).map((activity) => ({
      id: `activity:${activity.id}`,
      role: "assistant" as const,
      text: activity.summary,
      usedMock: false,
      kind: "activity" as const,
      createdAt: activity.createdAt
    }));
    const messagesWithTimeline = attachRunStateToLatestAssistant(state.messages, state.runTimelineEvents ?? [], state.runCompletion);
    const timelineMessages = [...messagesWithTimeline, ...activityMessages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    setCollaborationMessages((current) => reconcileCollaborationMessages(current, timelineMessages));
    setPlans(state.plans ?? []);
    setAgentClarifications(state.agentClarifications ?? []);
    setRunTimelineEvents(state.runTimelineEvents ?? []);
  };

  const handleGenerate = async () => {
    await options.beforeGenerate();
    const operationId = ++operationIdRef.current;
    liveToolEventStateRef.current = createLiveToolEventState();
    setIsGenerating(true);
    try {
      const threadId = await options.ensureThreadId();
      const payload: GenerateRequest = {
        mode: "structured",
        clientRequestId: crypto.randomUUID(),
        agentCardId: options.activeAgent.id,
        projectId: options.currentProjectId,
        threadId,
        locale: options.locale,
        contextValues: options.getContextValues(),
        toolState: options.toolState,
        selectedCanvasNodeId: options.selectedCanvasNodeId
      };
      setEditableOutput("");

      const streamingEnabled = true;
      let streamedText = "";
      const result = streamingEnabled
        ? await generateTextStream(payload, {
            onToken: (token) => {
              streamedText += token;
              enqueueStreamingText("editable", token);
            },
            onReasoningToken: () => undefined,
            onToolEvent: (event) => appendToolEvent(event, threadId, operationId),
            onTimelineEvent: appendTimelineEvent
          })
        : await generateText(payload);
      if (operationId !== operationIdRef.current) return undefined;

      if (!streamingEnabled) {
        enqueueStreamingText("editable", result.text);
        streamedText = result.text;
      }
      await drainStreamingText("editable");
      await syncFinalTypewriterText("editable", streamedText, result.text);
      setGeneration(result);
      options.onPersistThreadId(result.threadId);
      await options.onRefreshThreadState(result.threadId);
    } finally {
      if (operationId === operationIdRef.current) setIsGenerating(false);
    }
  };

  const handleChatSend = async (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>): Promise<ChatSendResult> => {
    await options.beforeGenerate();
    const operationId = ++operationIdRef.current;
    liveToolEventStateRef.current = createLiveToolEventState();
    setIsChatSending(true);
    chatAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    activeChatMessageIdRef.current = assistantMessageId;
    blockedReasoningMessageIdsRef.current.delete(assistantMessageId);
    const startedAt = new Date().toISOString();
    const suppressUserMessage = hasAgentClarificationContext(requestContext) || typeof requestContext?.queuedInputMessageId === "string";
    const userMessage: CollaborationMessage = {
      id: userMessageId,
      role: "user",
      text,
      usedMock: false,
      createdAt: startedAt
    };
    let streamedText = "";
    setCollaborationMessages((current) => [
      ...current,
      ...(suppressUserMessage ? [] : [userMessage]),
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        usedMock: false,
        timeline: [],
        reasoningText: "",
        isReasoningStreaming: true,
        isStreaming: true,
        status: "thinking",
        createdAt: startedAt
      }
    ]);
    let threadId: string | undefined;
    try {
      threadId = await options.ensureThreadId();
      const activeThreadId = threadId;
      const transientSkillRefs = readSkillRefs(requestContext?.transientSkillRefs);
      const disabledSkillRefs = readSkillRefs(requestContext?.disabledSkillRefs);
      const runtimeBudgetProfile = readRuntimeBudgetProfile(requestContext?.runtimeBudgetProfile);
      const requestContextValues = omitSkillOverrideRefs(requestContext);
      const payload: GenerateRequest = {
        mode: "chat",
        clientRequestId: assistantMessageId,
        agentCardId: options.activeAgent.id,
        projectId: options.currentProjectId,
        threadId: activeThreadId,
        locale: options.locale,
        contextValues: { ...options.getContextValues(), ...requestContextValues },
        chatInstruction: text,
        planPhase: requestContext?.approvedPlan ? "execution" : requestContext?.awaitingPlan ? "revise" : isPlanInstruction(text) ? "intake" : undefined,
        planId: typeof (requestContext?.planExecution as { planId?: unknown } | undefined)?.planId === "string"
          ? (requestContext?.planExecution as { planId: string }).planId
          : typeof (requestContext?.awaitingPlan as { id?: unknown } | undefined)?.id === "string"
            ? (requestContext?.awaitingPlan as { id: string }).id
            : undefined,
        stepId: typeof (requestContext?.planExecution as { stepId?: unknown } | undefined)?.stepId === "string"
          ? (requestContext?.planExecution as { stepId: string }).stepId
          : undefined,
        toolState: buildRequestToolState(options.toolState, {
          kind: requestContext?.approvedPlan ? "execution" : isPlanInstruction(text) || Boolean(requestContext?.awaitingPlan) ? "planning" : "chat"
        }),
        runtimeBudgetProfile,
        modelOverrides,
        transientSkillRefs,
        disabledSkillRefs,
        selectedCanvasNodeId: options.selectedCanvasNodeId
      };
      const result = await generateTextStream(payload, {
        onStatus: (status) => updateStreamingMessage(assistantMessageId, {
          status: status.phase,
          statusLabel: status.label
        }),
        onToken: (token) => {
          streamedText += token;
          enqueueStreamingText(`message:${assistantMessageId}`, token);
        },
        onReasoningToken: (token) => appendReasoningToken(assistantMessageId, token),
        onToolEvent: (event) => appendToolEvent(event, activeThreadId, operationId),
        onTimelineEvent: appendTimelineEvent,
        onProgressEvent: (event) => appendProgressEvent(event, assistantMessageId)
      }, { signal: abortController.signal });
      if (operationId !== operationIdRef.current) return { ok: false, error: "stale_operation", threadId: activeThreadId };

      await drainStreamingText(`message:${assistantMessageId}`);
      await syncFinalTypewriterText(`message:${assistantMessageId}`, streamedText, result.text);
      updateStreamingMessage(assistantMessageId, {
        isStreaming: false,
        isReasoningStreaming: false,
        completion: result.completion,
        ...(result.runtimeRunId ? { runtimeRun: { threadId: result.runtimeThreadId || result.threadId, runId: result.runtimeRunId } } : {}),
        status: "finalizing",
        statusLabel: undefined
      });
      setGeneration(result);
      activeRunRef.current = result.runId ? { threadId: result.threadId, runId: result.runId } : null;
      options.onPersistThreadId(result.threadId);

      const state = await options.onFetchAndApplyThreadState(result.threadId);
      if (operationId !== operationIdRef.current) return { ok: false, error: "stale_operation", threadId: result.threadId };
      applyCollaborationMessagesFromThreadState(state);
      await options.onRefreshThreadState(result.threadId);
      await options.onRefreshProjectSurfaces();
      return { ok: true, state };
    } catch (error) {
      if (isAbortError(error)) {
        flushStreamingText(`message:${assistantMessageId}`);
        updateStreamingMessage(assistantMessageId, {
          ...(streamedText.trim() ? {} : { text: options.locale === "zh" ? "已停止" : "Stopped" }),
          usedMock: false,
          isStreaming: false,
          isReasoningStreaming: false,
          status: "stopped",
          statusLabel: undefined
        });
        return { ok: false, error: "aborted", threadId, aborted: true };
      }
      const message = recoverableGenerationError(error instanceof Error ? error.message : "Generation failed", options.locale);
      flushStreamingText(`message:${assistantMessageId}`);
      updateStreamingMessage(assistantMessageId, {
        text: `Request failed: ${message}`,
        usedMock: false,
        isStreaming: false,
        isReasoningStreaming: false,
        status: "error",
        statusLabel: undefined
      });
      if (threadId) {
        try {
          const state = await options.onFetchAndApplyThreadState(threadId);
          if (operationId === operationIdRef.current) applyCollaborationMessagesFromThreadState(state);
        } catch {
          // Keep the visible stream failure when persisted recovery state cannot be refreshed.
        }
      }
      return { ok: false, error: message, threadId };
    } finally {
      if (chatAbortControllerRef.current === abortController) chatAbortControllerRef.current = null;
      if (activeChatMessageIdRef.current === assistantMessageId) activeChatMessageIdRef.current = null;
      activeRunRef.current = null;
      if (operationId === operationIdRef.current) {
        setIsChatSending(false);
        if (!drainingQueuedInputsRef.current) {
          window.setTimeout(() => { void drainQueuedChatInputs(); }, 0);
        }
      }
    }
  };

  const queueChatInput = (
    text: string,
    modelOverrides?: GenerateRequest["modelOverrides"],
    requestContext?: Record<string, unknown>
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (!isChatSending && !activeChatMessageIdRef.current && !drainingQueuedInputsRef.current) {
      void handleChatSend(trimmed, modelOverrides, requestContext);
      return undefined;
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const queued: QueuedChatInput = {
      id,
      text: trimmed,
      status: "queued_after_run",
      createdAt,
      modelOverrides,
      requestContext
    };
    queuedInputsRef.current = [...queuedInputsRef.current, queued];
    setCollaborationMessages((current) => [...current, {
      id,
      role: "user",
      text: trimmed,
      usedMock: false,
      createdAt,
      queuedInput: {
        id,
        status: "queued_after_run",
        createdAt
      }
    }]);
    return id;
  };

  const requestQueuedInputIntervention = (id: string) => {
    markQueuedInputStatus(id, "intervention_requested");
    const queued = queuedInputsRef.current.find((item) => item.id === id);
    const activeRun = activeRunRef.current;
    if (!queued || !activeRun) return;
    requestRunIntervention({
      threadId: activeRun.threadId,
      runId: activeRun.runId,
      text: queued.text,
      inputId: id
    }).catch((error) => {
      console.warn("Unable to request run intervention", error);
    });
  };

  const drainQueuedChatInputs = async () => {
    if (drainingQueuedInputsRef.current) return;
    const next = queuedInputsRef.current.find((item) => item.status === "queued_after_run" || item.status === "intervention_requested");
    if (!next) return;
    drainingQueuedInputsRef.current = true;
    try {
      markQueuedInputStatus(next.id, "sent_after_run");
      queuedInputsRef.current = queuedInputsRef.current.filter((item) => item.id !== next.id);
      await handleChatSend(next.text, next.modelOverrides, {
        ...(next.requestContext ?? {}),
        queuedInputMessageId: next.id,
        queuedInputStatus: next.status
      });
    } finally {
      drainingQueuedInputsRef.current = false;
      if (queuedInputsRef.current.some((item) => item.status === "queued_after_run" || item.status === "intervention_requested")) {
        window.setTimeout(() => { void drainQueuedChatInputs(); }, 0);
      }
    }
  };


  const restoreVersion = (version: StoredOutputVersion) => {
    setEditableOutput(version.content);
    setActiveVersionId(version.id);
    setGeneration({
      text: version.content,
      prompt: generation?.prompt ?? "",
      provider: version.provider,
      usedMock: version.usedMock,
      threadId: version.threadId,
      runId: version.runId
    });
  };

  return {
    activeVersionId,
    collaborationMessages,
    editableOutput,
    generation,
    isChatSending,
    isGenerating,
    stopChatGeneration,
    outputVersions,
    plans,
    agentClarifications,
    canvasWriteSuggestions,
    runTimelineEvents,
    toolEvents,
    setActiveVersionId,
    setCollaborationMessages,
    setEditableOutput,
    setGeneration,
    setOutputVersions,
    setToolEvents,
    setRunTimelineEvents,
    setPlans,
    setAgentClarifications,
    setCanvasWriteSuggestions,
    resetGeneration,
    applyCollaborationMessagesFromThreadState,
    handleGenerate,
    handleChatSend,
    queueChatInput,
    requestQueuedInputIntervention,
    restoreVersion
  };
}

function isPlanInstruction(text: string) {
  return /^\s*\/plan\b/i.test(text) || /^\s*continue approved plan\b/i.test(text);
}

function dedupePlanActivities<T extends { planRunId: string; stepId?: string; type: string; status: string; summary: string }>(activities: T[]) {
  const seen = new Set<string>();
  return activities.filter((activity) => {
    const key = [activity.planRunId, activity.stepId ?? "", activity.type, activity.status, activity.summary].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSkillRefs(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return refs.length ? Array.from(new Set(refs)) : undefined;
}

function omitSkillOverrideRefs(requestContext?: Record<string, unknown>) {
  if (!requestContext) return undefined;
  const { transientSkillRefs: _transientSkillRefs, disabledSkillRefs: _disabledSkillRefs, runtimeBudgetProfile: _runtimeBudgetProfile, ...rest } = requestContext;
  return rest;
}

function readRuntimeBudgetProfile(value: unknown): GenerateRequest["runtimeBudgetProfile"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function hasAgentClarificationContext(requestContext?: Record<string, unknown>) {
  const clarification = requestContext?.agentClarification;
  return Boolean(clarification && typeof clarification === "object" && !Array.isArray(clarification));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function eventStatusPhase(eventType: string): CollaborationMessage["status"] {
  if (/(?:^|_)tool_failed$/.test(eventType) || /(?:^|_)canvas_mutation_failed$/.test(eventType)) return "error";
  if (eventType === "canvas_delivery_synthesis_started" || eventType === "canvas_delivery_body_final_committed") return "finalizing";
  if (/(?:^|_)tool_(?:started|completed)$/.test(eventType)) return "searching";
  return "writing";
}

function canvasSyncingLabel(locale: Locale) {
  return locale === "zh" ? "Canvas update received; syncing state..." : "Canvas update received; syncing state...";
}

function canvasSyncedLabel(locale: Locale) {
  return locale === "zh"
    ? "Canvas 预览已同步，Agent 仍在生成最终回复..."
    : "Canvas preview synced; agent is still preparing the final response...";
}

function recoverableGenerationError(message: string, locale: Locale) {
  if (/Plan (?:planning|revision|execution|phase).*completed without/i.test(message)) {
    return locale === "zh"
      ? "Plan 状态没有正确更新，执行已暂停。请重试当前步骤或修改计划。"
      : "The Plan state was not updated correctly, so execution paused. Retry the current step or revise the Plan.";
  }
  return message;
}

export function looksUnsafeForReasoningStream(text: string) {
  return /#\s*AgentCard|#\s*Loaded Skills|#\s*Current User Instruction|#\s*Output Contract|FacetWrite runtime context|authorization|cookie|password|secret|api.?key|token|headers?|tool_call_id|contextValues|facetwrite_(?:canvas|diagram)_delivery/i.test(text)
    || containsInternalRuntimeProtocol(text);
}

function reasoningBlockedMessage(locale: Locale) {
  return locale === "zh"
    ? "Thinking hidden because internal runtime data was detected."
    : "Thinking hidden because internal runtime data was detected.";
}

function attachRunStateToLatestAssistant<T extends CollaborationMessage>(
  messages: T[],
  events: RunTimelineEvent[],
  completion: ThreadStateResponse["runCompletion"]
) {
  if (events.length === 0 && !completion) return messages;
  const latestAssistantIndex = [...messages].reverse().findIndex((message) => message.role === "assistant");
  if (latestAssistantIndex < 0) return messages;
  const targetIndex = messages.length - 1 - latestAssistantIndex;
  const timeline = [...events].sort((left, right) => left.sequence - right.sequence);
  return messages.map((message, index) => (
    index === targetIndex ? { ...message, timeline, ...(completion ? { completion } : {}) } : message
  ));
}

function traceLiveRefresh(
  phase: string,
  refreshId: string,
  request: LiveThreadStateRefreshRequest,
  details: Record<string, unknown> = {}
) {
  console.info("[FacetWrite live refresh trace]", {
    phase,
    refreshId,
    threadId: request.threadId,
    operationId: request.operationId,
    ...details
  });
}
