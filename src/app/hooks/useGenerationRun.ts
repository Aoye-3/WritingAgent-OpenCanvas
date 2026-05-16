import { useState } from "react";
import type { AgentCard, AgentValues, StoredOutputVersion, StoredToolEvent, ThreadStateResponse } from "../../features/agents/types";
import { generateText, generateTextStream } from "../../features/generation/generationClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../../features/generation/types";
import type { Locale } from "../../features/i18n/types";

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
  onRefreshProjectSurfaces: () => Promise<void>;
};

export function useGenerationRun(options: UseGenerationRunOptions) {
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [collaborationMessages, setCollaborationMessages] = useState<CollaborationMessage[]>([]);
  const [outputVersions, setOutputVersions] = useState<StoredOutputVersion[]>([]);
  const [toolEvents, setToolEvents] = useState<StoredToolEvent[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);

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
      const result = options.activeAgent.settings?.model.streaming
        ? await generateTextStream(payload, {
            onToken: (token) => setEditableOutput((current) => current + token),
            onToolEvent: (event) => appendToolEvent(event, threadId)
          })
        : await generateText(payload);
      setGeneration(result);
      options.onPersistThreadId(result.threadId);
      setEditableOutput(result.text);
      await options.onRefreshThreadState(result.threadId);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChatSend = async (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => {
    setIsChatSending(true);
    setCollaborationMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        usedMock: false
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
      const result = options.activeAgent.settings?.model.streaming
        ? await generateTextStream(payload, {
            onToken: (token) => setEditableOutput((current) => current || token ? current + token : token),
            onToolEvent: (event) => appendToolEvent(event, threadId)
          })
        : await generateText(payload);
      setGeneration(result);
      options.onPersistThreadId(result.threadId);
      const state = await options.onFetchAndApplyThreadState(result.threadId);
      options.onApplyThreadState(state);
      await options.onRefreshProjectSurfaces();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      setCollaborationMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Request failed: ${message}`,
          usedMock: false
        }
      ]);
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
    handleGenerate,
    handleChatSend,
    restoreVersion
  };
}
