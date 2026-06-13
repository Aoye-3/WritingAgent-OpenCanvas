import { useEffect, useRef, useState } from "react";
import type { AgentCard, CanvasWriteSuggestion, PlanRun, StoredOutputVersion, StoredToolEvent, ThreadStateResponse } from "../../features/agents/types";
import { generateText, generateTextStream } from "../../features/generation/generationClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../../features/generation/types";
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
  onApproveCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRefreshProjectSurfaces: () => Promise<void>;
  getPendingCanvasWriteRequestIds: () => string[];
  beforeGenerate: () => Promise<void>;
};

type TypewriterTarget = "editable" | `message:${string}`;

export function useGenerationRun(options: UseGenerationRunOptions) {
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [collaborationMessages, setCollaborationMessages] = useState<CollaborationMessage[]>([]);
  const [outputVersions, setOutputVersions] = useState<StoredOutputVersion[]>([]);
  const [toolEvents, setToolEvents] = useState<StoredToolEvent[]>([]);
  const [plans, setPlans] = useState<PlanRun[]>([]);
  const [canvasWriteSuggestions, setCanvasWriteSuggestions] = useState<CanvasWriteSuggestion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const typewriterRef = useRef<Partial<Record<TypewriterTarget, TypewriterState<TypewriterTarget>>>>({});
  const drainWaitersRef = useRef<Partial<Record<TypewriterTarget, Array<() => void>>>>({});
  const operationIdRef = useRef(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const activeChatMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    activeChatMessageIdRef.current = null;
    operationIdRef.current += 1;
    setIsGenerating(false);
    setIsChatSending(false);
  }, [options.currentProjectId, options.currentThreadId]);

  useEffect(() => () => {
    for (const state of Object.values(typewriterRef.current)) {
      if (state?.timer) window.clearTimeout(state.timer);
    }
    Object.values(drainWaitersRef.current).flat().forEach((resolve) => resolve?.());
  }, []);

  const resetGeneration = () => {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    activeChatMessageIdRef.current = null;
    operationIdRef.current += 1;
    setGeneration(null);
    setEditableOutput("");
    setCollaborationMessages([]);
    setOutputVersions([]);
    setToolEvents([]);
    setPlans([]);
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
        status: "stopped",
        statusLabel: undefined
      });
    }
    setIsChatSending(false);
  };

  const appendToolEvent = (event: unknown, threadId: string) => {
    const eventType = String((event as { eventType?: unknown }).eventType ?? "tool_event");
    const payload = (event as { payload?: Record<string, unknown> }).payload ?? {};
    setToolEvents((current) => [{
      id: crypto.randomUUID(),
      threadId,
      runId: "pending",
      eventType,
      payload,
      createdAt: new Date().toISOString()
    }, ...current]);
    const summary = liveActivitySummary(eventType, payload, options.locale);
    if (summary) setCollaborationMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: "assistant",
      text: summary,
      usedMock: false,
      kind: "activity",
      createdAt: new Date().toISOString()
    }]);
  };

  const updateStreamingMessage = (messageId: string, patch: Partial<CollaborationMessage>) => {
    setCollaborationMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, ...patch } : message
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
    if (patch.reset) {
      replaceTypewriterText(target, "");
    }
    enqueueStreamingText(target, patch.token);
    await drainStreamingText(target);
  };

  const applyCollaborationMessagesFromThreadState = (state: ThreadStateResponse) => {
    const activityMessages = (state.planActivities ?? []).map((activity) => ({
      id: `activity:${activity.id}`,
      role: "assistant" as const,
      text: activity.summary,
      usedMock: false,
      kind: "activity" as const,
      createdAt: activity.createdAt
    }));
    const timelineMessages = [...state.messages, ...activityMessages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    setCollaborationMessages((current) => reconcileCollaborationMessages(current, timelineMessages));
    setPlans(state.plans ?? []);
  };

  const handleGenerate = async () => {
    await options.beforeGenerate();
    const operationId = ++operationIdRef.current;
    setIsGenerating(true);
    try {
      const threadId = await options.ensureThreadId();
      const payload: GenerateRequest = {
        mode: "structured",
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
            onToolEvent: (event) => appendToolEvent(event, threadId)
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

  const handleChatSend = async (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => {
    await options.beforeGenerate();
    const operationId = ++operationIdRef.current;
    setIsChatSending(true);
    chatAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    activeChatMessageIdRef.current = assistantMessageId;
    const startedAt = new Date().toISOString();
    let streamedText = "";
    setCollaborationMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: "user",
        text,
        usedMock: false,
        createdAt: startedAt
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        usedMock: false,
        isStreaming: true,
        status: "thinking",
        createdAt: startedAt
      }
    ]);
    try {
      const threadId = await options.ensureThreadId();
      const payload: GenerateRequest = {
        mode: "chat",
        agentCardId: options.activeAgent.id,
        projectId: options.currentProjectId,
        threadId,
        locale: options.locale,
        contextValues: { ...options.getContextValues(), ...requestContext },
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
        modelOverrides,
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
        onToolEvent: (event) => appendToolEvent(event, threadId)
      }, { signal: abortController.signal });
      if (operationId !== operationIdRef.current) return;

      await drainStreamingText(`message:${assistantMessageId}`);
      await syncFinalTypewriterText(`message:${assistantMessageId}`, streamedText, result.text);
      updateStreamingMessage(assistantMessageId, {
        isStreaming: false,
        status: "finalizing",
        statusLabel: undefined
      });
      setGeneration(result);
      options.onPersistThreadId(result.threadId);

      const state = await options.onFetchAndApplyThreadState(result.threadId);
      if (operationId !== operationIdRef.current) return;
      applyCollaborationMessagesFromThreadState(state);
      await options.onRefreshThreadState(result.threadId);
      await options.onRefreshProjectSurfaces();
      return state;
    } catch (error) {
      if (isAbortError(error)) {
        flushStreamingText(`message:${assistantMessageId}`);
        updateStreamingMessage(assistantMessageId, {
          ...(streamedText.trim() ? {} : { text: options.locale === "zh" ? "已停止" : "Stopped" }),
          usedMock: false,
          isStreaming: false,
          status: "stopped",
          statusLabel: undefined
        });
        return;
      }
      const message = recoverableGenerationError(error instanceof Error ? error.message : "Generation failed", options.locale);
      flushStreamingText(`message:${assistantMessageId}`);
      updateStreamingMessage(assistantMessageId, {
        text: `Request failed: ${message}`,
        usedMock: false,
        isStreaming: false,
        status: "error",
        statusLabel: undefined
      });
    } finally {
      if (chatAbortControllerRef.current === abortController) chatAbortControllerRef.current = null;
      if (activeChatMessageIdRef.current === assistantMessageId) activeChatMessageIdRef.current = null;
      if (operationId === operationIdRef.current) setIsChatSending(false);
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
    canvasWriteSuggestions,
    toolEvents,
    setActiveVersionId,
    setCollaborationMessages,
    setEditableOutput,
    setGeneration,
    setOutputVersions,
    setToolEvents,
    setPlans,
    setCanvasWriteSuggestions,
    resetGeneration,
    applyCollaborationMessagesFromThreadState,
    handleGenerate,
    handleChatSend,
    restoreVersion
  };
}

function isPlanInstruction(text: string) {
  return /^\s*\/plan\b/i.test(text) || /^\s*continue approved plan\b/i.test(text);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function liveActivitySummary(eventType: string, payload: Record<string, unknown>, locale: Locale) {
  const tool = typeof payload.toolName === "string" ? payload.toolName : typeof payload.tool === "string" ? payload.tool : "";
  const skill = typeof payload.skill === "string" ? payload.skill : "";
  if (skill) return locale === "zh" ? `正在使用技能：${skill === "brainstorming" ? "头脑风暴" : skill === "writing-plans" ? "计划编写" : skill}` : `Using skill: ${skill}`;
  if (/(?:^|_)tool_started$/.test(eventType)) return locale === "zh" ? `正在调用工具${tool ? `：${tool}` : ""}` : `Using tool${tool ? `: ${tool}` : ""}`;
  if (/(?:^|_)tool_failed$/.test(eventType)) {
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    return locale === "zh"
      ? `工具调用失败${tool ? `：${tool}` : ""}${reason ? `（${reason}）` : ""}`
      : `Tool failed${tool ? `: ${tool}` : ""}${reason ? ` (${reason})` : ""}`;
  }
  if (/(?:^|_)tool_completed$/.test(eventType)) return locale === "zh" ? `工具调用完成${tool ? `：${tool}` : ""}` : `Tool completed${tool ? `: ${tool}` : ""}`;
  if (/(?:^|_)artifact_committed$/.test(eventType)) return locale === "zh" ? "当前步骤产物已写入画板" : "Current step artifact committed to Canvas";
  if (/(?:^|_)canvas_action_recognized$/.test(eventType)) return locale === "zh" ? "已识别 Canvas 操作" : "Canvas action recognized";
  if (/(?:^|_)canvas_mutation_started$/.test(eventType)) return locale === "zh" ? "正在执行 Canvas 操作" : "Applying Canvas action";
  if (/(?:^|_)canvas_mutation_committed$/.test(eventType)) return locale === "zh" ? "Canvas 节点已创建或更新" : "Canvas node created or updated";
  if (/(?:^|_)canvas_write_pending_approval$/.test(eventType)) return locale === "zh" ? "Canvas 覆盖操作等待批准" : "Canvas replacement is waiting for approval";
  if (/(?:^|_)canvas_mutation_failed$/.test(eventType)) return locale === "zh" ? "Canvas 写入失败" : "Canvas write failed";
  return undefined;
}

function recoverableGenerationError(message: string, locale: Locale) {
  if (/Plan (?:planning|revision|execution|phase).*completed without/i.test(message)) {
    return locale === "zh"
      ? "Plan 状态没有正确更新，执行已暂停。请重试当前步骤或修改计划。"
      : "The Plan state was not updated correctly, so execution paused. Retry the current step or revise the Plan.";
  }
  return message;
}
