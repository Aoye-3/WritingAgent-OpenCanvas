import { useEffect, useRef, useState } from "react";
import type { AgentCard, AgentValues, StoredOutputVersion, StoredToolEvent, ThreadStateResponse } from "../../features/agents/types";
import { generateText, generateTextStream } from "../../features/generation/generationClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../../features/generation/types";
import type { Locale } from "../../features/i18n/types";
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
  agentValues: AgentValues;
  locale: Locale;
  toolState: GenerateRequest["toolState"];
  selectedCanvasNodeId?: string;
  getContextValues: () => Record<string, unknown>;
  currentThreadId: string;
  ensureThreadId: () => Promise<string>;
  onPersistThreadId: (threadId: string) => void;
  onRefreshThreadState: (threadId: string) => Promise<void>;
  onFetchAndApplyThreadState: (threadId: string) => Promise<ThreadStateResponse>;
  onApplyThreadState: (state: ThreadStateResponse) => void;
  onApproveCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRefreshProjectSurfaces: () => Promise<void>;
  getPendingCanvasWriteRequestIds: () => string[];
};

type TypewriterTarget = "editable" | `message:${string}`;

export function useGenerationRun(options: UseGenerationRunOptions) {
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [collaborationMessages, setCollaborationMessages] = useState<CollaborationMessage[]>([]);
  const [outputVersions, setOutputVersions] = useState<StoredOutputVersion[]>([]);
  const [toolEvents, setToolEvents] = useState<StoredToolEvent[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const typewriterRef = useRef<Partial<Record<TypewriterTarget, TypewriterState<TypewriterTarget>>>>({});
  const drainWaitersRef = useRef<Partial<Record<TypewriterTarget, Array<() => void>>>>({});

  useEffect(() => () => {
    for (const state of Object.values(typewriterRef.current)) {
      if (state?.timer) window.clearTimeout(state.timer);
    }
    Object.values(drainWaitersRef.current).flat().forEach((resolve) => resolve?.());
  }, []);

  const resetGeneration = () => {
    setGeneration(null);
    setEditableOutput("");
    setCollaborationMessages([]);
    setOutputVersions([]);
    setToolEvents([]);
    setActiveVersionId(undefined);
  };

  const appendToolEvent = (event: unknown, threadId: string) => {
    setToolEvents((current) => [{
      id: crypto.randomUUID(),
      threadId,
      runId: "pending",
      eventType: String((event as { eventType?: unknown }).eventType ?? "tool_event"),
      payload: (event as { payload?: unknown }).payload ?? event,
      createdAt: new Date().toISOString()
    }, ...current]);
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
    setCollaborationMessages((current) => reconcileCollaborationMessages(current, state.messages));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const threadId = await options.ensureThreadId();
      const payload: GenerateRequest = {
        mode: "structured",
        agentCardId: options.activeAgent.id,
        threadId,
        locale: options.locale,
        structuredValues: options.agentValues,
        contextValues: options.getContextValues(),
        toolState: options.toolState,
        selectedCanvasNodeId: options.selectedCanvasNodeId
      };
      setEditableOutput("");

      const streamingEnabled = Boolean(options.activeAgent.settings?.model.streaming);
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
      setIsGenerating(false);
    }
  };

  const handleChatSend = async (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => {
    setIsChatSending(true);
    const previousPendingWriteIds = new Set(options.getPendingCanvasWriteRequestIds());
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    setCollaborationMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: "user",
        text,
        usedMock: false
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        usedMock: false,
        isStreaming: true,
        status: "thinking"
      }
    ]);
    try {
      const threadId = await options.ensureThreadId();
      const payload: GenerateRequest = {
        mode: "chat",
        agentCardId: options.activeAgent.id,
        threadId,
        locale: options.locale,
        structuredValues: options.agentValues,
        contextValues: options.getContextValues(),
        chatInstruction: text,
        toolState: { ...options.toolState, quick_messages: true, canvas_write: true },
        modelOverrides,
        selectedCanvasNodeId: options.selectedCanvasNodeId
      };
      let streamedText = "";
      const result = await generateTextStream(payload, {
        onStatus: (status) => updateStreamingMessage(assistantMessageId, {
          status: status.phase
        }),
        onToken: (token) => {
          streamedText += token;
          enqueueStreamingText(`message:${assistantMessageId}`, token);
        },
        onToolEvent: (event) => appendToolEvent(event, threadId)
      });

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
      const directWriteRequests = isDirectCanvasWriteInstruction(text)
        ? (state.canvasWriteRequests ?? []).filter((request) => !previousPendingWriteIds.has(request.id) && request.status === "pending")
        : [];
      for (const request of directWriteRequests) {
        await options.onApproveCanvasWriteRequest(request.id);
      }
      await options.onRefreshThreadState(result.threadId);
      await options.onRefreshProjectSurfaces();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      flushStreamingText(`message:${assistantMessageId}`);
      updateStreamingMessage(assistantMessageId, {
        text: `Request failed: ${message}`,
        usedMock: false,
        isStreaming: false,
        status: "error",
        statusLabel: undefined
      });
    } finally {
      setIsChatSending(false);
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
    outputVersions,
    toolEvents,
    setActiveVersionId,
    setCollaborationMessages,
    setEditableOutput,
    setGeneration,
    setOutputVersions,
    setToolEvents,
    resetGeneration,
    applyCollaborationMessagesFromThreadState,
    handleGenerate,
    handleChatSend,
    restoreVersion
  };
}

function isDirectCanvasWriteInstruction(text: string) {
  return /canvas|\u753b\u677f|\u756b\u677f|\u5199\u5165|\u5beb\u5165|\u4fdd\u5b58\u5230|\u52a0\u5165|\u6dfb\u52a0\u5230|\u653e\u5230|save\s+to\s+canvas|write\s+this|write\s+to\s+canvas|add\s+to\s+canvas/i.test(text);
}
