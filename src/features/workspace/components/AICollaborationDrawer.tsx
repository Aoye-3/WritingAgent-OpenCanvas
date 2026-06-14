import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AddIcon, AgentIcon, ChevronLeftIcon, ChevronRightIcon, HistoryIcon, KnowledgeIcon, SearchIcon, SendIcon, StopIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import type { AgentCard, CanvasWriteRequest, CanvasWriteSuggestion, PlanRun, StoredThread } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import { AnnotationChipRow, CanvasWriteProposalPanel, type MessageAnnotation } from "./CanvasWriteProposalPanel";
import { AssistantRunTrace } from "./AssistantRunTrace";
import type { CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import { PlanTaskBoard } from "./PlanTaskBoard";
import { PlanClarificationCard } from "./PlanClarificationCard";
import { acceptCanvasWriteSuggestion, answerPlan, dismissCanvasWriteSuggestion, pausePlan } from "../../agents/agentClient";
import { visibleComposerTools } from "../planUiPolicy";
import { buildPlanTimeline } from "../planTimeline";
import type { ConfiguredModelApiSummary } from "../../settings/types";

type ToolKey = NonNullable<GenerateRequest["toolState"]> extends Partial<Record<infer Key, boolean>> ? Key : never;

type SelectionAction = {
  messageId: string;
  text: string;
  x: number;
  y: number;
};

type WriteDraft = {
  messageId?: string;
  text: string;
};

export type ConversationModelControls = {
  providerId?: string;
  thinkingMode?: NonNullable<GenerateRequest["modelOverrides"]>["thinkingMode"];
  reasoningEffort?: NonNullable<GenerateRequest["modelOverrides"]>["reasoningEffort"];
};

type AICollaborationDrawerProps = {
  allowedTools: string[];
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWriteSuggestions: CanvasWriteSuggestion[];
  collapsed: boolean;
  inputDraft: string;
  mindChainContext: CanvasMindChainContext | null;
  messages: CollaborationMessage[];
  plans: PlanRun[];
  projectThreads: StoredThread[];
  currentThreadId: string;
  sessionBusy: boolean;
  sessionError: string;
  isSending: boolean;
  modelSelectionDisabled: boolean;
  configuredModels: ConfiguredModelApiSummary[];
  selectedModelConfigId?: string | null;
  modelSettings?: ConversationModelControls;
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onResetContext: () => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onInputDraftConsumed: () => void;
  onMindChainContextConsumed: () => void;
  onRemoveMindChainContext: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<unknown>;
  onStopSending: () => void;
  onSelectAgent: (agentCardId: string) => void;
  onSelectModel: (configuredModelApiId: string) => Promise<void>;
  onSelectThread: (threadId: string) => Promise<void>;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  onPlansChanged: () => Promise<void>;
  onFocusPlanArtifact: (targetId: string) => void;
  toolState: GenerateRequest["toolState"];
};

const toolMeta: Record<string, { en: string; zh: string; hint: string }> = {
  web_search: { en: "Web search", zh: "联网搜索", hint: "Web search intent only" },
  knowledge_base: { en: "Knowledge base", zh: "知识库引用", hint: "Use selected knowledge hints" },
  clear_context: { en: "Clear context", zh: "清除上下文", hint: "Ignore previous conversational context" }
};

const COMPOSER_MIN_HEIGHT = 72;
const COMPOSER_MAX_HEIGHT = 240;

export function AICollaborationDrawer({
  allowedTools,
  activeAgent,
  agentCards,
  canvasWriteRequests,
  canvasWriteSuggestions,
  collapsed,
  inputDraft,
  mindChainContext,
  messages,
  plans,
  projectThreads,
  currentThreadId,
  sessionBusy,
  sessionError,
  isSending,
  modelSelectionDisabled,
  configuredModels,
  selectedModelConfigId,
  modelSettings,
  onApproveWriteRequest,
  onCreateConversation,
  onResetContext,
  onApplyWriteText,
  onRejectWriteRequest,
  onInputDraftConsumed,
  onMindChainContextConsumed,
  onRemoveMindChainContext,
  onResizeStart,
  onSend,
  onStopSending,
  onSelectAgent,
  onSelectModel,
  onSelectThread,
  onToggleCollapsed,
  onToolStateChange,
  onPlansChanged,
  onFocusPlanArtifact,
  toolState
}: AICollaborationDrawerProps) {
  const { locale } = useI18n();
  const reduceMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const supportsThinking = modelSettings?.providerId === "deepseek";
  const [thinkEnabled, setThinkEnabled] = useState(modelSettings?.thinkingMode === "enabled");
  const [reasoningEffort, setReasoningEffort] = useState<NonNullable<GenerateRequest["modelOverrides"]>["reasoningEffort"]>(modelSettings?.reasoningEffort ?? "high");
  const [annotations, setAnnotations] = useState<MessageAnnotation[]>([]);
  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeStatus, setWriteStatus] = useState("");
  const [composerHeight, setComposerHeight] = useState(72);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextResetNotice, setContextResetNotice] = useState(false);
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const drawerTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 300, damping: 32 };

  const pendingWriteRequest = canvasWriteRequests.find((request) => request.operation !== "replace_range");
  const pendingWriteSuggestion = canvasWriteSuggestions.find((suggestion) => suggestion.status === "pending");
  const proposalFullText = writeDraft?.text || pendingWriteRequest?.content || "";
  const annotatedText = annotations.map((annotation) => annotation.text).join("\n\n");
  const hasWriteProposal = Boolean(writeDraft || pendingWriteRequest || annotations.length);
  const timeline = useMemo(() => buildPlanTimeline(messages, plans), [messages, plans]);
  const pendingClarificationPlan = plans.find((plan) => plan.status === "awaiting_user" && plan.clarification?.status === "pending");

  useEffect(() => {
    setThinkEnabled(modelSettings?.thinkingMode === "enabled");
    setReasoningEffort(modelSettings?.reasoningEffort ?? "high");
  }, [modelSettings?.providerId, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

  useEffect(() => {
    if (!inputDraft) return;
    setInput(inputDraft);
    onInputDraftConsumed();
  }, [inputDraft, onInputDraftConsumed]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => setContextResetNotice(false), [currentThreadId]);

  const resetWriteDraft = () => {
    setAnnotations([]);
    setWriteDraft(null);
    setSelectionAction(null);
  };

  const rejectPendingIfSuperseded = async () => {
    if (pendingWriteRequest) {
      await onRejectWriteRequest(pendingWriteRequest.id);
    }
  };

  const applyWrite = async (mode: "default" | "all" | "snippets", fallbackText?: string) => {
    const fullText = fallbackText || proposalFullText;
    const content = mode === "snippets" && annotations.length ? annotatedText : fullText;
    if (!content.trim()) return;
    setWriteBusy(true);
    setWriteStatus("");
    try {
      if (!writeDraft && !fallbackText && (mode === "default" || mode === "all") && pendingWriteRequest && content === pendingWriteRequest.content) {
        await onApproveWriteRequest(pendingWriteRequest.id);
      } else {
        await onApplyWriteText(content);
        await rejectPendingIfSuperseded();
      }
      resetWriteDraft();
      setWriteStatus(locale === "zh" ? "已写入 Canvas" : "Written to Canvas");
    } finally {
      setWriteBusy(false);
    }
  };

  const cancelWrite = async () => {
    setWriteBusy(true);
    try {
      if (!writeDraft) {
        await rejectPendingIfSuperseded();
      }
      resetWriteDraft();
      setWriteStatus(locale === "zh" ? "已取消写入" : "Write canceled");
    } finally {
      setWriteBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (isWriteConfirmation(text)) {
      if (pendingWriteSuggestion) {
        await acceptCanvasWriteSuggestion(currentThreadId, pendingWriteSuggestion.id);
        await onPlansChanged();
        return;
      }
      if (hasWriteProposal) {
        await applyWrite(annotations.length ? "snippets" : "default");
        return;
      }
    }
    const awaitingPlan = plans.find((plan) => plan.status === "awaiting_user");
    const revisePlanId = text.match(/^\s*\/plan\s+revise\s+([A-Za-z0-9_-]+)/i)?.[1];
    const revisePlan = revisePlanId ? plans.find((plan) => plan.id === revisePlanId) : undefined;
    if (awaitingPlan) {
      await answerPlan(currentThreadId, awaitingPlan.id, text);
      await onPlansChanged();
    }
    try {
      await onSend(text, supportsThinking ? {
        thinkingMode: thinkEnabled ? "enabled" : "disabled",
        reasoningEffort
      } : undefined, {
        ...(mindChainContext ? { canvasMindChain: mindChainContext.text } : {}),
        ...(awaitingPlan ? { awaitingPlan: { id: awaitingPlan.id, answer: text } } : {}),
        ...(revisePlan ? { awaitingPlan: { id: revisePlan.id, revise: true } } : {})
      });
      if (mindChainContext) onMindChainContextConsumed();
    } catch {
      setInput(text);
    }
  };

  const captureSelection = (event: React.MouseEvent<HTMLDivElement>, message: CollaborationMessage) => {
    const container = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? "";
      const anchor = selection?.anchorNode;
      if (!selectedText || !anchor || !container.contains(anchor)) {
        setSelectionAction(null);
        return;
      }
      setSelectionAction({ messageId: message.id, text: selectedText, x, y });
    }, 0);
  };

  const addAnnotation = () => {
    if (!selectionAction) return;
    const sourceMessage = messages.find((message) => message.id === selectionAction.messageId);
    setAnnotations((current) => [
      ...current,
      {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `annotation_${Date.now()}`,
        messageId: selectionAction.messageId,
        text: selectionAction.text
      }
    ]);
    setWriteDraft((current) => current ?? (sourceMessage ? { messageId: sourceMessage.id, text: sourceMessage.text } : null));
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  };

  const removeAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  };

  const answerClarification = async (plan: PlanRun, answer: { optionId?: string; customAnswer?: string }) => {
    setClarificationBusy(true);
    try {
      await answerPlan(currentThreadId, plan.id, answer);
      await onPlansChanged();
      const option = plan.clarification?.options.find((item) => item.id === answer.optionId);
      const answerText = answer.customAnswer
        || option?.label
        || "";
      await onSend(answerText, undefined, {
        awaitingPlan: {
          id: plan.id,
          ...answer,
          answer: answerText,
          ...(option ? { option: { id: option.id, label: option.label, description: option.description, recommended: option.recommended } } : {})
        }
      });
    } finally {
      setClarificationBusy(false);
    }
  };

  const startComposerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, startHeight + startY - moveEvent.clientY));
      setComposerHeight(nextHeight);
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  if (collapsed) {
    return (
      <motion.aside
        animate={{ opacity: 1 }}
        className="ai-drawer ai-drawer-collapsed"
        initial={reduceMotion ? false : { opacity: 0.84 }}
        layout
        transition={drawerTransition}
        aria-label="AI collaboration drawer collapsed"
      >
        <motion.button
          animate={{ opacity: 1, x: 0 }}
          className="drawer-rail drawer-rail-right"
          initial={reduceMotion ? false : { opacity: 0, x: 8 }}
          transition={drawerTransition}
          type="button"
          onClick={onToggleCollapsed}
          aria-label={locale === "zh" ? "展开 AI 协作层" : "Expand AI collaboration"}
        >
          <span>AI</span>
          <small>{messages.length}</small>
          <b><ChevronLeftIcon aria-hidden="true" size={18} /></b>
        </motion.button>
      </motion.aside>
    );
  }

  return (
    <motion.aside className="ai-drawer" aria-label="AI collaboration drawer" layout transition={drawerTransition}>
      <div
        aria-label={locale === "zh" ? "调整 AI 协作层宽度" : "Resize AI collaboration drawer"}
        aria-orientation="vertical"
        className="ai-drawer-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={0}
        title={locale === "zh" ? "向左拖动扩大 AI 协作层" : "Drag left to expand AI collaboration"}
      />
      <div className="conversation-compact-header" data-testid="conversation-compact-header">
        <strong>{projectThreads.find((thread) => thread.id === currentThreadId)?.title ?? (locale === "zh" ? "新对话" : "New conversation")}</strong>
          <div className="conversation-header-actions">
            <button className="icon-button conversation-icon-action" type="button" disabled={sessionBusy} onClick={() => {
              void onResetContext().then(() => setContextResetNotice(true));
            }} aria-label={locale === "zh" ? "清除上下文" : "Clear context"} title={locale === "zh" ? "保留历史，但从此处重新开始上下文" : "Keep history, but start model context from here"}>
              <HistoryIcon aria-hidden="true" size={17} />
            </button>
          <button className="icon-button conversation-icon-action" type="button" disabled={sessionBusy} onClick={() => { void onCreateConversation(); }} aria-label={locale === "zh" ? "新建" : "New"} title={locale === "zh" ? "新建对话" : "New conversation"}>
            <AddIcon aria-hidden="true" size={17} />
          </button>
          <button className="icon-button conversation-icon-action" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} aria-label={locale === "zh" ? "历史" : "History"} title={locale === "zh" ? "历史对话" : "Conversation history"}>
            <HistoryIcon aria-hidden="true" size={17} />
          </button>
          <button className="icon-button conversation-icon-action" type="button" onClick={onToggleCollapsed} aria-label={locale === "zh" ? "收起右侧栏" : "Collapse right drawer"}>
            <ChevronRightIcon aria-hidden="true" size={18} />
          </button>
        </div>
      </div>

      <AnimatePresence>
      {historyOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="conversation-history-popover"
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
          transition={drawerTransition}
          aria-label={locale === "zh" ? "当前项目历史对话" : "Current Project conversation history"}
        >
          {projectThreads.map((thread) => (
            <button className={thread.id === currentThreadId ? "is-active" : ""} key={thread.id} type="button"
              onClick={() => {
                setHistoryOpen(false);
                void Promise.all(plans.filter((plan) => plan.status === "running").map((plan) => pausePlan(currentThreadId, plan.id)))
                  .finally(() => onSelectThread(thread.id));
              }}>
              <strong>{thread.title}</strong><time>{new Date(thread.updatedAt).toLocaleString()}</time>
            </button>
          ))}
          {projectThreads.length === 0 ? <p>{locale === "zh" ? "暂无历史对话" : "No conversation history yet."}</p> : null}
        </motion.div>
      ) : null}
      </AnimatePresence>

      {sessionError ? <p className="session-error" role="alert">{sessionError}</p> : null}

      <div className="drawer-message-list" aria-live="polite" ref={messageListRef}>
        {contextResetNotice ? <div className="context-reset-divider">{locale === "zh" ? "上下文已从此处重新开始" : "Context starts again from here"}</div> : null}
        {messages.length === 0 ? (
          <div className="empty-chat-state">
            {locale === "zh" ? "在这里追问、要求改写，或让 Agent 解释本次生成。" : "Ask follow-ups, request rewrites, or have the agent explain the current draft."}
          </div>
        ) : null}
        {timeline.map((entry) => {
          if (entry.kind === "plan") {
            const plan = entry.value;
            if (plan.clarification && plan.status === "awaiting_user") {
              return pendingClarificationPlan?.id === plan.id ? null : <PlanClarificationCard busy={clarificationBusy} key={`plan:${plan.id}`} plan={plan} onAnswer={(answer) => answerClarification(plan, answer)} />;
            }
            if (plan.clarification?.status === "answered" && plan.status === "draft") {
              return <PlanClarificationCard busy key={`plan:${plan.id}`} plan={plan} onAnswer={async () => {}} />;
            }
            const board = <PlanTaskBoard plan={plan} threadId={currentThreadId} onChanged={onPlansChanged} onFocusArtifact={onFocusPlanArtifact} onRevise={(value) => setInput(`/plan revise ${value.id}: `)} />;
            return <div key={`plan:${plan.id}`}>
              {plan.clarification?.status === "answered" ? <PlanClarificationCard busy plan={plan} onAnswer={async () => {}} /> : null}
              {board}
            </div>;
          }
          const message = entry.value;
          if (message.kind === "activity") {
            return <div className="plan-activity-line" key={message.id}><span aria-hidden="true" />{message.text}</div>;
          }
          const messageAnnotations = annotations.filter((annotation) => annotation.messageId === message.id);
          const isPendingAssistant = message.role === "assistant" && message.isStreaming && !message.text.trim();
          const hasRunTrace = message.role === "assistant" && Boolean(message.timeline?.length);
          const usesThinkingStatus = isPendingAssistant && !hasRunTrace;
          return (
            <article className={`message message-${message.role}${message.isStreaming ? " message-streaming" : ""}${usesThinkingStatus ? " message-thinking" : ""}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "U" : "F"}</div>
              <div className={usesThinkingStatus ? "message-thinking-status" : "message-bubble"}>
                {message.role === "assistant" && message.isStreaming && !message.text.trim() ? (
                  <>
                    <AssistantRunTrace events={message.timeline} onFocusNode={onFocusPlanArtifact} />
                    <StreamingStatus label={streamingStatusLabel(message, locale)} />
                  </>
                ) : message.role === "assistant" ? (
                  <div className="assistant-selectable-text" onMouseUp={(event) => captureSelection(event, message)}>
                    <AssistantRunTrace events={message.timeline} onFocusNode={onFocusPlanArtifact} />
                    <MarkdownText text={message.text} highlights={messageAnnotations.map((annotation) => annotation.text)} />
                    {message.isStreaming ? <span className="typing-caret" aria-hidden="true" /> : null}
                  </div>
                ) : <p>{message.text}</p>}
                {message.usedMock ? <span className="message-meta">{locale === "zh" ? "Mock 兜底" : "Mock fallback"}</span> : null}
              </div>
            </article>
          );
        })}
        {pendingWriteSuggestion ? (
          <div className="canvas-write-suggestion-tail">
            <span>{locale === "zh" ? "是否将这些要点生成到画板？" : "Create Canvas nodes for these points?"}</span>
            <button type="button" onClick={() => void acceptCanvasWriteSuggestion(currentThreadId, pendingWriteSuggestion.id).then(onPlansChanged)}>{locale === "zh" ? "生成节点" : "Create nodes"}</button>
            <button type="button" onClick={() => void dismissCanvasWriteSuggestion(currentThreadId, pendingWriteSuggestion.id).then(onPlansChanged)}>{locale === "zh" ? "不用" : "No thanks"}</button>
          </div>
        ) : null}
        {hasWriteProposal ? (
          <CanvasWriteProposalPanel
            annotations={annotations}
            busy={writeBusy}
            fullText={proposalFullText}
            request={writeDraft ? undefined : pendingWriteRequest}
            onApplyAll={() => applyWrite("all")}
            onApplyDefault={() => applyWrite(annotations.length ? "snippets" : "default")}
            onCancel={cancelWrite}
            onRemoveAnnotation={removeAnnotation}
          />
        ) : null}
        {writeStatus ? <p className="canvas-write-status">{writeStatus}</p> : null}
      </div>

      {selectionAction ? (
        <button
          className="message-annotation-popover"
          style={{ left: selectionAction.x, top: selectionAction.y }}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addAnnotation}
        >
          {locale === "zh" ? "批注" : "Annotate"}
        </button>
      ) : null}

      <form className={pendingClarificationPlan ? "drawer-chat-composer drawer-chat-composer-clarification" : "drawer-chat-composer"} onSubmit={submit}>
        <div className="composer-agent-row" data-testid="composer-agent-row">
          <AgentIcon aria-hidden="true" size={16} />
          <select className="composer-agent-select" aria-label={locale === "zh" ? "本次执行 Agent" : "Agent for this message"}
            value={activeAgent.id} onChange={(event) => onSelectAgent(event.target.value)}>
            {agentCards.map((agent) => <option key={agent.id} value={agent.id}>{agent.title[locale]}</option>)}
          </select>
        </div>
        <AnnotationChipRow annotations={annotations} compact onRemoveAnnotation={removeAnnotation} />
        {pendingClarificationPlan ? (
          <PlanClarificationCard
            busy={clarificationBusy}
            plan={pendingClarificationPlan}
            variant="composer"
            onAnswer={(answer) => answerClarification(pendingClarificationPlan, answer)}
          />
        ) : null}
        {mindChainContext ? (
          <div className="mind-chain-context-chip" data-testid="mind-chain-context-chip">
            <span>{locale === "zh" ? `思维链 · ${mindChainContext.nodeCount} 节点` : `Mind chain · ${mindChainContext.nodeCount} ${mindChainContext.nodeCount === 1 ? "node" : "nodes"}`}</span>
            <button
              aria-label={locale === "zh" ? "移除思维链上下文" : "Remove mind chain context"}
              onClick={onRemoveMindChainContext}
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
        <div
          aria-label={locale === "zh" ? "调整输入框高度" : "Resize message input"}
          aria-orientation="horizontal"
          className="composer-resize-handle"
          data-testid="composer-resize-handle"
          hidden={Boolean(pendingClarificationPlan)}
          onPointerDown={startComposerResize}
          role="separator"
          title={locale === "zh" ? "上下拖动调整输入框高度" : "Drag vertically to resize the message input"}
        >
          <span aria-hidden="true" />
        </div>
        <textarea
          aria-label="AI collaboration message"
          data-testid="ai-collaboration-input"
          disabled={Boolean(pendingClarificationPlan)}
          hidden={Boolean(pendingClarificationPlan)}
          placeholder={locale === "zh" ? "让 AI 协作修改当前草稿..." : "Ask AI to collaborate on this draft..."}
          rows={3}
          style={{ height: composerHeight }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <div className="composer-tool-row" hidden={Boolean(pendingClarificationPlan)}>
          <ToolUseIconBar allowedTools={allowedTools} toolState={toolState} onToolStateChange={onToolStateChange} />
          <select
            aria-label={locale === "zh" ? "会话模型" : "Conversation model"}
            className="composer-model-select"
            disabled={modelSelectionDisabled}
            value={selectedModelConfigId ?? ""}
            onChange={(event) => { void onSelectModel(event.target.value); }}
          >
            <option value="">{locale === "zh" ? "选择模型" : "Select model"}</option>
            {modelGroups(locale).map((group) => {
              const models = configuredModels.filter((model) => model.capabilityGroup === group.id);
              return models.length ? <optgroup key={group.id} label={group.label}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.providerLabel} / {model.modelName}</option>)}
              </optgroup> : null;
            })}
          </select>
          <button className="tool-icon-button plan-command-button" type="button" onClick={() => setInput((value) => value.startsWith("/plan") ? value : `/plan ${value}`)} title="Create a task plan">Plan</button>
          {supportsThinking ? (
            <div className="composer-think-controls" aria-label="Think mode">
              <button
                aria-pressed={thinkEnabled}
                className={thinkEnabled ? "tool-icon-button is-active" : "tool-icon-button"}
                onClick={() => setThinkEnabled((value) => !value)}
                title={thinkEnabled ? "Think mode on for this message" : "Think mode off for this message"}
                type="button"
              >
                T
                {thinkEnabled ? <i aria-hidden="true" /> : null}
              </button>
              {thinkEnabled ? (
                <select
                  aria-label="Reasoning effort"
                  className="composer-effort-select"
                  value={reasoningEffort ?? "high"}
                  onChange={(event) => setReasoningEffort(event.target.value as NonNullable<GenerateRequest["modelOverrides"]>["reasoningEffort"])}
                >
                  <option value="high">High</option>
                  <option value="max">Max</option>
                </select>
              ) : null}
            </div>
          ) : null}
          <button className={isSending ? "button button-primary chat-send chat-send-icon is-stopping" : "button button-primary chat-send chat-send-icon"} type={isSending ? "button" : "submit"} disabled={writeBusy} onClick={isSending ? onStopSending : undefined}
            aria-label={locale === "zh" ? "发送" : "Send"} title={isSending ? (locale === "zh" ? "发送中" : "Sending") : (locale === "zh" ? "发送" : "Send")}>
            {isSending ? <StopIcon aria-hidden="true" size={18} /> : <SendIcon aria-hidden="true" size={18} />}
          </button>
        </div>
      </form>
    </motion.aside>
  );
}

function StreamingStatus({ label }: { label: string }) {
  return (
    <div className="streaming-status" aria-live="polite">
      <span>{label}</span>
      <i aria-hidden="true" />
    </div>
  );
}

function streamingStatusLabel(message: CollaborationMessage, locale: "en" | "zh") {
  return message.statusLabel || (locale === "zh" ? "正在准备响应" : "Preparing response");
}

function isWriteConfirmation(text: string) {
  return /^(?:是|好|生成节点|yes|\u5199\u5165|\u5199\u5165\u5168\u90e8|\u76f4\u63a5\u5199\u5165|\u786e\u8ba4\u5199\u5165|\u786e\u8ba4|\u4fdd\u5b58|\u4fdd\u5b58\u5230\u753b\u677f|\u52a0\u5165\u753b\u677f|\u4fdd\u5b58\u5230\s*canvas|\u52a0\u5165\s*canvas|save\s+to\s+canvas|write\s+this|write\s+it|write|write\s+all)$/i.test(text.trim());
}

function ToolUseIconBar({ allowedTools, toolState, onToolStateChange }: Pick<AICollaborationDrawerProps, "allowedTools" | "toolState" | "onToolStateChange">) {
  const { locale } = useI18n();
  const visibleTools = visibleComposerTools(allowedTools);
  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="composer-tool-icons" aria-label="ToolUse">
      {visibleTools.map((tool) => {
        const active = Boolean(toolState?.[tool as ToolKey]);
        const meta = toolMeta[tool] ?? { en: tool, zh: tool, hint: tool };
        const label = locale === "zh" ? meta.zh : meta.en;
        return (
          <button
            aria-label={label}
            aria-pressed={active}
            className={active ? "tool-icon-button is-active" : "tool-icon-button"}
            key={tool}
            onClick={() => toggle(tool)}
            title={`${label}: ${meta.hint}`}
            type="button"
          >
            <ToolIcon tool={tool} />
            {active ? <i aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function ToolIcon({ tool }: { tool: string }) {
  if (tool === "web_search") return <SearchIcon aria-hidden="true" size={16} />;
  if (tool === "knowledge_base") return <KnowledgeIcon aria-hidden="true" size={16} />;
  return null;
}

function modelGroups(locale: "en" | "zh") {
  return [
    { id: "reasoning", label: locale === "zh" ? "推理模型" : "Reasoning models" },
    { id: "chat", label: locale === "zh" ? "对话模型" : "Chat models" },
    { id: "other-chat", label: locale === "zh" ? "其他聊天模型" : "Other chat models" }
  ] as const;
}
