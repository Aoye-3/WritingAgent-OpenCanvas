import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AddIcon, AgentIcon, ChevronLeftIcon, ChevronRightIcon, HistoryIcon, KnowledgeIcon, LightbulbIcon, ModelConfigIcon, SearchIcon, SendIcon, StopIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import type { AgentCard, CanvasWriteRequest, CanvasWriteSuggestion, PlanRun, SkillCatalogItem, SkillFolderItem, StoredThread } from "../../agents/types";
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
import { SkillFolderPicker } from "./SkillFolderPicker";

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

type ThinkingChoice = "disabled" | "high" | "max";

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
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  skillCatalog: SkillCatalogItem[];
  skillFolders: SkillFolderItem[];
  skillCatalogStatus: "idle" | "loading" | "ready" | "error";
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
  onRequestSkillCatalog: () => void;
  onCreateSkillFolder: (folderId: string) => Promise<void>;
  onDeleteSkillFolder: (folderId: string) => Promise<void>;
  onMoveSkillToFolder: (skill: SkillCatalogItem, folderId: string) => Promise<void>;
  onRenameSkillFolder: (folderId: string, nextFolderId: string) => Promise<void>;
  onSkillOverridesConsumed: () => void;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
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
  disabledSkillRefs,
  enabledSkillRefs,
  skillCatalog,
  skillFolders,
  skillCatalogStatus,
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
  onRequestSkillCatalog,
  onSkillOverridesConsumed,
  onToggleSkill,
  onToggleCollapsed,
  onToolStateChange,
  onPlansChanged,
  onFocusPlanArtifact,
  toolState
}: AICollaborationDrawerProps) {
  const { locale, t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const supportsThinking = modelSettings?.providerId === "deepseek";
  const [thinkingChoice, setThinkingChoice] = useState<ThinkingChoice>(modelSettingsToThinkingChoice(modelSettings));
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [annotations, setAnnotations] = useState<MessageAnnotation[]>([]);
  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeStatus, setWriteStatus] = useState("");
  const [composerHeight, setComposerHeight] = useState(72);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
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
    setThinkingChoice(modelSettingsToThinkingChoice(modelSettings));
  }, [modelSettings?.providerId, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

  useEffect(() => {
    if (!supportsThinking) setThinkingMenuOpen(false);
  }, [supportsThinking]);

  useEffect(() => {
    if (!inputDraft) return;
    setInput(inputDraft);
    onInputDraftConsumed();
  }, [inputDraft, onInputDraftConsumed]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => setContextResetNotice(false), [currentThreadId]);

  useEffect(() => {
    if (skillPickerOpen) onRequestSkillCatalog();
  }, [onRequestSkillCatalog, skillPickerOpen]);

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
      setWriteStatus(t("workspace.writtenToCanvas"));
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
      setWriteStatus(t("workspace.writeCanceled"));
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
      const sendResult = await onSend(text, supportsThinking ? thinkingOverridesFromChoice(thinkingChoice) : undefined, {
        ...(mindChainContext ? { canvasMindChain: mindChainContext.text } : {}),
        ...(awaitingPlan ? { awaitingPlan: { id: awaitingPlan.id, answer: text } } : {}),
        ...(revisePlan ? { awaitingPlan: { id: revisePlan.id, revise: true } } : {}),
        ...(enabledSkillRefs.length ? { transientSkillRefs: enabledSkillRefs } : {}),
        ...(disabledSkillRefs.length ? { disabledSkillRefs } : {})
      });
      if (sendResult) {
        onSkillOverridesConsumed();
        setSkillPickerOpen(false);
      }
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
        aria-label={t("workspace.expandAi")}
      >
        <motion.button
          animate={{ opacity: 1, x: 0 }}
          className="drawer-rail drawer-rail-right"
          initial={reduceMotion ? false : { opacity: 0, x: 8 }}
          transition={drawerTransition}
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t("workspace.expandAi")}
        >
          <span>AI</span>
          <small>{messages.length}</small>
          <b><ChevronLeftIcon aria-hidden="true" size={18} /></b>
        </motion.button>
      </motion.aside>
    );
  }

  return (
    <motion.aside className="ai-drawer" aria-label={t("workspace.expandAi")} layout transition={drawerTransition}>
      <div
        aria-label={t("workspace.resizeAiDrawer")}
        aria-orientation="vertical"
        className="ai-drawer-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={0}
        title={t("workspace.resizeAiDrawerTitle")}
      />
      <div className="conversation-compact-header" data-testid="conversation-compact-header">
        <strong>{projectThreads.find((thread) => thread.id === currentThreadId)?.title ?? t("workspace.newConversation")}</strong>
          <div className="conversation-header-actions">
            <button className="icon-button conversation-icon-action" type="button" disabled={sessionBusy} onClick={() => {
              void onResetContext().then(() => setContextResetNotice(true));
            }} aria-label={t("workspace.clearContext")} title={t("workspace.contextResetTitle")}>
              <HistoryIcon aria-hidden="true" size={17} />
            </button>
          <button className="icon-button conversation-icon-action" type="button" disabled={sessionBusy} onClick={() => { void onCreateConversation(); }} aria-label={t("workspace.newConversationAction")} title={t("workspace.newConversation")}>
            <AddIcon aria-hidden="true" size={17} />
          </button>
          <button className="icon-button conversation-icon-action" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} aria-label={t("workspace.history")} title={t("workspace.conversationHistory")}>
            <HistoryIcon aria-hidden="true" size={17} />
          </button>
          <button className="icon-button conversation-icon-action" type="button" onClick={onToggleCollapsed} aria-label={t("workspace.collapseRightDrawer")}>
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
          aria-label={t("workspace.projectConversationHistory")}
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
          {projectThreads.length === 0 ? <p>{t("workspace.noConversationHistory")}</p> : null}
        </motion.div>
      ) : null}
      </AnimatePresence>

      {sessionError ? <p className="session-error" role="alert">{sessionError}</p> : null}

      <div className="drawer-message-list" aria-live="polite" ref={messageListRef}>
        {contextResetNotice ? <div className="context-reset-divider">{t("workspace.contextStartsAgain")}</div> : null}
        {messages.length === 0 ? (
          <div className="empty-chat-state">
            {t("workspace.emptyChat")}
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
          const hasReasoningText = message.role === "assistant" && Boolean(message.reasoningText?.trim());
          const usesThinkingStatus = isPendingAssistant && !hasRunTrace && !hasReasoningText;
          return (
            <article className={`message message-${message.role}${message.isStreaming ? " message-streaming" : ""}${usesThinkingStatus ? " message-thinking" : ""}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "U" : "F"}</div>
              <div className={usesThinkingStatus ? "message-thinking-status" : "message-bubble"}>
                {message.role === "assistant" && message.isStreaming && !message.text.trim() ? (
                  <>
                    <AssistantRunTrace events={message.timeline} onFocusNode={onFocusPlanArtifact} />
                    <ReasoningStreamPanel message={message} />
                    <StreamingStatus label={streamingStatusLabel(message, t("workspace.preparingResponse"))} />
                  </>
                ) : message.role === "assistant" ? (
                  <div className="assistant-selectable-text" onMouseUp={(event) => captureSelection(event, message)}>
                    <AssistantRunTrace events={message.timeline} onFocusNode={onFocusPlanArtifact} />
                    <ReasoningStreamPanel message={message} />
                    <MarkdownText text={message.text} highlights={messageAnnotations.map((annotation) => annotation.text)} />
                    {message.isStreaming ? <span className="typing-caret" aria-hidden="true" /> : null}
                  </div>
                ) : <p>{message.text}</p>}
                {message.usedMock ? <span className="message-meta">{t("workspace.mockFallback")}</span> : null}
              </div>
            </article>
          );
        })}
        {pendingWriteSuggestion ? (
          <div className="canvas-write-suggestion-tail">
            <span>{t("workspace.createCanvasNodesQuestion")}</span>
            <button type="button" onClick={() => void acceptCanvasWriteSuggestion(currentThreadId, pendingWriteSuggestion.id).then(onPlansChanged)}>{t("workspace.createNodes")}</button>
            <button type="button" onClick={() => void dismissCanvasWriteSuggestion(currentThreadId, pendingWriteSuggestion.id).then(onPlansChanged)}>{t("workspace.noThanks")}</button>
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
          {t("workspace.annotate")}
        </button>
      ) : null}

      <form className={pendingClarificationPlan ? "drawer-chat-composer drawer-chat-composer-clarification" : "drawer-chat-composer"} onSubmit={submit}>
        <div className="composer-control-row" data-testid="composer-control-row">
          <div className="composer-agent-section">
            <AgentIcon aria-hidden="true" size={16} />
            <select className="composer-agent-select" aria-label={t("workspace.agentForMessage")}
              value={activeAgent.id} onChange={(event) => onSelectAgent(event.target.value)}>
              {agentCards.map((agent) => <option key={agent.id} value={agent.id}>{agent.title[locale]}</option>)}
            </select>
          </div>
          {supportsThinking ? (
            <div className="composer-thinking-section">
              <ThinkingModeButton
                choice={thinkingChoice}
                open={thinkingMenuOpen}
                onChange={setThinkingChoice}
                onOpenChange={setThinkingMenuOpen}
              />
            </div>
          ) : null}
        </div>
        <AnnotationChipRow annotations={annotations} compact onRemoveAnnotation={removeAnnotation} />
        {enabledSkillRefs.length || disabledSkillRefs.length ? (
          <div className="composer-skill-chips" aria-label={skillText(locale, "selectedSkills")}>
            {enabledSkillRefs.map((skillRef) => (
              <span className="composer-skill-chip" key={`enabled:${skillRef}`}>
                {skillRef}
                <button
                  aria-label={skillText(locale, "removeSkill", skillRef)}
                  onClick={() => onToggleSkill(findSkill(skillCatalog, skillRef), false)}
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
            {disabledSkillRefs.map((skillRef) => (
              <span className="composer-skill-chip is-disabled" key={`disabled:${skillRef}`}>
                {skillText(locale, "disabledSkill", skillRef)}
                <button
                  aria-label={skillText(locale, "restoreSkill", skillRef)}
                  onClick={() => onToggleSkill(findSkill(skillCatalog, skillRef), true)}
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
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
            <span>{t("workspace.mindChainContext", { count: mindChainContext.nodeCount })}</span>
            <button
              aria-label={t("workspace.removeMindChain")}
              onClick={onRemoveMindChainContext}
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
        <div
          aria-label={t("workspace.resizeMessageInput")}
          aria-orientation="horizontal"
          className="composer-resize-handle"
          data-testid="composer-resize-handle"
          hidden={Boolean(pendingClarificationPlan)}
          onPointerDown={startComposerResize}
          role="separator"
          title={t("workspace.resizeMessageInputTitle")}
        >
          <span aria-hidden="true" />
        </div>
        <textarea
          aria-label={t("workspace.aiMessage")}
          data-testid="ai-collaboration-input"
          disabled={Boolean(pendingClarificationPlan)}
          hidden={Boolean(pendingClarificationPlan)}
          placeholder={t("workspace.askAiPlaceholder")}
          rows={3}
          style={{ height: composerHeight }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <div className="composer-tool-row" hidden={Boolean(pendingClarificationPlan)}>
          <ToolUseIconBar allowedTools={allowedTools} toolState={toolState} onToolStateChange={onToolStateChange} />
          <div className="composer-skill-picker">
            <button
              aria-expanded={skillPickerOpen}
              aria-label={skillText(locale, "skills")}
              className={enabledSkillRefs.length || disabledSkillRefs.length ? "tool-icon-button is-active" : "tool-icon-button"}
              onClick={() => setSkillPickerOpen((value) => !value)}
              title={skillText(locale, "skills")}
              type="button"
            >
              <AddIcon aria-hidden="true" size={15} />
            </button>
            {skillPickerOpen ? (
              <div className="composer-skill-menu" role="menu">
                <strong>{skillText(locale, "skills")}</strong>
                <SkillFolderPicker
                  activeSkillRefs={activeAgent.skillRefs}
                  disabledSkillRefs={disabledSkillRefs}
                  enabledSkillRefs={enabledSkillRefs}
                  folders={skillFolders}
                  locale={locale}
                  skills={skillCatalog}
                  status={skillCatalogStatus}
                  onToggleSkill={onToggleSkill}
                />
              </div>
            ) : null}
          </div>
          <select
            aria-label={t("workspace.conversationModel")}
            className="composer-model-select"
            disabled={modelSelectionDisabled}
            value={selectedModelConfigId ?? ""}
            onChange={(event) => { void onSelectModel(event.target.value); }}
          >
            <option value="">{t("workspace.selectModel")}</option>
            {modelGroups(locale).map((group) => {
              const models = configuredModels.filter((model) => model.capabilityGroup === group.id);
              return models.length ? <optgroup key={group.id} label={group.label}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.providerLabel} / {model.modelName}</option>)}
              </optgroup> : null;
            })}
          </select>
          <button className="tool-icon-button plan-command-button" type="button" onClick={() => setInput((value) => value.startsWith("/plan") ? value : `/plan ${value}`)} aria-label={t("workspace.createTaskPlan")} title={t("workspace.createTaskPlan")}>
            <ModelConfigIcon aria-hidden="true" size={15} />
          </button>
          <button className={isSending ? "button button-primary chat-send chat-send-icon is-stopping" : "button button-primary chat-send chat-send-icon"} type={isSending ? "button" : "submit"} disabled={writeBusy} onClick={isSending ? onStopSending : undefined}
            aria-label={t("workspace.send")} title={isSending ? t("workspace.sending") : t("workspace.send")}>
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

function ThinkingModeButton({
  choice,
  open,
  onChange,
  onOpenChange
}: {
  choice: ThinkingChoice;
  open: boolean;
  onChange: (choice: ThinkingChoice) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ value: ThinkingChoice; label: string }> = [
    { value: "disabled", label: t("workspace.disabled") },
    { value: "high", label: t("workspace.high") },
    { value: "max", label: t("workspace.max") }
  ];
  const current = options.find((option) => option.value === choice) ?? options[0];

  return (
    <div className="thinking-mode-control">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("workspace.thinkMode")}
        className={choice === "disabled" ? "thinking-mode-button" : "thinking-mode-button is-active"}
        onClick={() => onOpenChange(!open)}
        title={t("workspace.thinkMode")}
        type="button"
      >
        <span aria-hidden="true"><LightbulbIcon size={13} /></span>
        <strong>{current.label}</strong>
      </button>
      {open ? (
        <div className="thinking-mode-menu" role="menu">
          {options.map((option) => (
            <button
              aria-checked={choice === option.value}
              className={choice === option.value ? "is-active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningStreamPanel({ message }: { message: CollaborationMessage }) {
  const { t } = useI18n();
  const text = message.reasoningText?.trim();
  if (!text) return null;
  return (
    <details className="reasoning-stream-panel" open={Boolean(message.isReasoningStreaming)}>
      <summary>
        <span>{t("workspace.thinking")}</span>
        {message.isReasoningStreaming ? <i aria-hidden="true" /> : null}
      </summary>
      <pre>{message.reasoningText}</pre>
    </details>
  );
}

function streamingStatusLabel(message: CollaborationMessage, fallback: string) {
  return message.statusLabel || fallback;
}

function isWriteConfirmation(text: string) {
  return /^(?:是|好|生成节点|yes|\u5199\u5165|\u5199\u5165\u5168\u90e8|\u76f4\u63a5\u5199\u5165|\u786e\u8ba4\u5199\u5165|\u786e\u8ba4|\u4fdd\u5b58|\u4fdd\u5b58\u5230\u753b\u677f|\u52a0\u5165\u753b\u677f|\u4fdd\u5b58\u5230\s*canvas|\u52a0\u5165\s*canvas|save\s+to\s+canvas|write\s+this|write\s+it|write|write\s+all)$/i.test(text.trim());
}

function modelSettingsToThinkingChoice(modelSettings?: ConversationModelControls): ThinkingChoice {
  if (modelSettings?.providerId !== "deepseek" || modelSettings.thinkingMode !== "enabled") return "disabled";
  return modelSettings.reasoningEffort === "max" || modelSettings.reasoningEffort === "xhigh" ? "max" : "high";
}

function thinkingOverridesFromChoice(choice: ThinkingChoice): GenerateRequest["modelOverrides"] {
  if (choice === "disabled") return { thinkingMode: "disabled" };
  return { thinkingMode: "enabled", reasoningEffort: choice };
}

function ToolUseIconBar({ allowedTools, toolState, onToolStateChange }: Pick<AICollaborationDrawerProps, "allowedTools" | "toolState" | "onToolStateChange">) {
  const { locale, t } = useI18n();
  const visibleTools = visibleComposerTools(allowedTools);
  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="composer-tool-icons" aria-label={t("workspace.toolUseCommandBar")}>
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

function findSkill(skills: SkillCatalogItem[], skillRef: string): SkillCatalogItem {
  return skills.find((skill) => skill.id === skillRef || skill.name === skillRef || skill.relativePath === skillRef) ?? {
    id: skillRef,
    name: skillRef,
    description: "",
    allowedTools: [],
    requiresEnv: [],
    runtimeTools: [],
    originalAllowedTools: [],
    executionMode: "instruction",
    riskLevel: "low",
    folderId: "default",
    folderName: "Default skills",
    folderPath: "default",
    relativePath: skillRef,
    source: "project",
    manageable: true,
    status: "available"
  };
}

function skillText(locale: "en" | "zh", key: "disabledSkill" | "loadingSkills" | "noSkills" | "removeSkill" | "restoreSkill" | "selectedSkills" | "skillLoadFailed" | "skills", value?: string) {
  if (key === "removeSkill") return locale === "zh" ? `\u79fb\u9664\u6280\u80fd ${value ?? ""}` : `Remove skill ${value ?? ""}`;
  if (key === "restoreSkill") return locale === "zh" ? `\u6062\u590d\u6280\u80fd ${value ?? ""}` : `Restore skill ${value ?? ""}`;
  if (key === "disabledSkill") return locale === "zh" ? `\u5df2\u7981\u7528 ${value ?? ""}` : `Disabled ${value ?? ""}`;
  const copy = {
    en: {
      skills: "Skills",
      loadingSkills: "Loading skills...",
      skillLoadFailed: "Unable to load skills",
      noSkills: "No public skills available",
      selectedSkills: "Selected skills"
    },
    zh: {
      skills: "\u6280\u80fd",
      loadingSkills: "\u6b63\u5728\u52a0\u8f7d\u6280\u80fd...",
      skillLoadFailed: "\u65e0\u6cd5\u52a0\u8f7d\u6280\u80fd\u5217\u8868",
      noSkills: "\u6682\u65e0\u53ef\u7528\u6280\u80fd",
      selectedSkills: "\u5df2\u9009\u6280\u80fd"
    }
  } as const;
  return copy[locale][key];
}
