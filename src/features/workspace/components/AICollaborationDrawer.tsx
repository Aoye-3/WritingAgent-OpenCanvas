import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AddIcon, ChevronLeftIcon, ChevronRightIcon, HistoryIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import type { AgentCard, AgentClarification, CanvasNode, CanvasWriteRequest, CanvasWriteSuggestion, FinalSupplement, PlanRun, RunTimelineEvent, SkillCatalogItem, SkillFolderItem, StoredThread } from "../../agents/types";
import type { CanvasNodePatch } from "../../canvas/canvasClient";
import { fetchRuntimeRunEvents } from "../../generation/generationClient";
import type { CollaborationMessage, GenerateRequest, RuntimeRunEvent } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import { AnnotationChipRow, CanvasWriteProposalPanel, type MessageAnnotation } from "./CanvasWriteProposalPanel";
import { AssistantRunTrace } from "./AssistantRunTrace";
import type { CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import { AgentPlanBoard } from "./AgentPlanBoard";
import { PlanClarificationCard } from "./PlanClarificationCard";
import { acceptCanvasWriteSuggestion, answerPlan, dismissCanvasWriteSuggestion, pausePlan } from "../../agents/agentClient";
import { buildPlanTimeline } from "../planTimeline";
import { sanitizeCanvasForAgentIntake } from "../../../../shared/agentIntakeCanvas";
import type { ConfiguredModelApiSummary } from "../../settings/types";
import { AIComposer, isThinkingSupportedModel, type AIComposerSubmitPayload, type ConversationModelControls, type RuntimeBudgetChoice } from "./AIComposer";

export type { ConversationModelControls } from "./AIComposer";

type ThinkingChoice = "disabled" | "high" | "max";

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

type AICollaborationDrawerProps = {
  allowedTools: string[];
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWriteSuggestions: CanvasWriteSuggestion[];
  agentClarifications: AgentClarification[];
  finalSupplement?: FinalSupplement;
  canvasNodes: CanvasNode[];
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
  runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"];
  selectedModelConfigId?: string | null;
  modelSettings?: ConversationModelControls;
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onResetContext: () => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onUpdateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onInputDraftConsumed: () => void;
  onMindChainContextConsumed: () => void;
  onRemoveMindChainContext: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<unknown>;
  onQueueInput: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => string | undefined;
  onRequestQueuedInputIntervention: (id: string) => void;
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

export function AICollaborationDrawer({
  allowedTools,
  activeAgent,
  agentCards,
  canvasWriteRequests,
  canvasWriteSuggestions,
  agentClarifications,
  finalSupplement,
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
  runtimeBudgetProfile,
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
  onQueueInput,
  onRequestQueuedInputIntervention,
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
  const supportsThinking = isThinkingSupportedModel(modelSettings);
  const [thinkingChoice, setThinkingChoice] = useState<ThinkingChoice>(modelSettingsToThinkingChoice(modelSettings));
  const [runtimeBudgetChoice, setRuntimeBudgetChoice] = useState<RuntimeBudgetChoice>(runtimeBudgetProfile ?? "low");
  const [annotations, setAnnotations] = useState<MessageAnnotation[]>([]);
  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeStatus, setWriteStatus] = useState("");
  const composerHeight = 72;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextResetNotice, setContextResetNotice] = useState(false);
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [planPanelCollapsed, setPlanPanelCollapsed] = useState(false);
  const [finalSupplementAdditions, setFinalSupplementAdditions] = useState<Record<string, string[]>>({});
  const [submittedFinalSupplementIds, setSubmittedFinalSupplementIds] = useState<Set<string>>(() => new Set());
  const [submittedAgentClarificationKeys, setSubmittedAgentClarificationKeys] = useState<Set<string>>(() => new Set());
  const [optimisticAgentClarifications, setOptimisticAgentClarifications] = useState<AgentClarification[]>([]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const drawerTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 300, damping: 32 };

  const pendingWriteRequest = canvasWriteRequests.find((request) => request.operation !== "replace_range");
  const pendingWriteSuggestion = canvasWriteSuggestions.find((suggestion) => suggestion.status === "pending");
  const proposalFullText = writeDraft?.text || pendingWriteRequest?.content || "";
  const annotatedText = annotations.map((annotation) => annotation.text).join("\n\n");
  const hasWriteProposal = Boolean(writeDraft || pendingWriteRequest || annotations.length);
  const visibleAgentClarifications = useMemo(
    () => mergeAgentClarificationDisplayRecords(agentClarifications, optimisticAgentClarifications),
    [agentClarifications, optimisticAgentClarifications]
  );
  const timeline = useMemo(
    () => buildAgentClarificationTimeline(buildPlanTimeline(messages, plans), visibleAgentClarifications),
    [messages, plans, visibleAgentClarifications]
  );
  const pendingClarificationPlan = plans.find((plan) => plan.status === "awaiting_user" && plan.clarification?.status === "pending");
  const answeredAgentClarificationKeys = useMemo(
    () => visibleAgentClarifications.reduce((keys, clarification) => {
      if (clarification.status === "answered") {
        for (const key of agentClarificationAnsweredKeys(clarification)) keys.add(key);
      }
      return keys;
    }, new Set(submittedAgentClarificationKeys)),
    [visibleAgentClarifications, submittedAgentClarificationKeys]
  );
  const pendingAgentClarification = useMemo(
    () => agentClarificationFromRecord(agentClarifications.find((clarification) => clarification.status === "pending" && !isAgentClarificationRecordAnswered(clarification, answeredAgentClarificationKeys)), answeredAgentClarificationKeys) ?? latestPendingAgentClarification(messages, answeredAgentClarificationKeys),
    [agentClarifications, answeredAgentClarificationKeys, messages]
  );
  const pendingFinalSupplement = pendingClarificationPlan || pendingAgentClarification ? undefined : pendingFinalSupplementForDisplay(finalSupplement, submittedFinalSupplementIds);
  const missingAgentClarificationPayload = useMemo(
    () => !pendingAgentClarification && hasUnresolvedAgentClarificationTrace(messages, answeredAgentClarificationKeys),
    [answeredAgentClarificationKeys, messages, pendingAgentClarification]
  );
  const budgetLimitFailure = useMemo(() => latestBudgetLimitFailure(messages), [messages]);
  const floatingBoardPlan = useMemo(
    () => plans.find((plan) => plan.status === "awaiting_approval" || plan.status === "running" || plan.status === "paused"),
    [plans]
  );
  const floatingPlan = pendingClarificationPlan ?? floatingBoardPlan;
  const floatingPlanPanelStyle = { "--plan-panel-bottom": `${pendingClarificationPlan || pendingAgentClarification || pendingFinalSupplement ? 142 : composerHeight + 142}px` } as CSSProperties;

  useEffect(() => {
    setThinkingChoice(modelSettingsToThinkingChoice(modelSettings));
  }, [modelSettings?.providerId, modelSettings?.modelId, modelSettings?.modelName, modelSettings?.supportsThinking, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

  useEffect(() => {
    setRuntimeBudgetChoice(runtimeBudgetProfile ?? "low");
  }, [runtimeBudgetProfile]);

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
    setSubmittedAgentClarificationKeys(new Set());
    setOptimisticAgentClarifications([]);
    setFinalSupplementAdditions({});
    setSubmittedFinalSupplementIds(new Set());
    setPlanPanelCollapsed(false);
  }, [currentThreadId]);
  useEffect(() => {
    setPlanPanelCollapsed(false);
  }, [floatingPlan?.id, floatingPlan?.status, pendingAgentClarification?.clarificationId, pendingFinalSupplement?.id]);

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

  const submitComposerPayload = async (payload: AIComposerSubmitPayload) => {
    const text = payload.text.trim();
    if (!text) return;
    if (pendingAgentClarification || pendingFinalSupplement) return;
    setInput("");
    const runtimeBudgetOverride = payload.runtimeBudgetProfile === (runtimeBudgetProfile ?? "low")
      ? undefined
      : payload.runtimeBudgetProfile;
    const messageModelOverrides = supportsThinking ? thinkingOverridesFromChoice(payload.thinkingChoice) : undefined;
    const messageRequestContext = {
      ...(mindChainContext ? { canvasMindChain: mindChainContext.text } : {}),
      ...(payload.enabledSkillRefs.length ? { transientSkillRefs: payload.enabledSkillRefs } : {}),
      ...(payload.disabledSkillRefs.length ? { disabledSkillRefs: payload.disabledSkillRefs } : {}),
      ...(runtimeBudgetOverride ? { runtimeBudgetProfile: runtimeBudgetOverride } : {})
    };
    if (isSending) {
      onQueueInput(text, messageModelOverrides, messageRequestContext);
      onSkillOverridesConsumed();
      if (mindChainContext) onMindChainContextConsumed();
      return;
    }
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
        ...messageRequestContext,
        ...(awaitingPlan ? { awaitingPlan: { id: awaitingPlan.id, answer: text } } : {}),
        ...(revisePlan ? { awaitingPlan: { id: revisePlan.id, revise: true } } : {})
      });
      if (sendResult) {
        if (!isAgentClarificationRequired(sendResult)) {
          onSkillOverridesConsumed();
        }
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

  const fillBudgetContinuation = () => {
    setInput(locale === "zh"
      ? "继续完成上一步任务，沿用已有澄清选择、技能和 Canvas 进度；不要重复已经完成的检索，优先收束并补全最终内容。"
      : "Continue the previous task using the existing clarification choice, skills, and Canvas progress. Do not repeat completed research; prioritize synthesis and complete the final content.");
  };

  const fillClarificationRecovery = () => {
    setInput(locale === "zh"
      ? "\u4e0a\u4e00\u8f6e\u5728\u7b49\u5f85\u8865\u5145\u4fe1\u606f\uff0c\u4f46\u6ca1\u6709\u53ef\u9009\u9009\u9879\u53ef\u7528\u3002\u8bf7\u57fa\u4e8e\u539f\u59cb\u4efb\u52a1\u7ee7\u7eed\uff0c\u5982\u679c\u8fd8\u9700\u8981\u786e\u8ba4\uff0c\u8bf7\u91cd\u65b0\u7ed9\u51fa\u5b8c\u6574\u9009\u9879\u3002"
      : "The last run is waiting for clarification, but no actionable options are available. Continue the original task, or ask again with complete choices if confirmation is still required.");
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

  const answerAgentClarification = async (clarification: AgentClarificationPrompt, answer: { optionId?: string; customAnswer?: string }) => {
    const submission = buildAgentClarificationSubmission({
      clarification,
      currentThreadId,
      optionId: answer.optionId,
      answerText: answer.customAnswer,
      enabledSkillRefs,
      disabledSkillRefs,
      runtimeBudgetChoice,
      runtimeBudgetProfile
    });
    if (!submission) return;
    setClarificationBusy(true);
    setSubmittedAgentClarificationKeys((current) => new Set([...current, ...submission.submittedKeys]));
    setOptimisticAgentClarifications((current) => [...current, submission.optimisticClarification]);
    try {
      const result = await onSend(submission.instructionText, undefined, submission.requestContext);
      if (isFailedSendResult(result)) {
        setSubmittedAgentClarificationKeys((current) => removeSubmittedAgentClarificationKeys(current, submission.submittedKeys));
        setOptimisticAgentClarifications((current) => removeOptimisticAgentClarification(current, submission.optimisticClarification));
      }
    } catch (error) {
      setSubmittedAgentClarificationKeys((current) => removeSubmittedAgentClarificationKeys(current, submission.submittedKeys));
      setOptimisticAgentClarifications((current) => removeOptimisticAgentClarification(current, submission.optimisticClarification));
      throw error;
    } finally {
      setClarificationBusy(false);
    }
  };

  const addFinalSupplement = async (supplement: string) => {
    if (!pendingFinalSupplement) return;
    setFinalSupplementAdditions((current) => appendFinalSupplementAddition(current, pendingFinalSupplement.id, supplement));
  };

  const executeFinalSupplement = async (supplement: FinalSupplement) => {
    const additions = finalSupplementAdditions[supplement.id] ?? [];
    const instructionText = finalSupplementInstruction(supplement.instructionText, additions, locale);
    setClarificationBusy(true);
    setSubmittedFinalSupplementIds((current) => addSubmittedFinalSupplementId(current, supplement.id));
    try {
      const result = await onSend(instructionText, undefined, {
        ...supplement.requestContext,
        finalSupplement: {
          finalSupplementId: supplement.id,
          action: "execute"
        }
      });
      if (!isFailedSendResult(result)) {
        setFinalSupplementAdditions((current) => {
          const next = { ...current };
          delete next[supplement.id];
          return next;
        });
      } else {
        setSubmittedFinalSupplementIds((current) => removeSubmittedFinalSupplementId(current, supplement.id));
      }
    } catch (error) {
      setSubmittedFinalSupplementIds((current) => removeSubmittedFinalSupplementId(current, supplement.id));
      throw error;
    } finally {
      setClarificationBusy(false);
    }
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
          if (entry.kind === "agentClarification") {
            return <AgentClarificationAnswerCard clarification={entry.value} key={`agent-clarification:${entry.value.id}`} locale={locale} />;
          }
          if (entry.kind === "plan") {
            const plan = entry.value;
            if (floatingPlan?.id === plan.id) return null;
            if (plan.clarification && plan.status === "awaiting_user") {
              return pendingClarificationPlan?.id === plan.id ? null : <PlanClarificationCard busy={clarificationBusy} key={`plan:${plan.id}`} plan={plan} onAnswer={(answer) => answerClarification(plan, answer)} />;
            }
            if (plan.clarification?.status === "answered" && plan.status === "draft") {
              return <PlanClarificationCard busy key={`plan:${plan.id}`} plan={plan} onAnswer={async () => {}} />;
            }
            const board = <AgentPlanBoard plan={plan} threadId={currentThreadId} onChanged={onPlansChanged} onFocusArtifact={onFocusPlanArtifact} onRevise={(value) => setInput(`/plan revise ${value.id}: `)} />;
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
          const progressSegments = message.role === "assistant" ? progressSegmentsForMessage(message) : [];
          const rawRunLogEvents = message.role === "assistant" ? rawRunLogEventsForMessage(message) : [];
          const rawRunTarget = message.role === "assistant" ? runtimeRunTargetForMessage(message, rawRunLogEvents) : undefined;
          const hasProgressSegments = progressSegments.length > 0;
          const hasRunTrace = message.role === "assistant" && Boolean(message.timeline?.some((event) => !isProgressTimelineEvent(event)));
          const hasReasoningText = message.role === "assistant" && Boolean(message.reasoningText?.trim());
          const hasRuntimePanel = message.role === "assistant" && (hasProgressSegments || hasRunTrace || hasReasoningText || Boolean(rawRunTarget) || Boolean(message.completion));
          const usesThinkingStatus = isPendingAssistant && !hasRunTrace && !hasReasoningText && !hasProgressSegments;
          const traceTarget = agentPlanTraceTarget(message.timeline, plans);
          const runtimePanel = hasRuntimePanel ? (
            <AgentLoopRunPanel
              completed={!message.isStreaming && Boolean(message.text.trim())}
              fallbackEvents={rawRunLogEvents}
              isStreaming={Boolean(message.isStreaming)}
              key={`${message.id}:runtime`}
              message={message}
              onFocusPlanArtifact={onFocusPlanArtifact}
              progressSegments={progressSegments}
              runTarget={rawRunTarget}
              traceTarget={traceTarget}
            />
          ) : null;
          if (message.role === "assistant" && !message.text.trim()) {
            return (
              <div className="agent-loop-message-frame" key={message.id}>
                {runtimePanel}
                {message.isStreaming && !runtimePanel ? (
                  <article className="message message-assistant message-streaming message-thinking">
                    <div className="message-avatar" aria-hidden="true">F</div>
                    <div className="message-thinking-status">
                      <StreamingStatus label={streamingStatusLabel(message, t("workspace.preparingResponse"))} />
                    </div>
                  </article>
                ) : null}
              </div>
            );
          }
          return (
            <div className="agent-loop-message-frame" key={message.id}>
              {runtimePanel}
              <article className={`message message-${message.role}${message.isStreaming ? " message-streaming" : ""}${usesThinkingStatus ? " message-thinking" : ""}`}>
                <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "U" : "F"}</div>
                <div className={usesThinkingStatus ? "message-thinking-status" : "message-bubble"}>
                  {message.role === "assistant" ? (
                    <div className="assistant-selectable-text" onMouseUp={(event) => captureSelection(event, message)}>
                      <MarkdownText text={message.text} highlights={messageAnnotations.map((annotation) => annotation.text)} />
                      {message.isStreaming ? <span className="typing-caret" aria-hidden="true" /> : null}
                    </div>
                  ) : (
                    <>
                      <p>{message.text}</p>
                      <QueuedInputStatus message={message} onRequestIntervention={onRequestQueuedInputIntervention} />
                    </>
                  )}
                  {message.usedMock ? <span className="message-meta">{t("workspace.mockFallback")}</span> : null}
                </div>
              </article>
            </div>
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

      {floatingPlan || pendingAgentClarification || pendingFinalSupplement ? (
        <section
          className={planPanelCollapsed ? "floating-plan-panel is-collapsed" : "floating-plan-panel"}
          style={floatingPlanPanelStyle}
        >
          <button
            aria-expanded={!planPanelCollapsed}
            className="floating-plan-panel-toggle"
            onClick={() => setPlanPanelCollapsed((value) => !value)}
            type="button"
          >
            <strong>{floatingPlan && !pendingFinalSupplement ? t("plan.progress") : locale === "zh" ? "\u8865\u5145\u4fe1\u606f" : "Clarification"}</strong>
            <span>{planPanelCollapsed ? "+" : "-"}</span>
          </button>
          {!planPanelCollapsed && pendingClarificationPlan ? (
            <PlanClarificationCard
              busy={clarificationBusy}
              plan={pendingClarificationPlan}
              variant="composer"
              onAnswer={(answer) => answerClarification(pendingClarificationPlan, answer)}
            />
          ) : null}
          {!planPanelCollapsed && floatingPlan && floatingPlan.id !== pendingClarificationPlan?.id && !pendingFinalSupplement ? (
            <AgentPlanBoard
              plan={floatingPlan}
              threadId={currentThreadId}
              onChanged={onPlansChanged}
              onFocusArtifact={onFocusPlanArtifact}
              onRevise={(value) => setInput(`/plan revise ${value.id}: `)}
            />
          ) : null}
          {!planPanelCollapsed && pendingAgentClarification ? (
            <AgentClarificationChoiceCard
              busy={clarificationBusy}
              clarification={pendingAgentClarification}
              locale={locale}
              variant="composer"
              onAnswer={(answer) => answerAgentClarification(pendingAgentClarification, answer)}
            />
          ) : null}
          {!planPanelCollapsed && pendingFinalSupplement ? (
            <FinalSupplementCard
              additions={finalSupplementAdditions[pendingFinalSupplement.id] ?? []}
              busy={clarificationBusy}
              locale={locale}
              supplement={pendingFinalSupplement}
              onAdd={addFinalSupplement}
              onExecute={() => executeFinalSupplement(pendingFinalSupplement)}
            />
          ) : null}
        </section>
      ) : null}

      <div className="drawer-chat-composer-context">
        <AnnotationChipRow annotations={annotations} compact onRemoveAnnotation={removeAnnotation} />
        {mindChainContext ? (
          <div className="mind-chain-context-chip" data-testid="mind-chain-context-chip">
            <span>{t("workspace.mindChainContext", { count: mindChainContext?.nodeCount ?? 0 })}</span>
            <button
              aria-label={t("workspace.removeMindChain")}
              onClick={onRemoveMindChainContext}
              type="button"
            >
              x
            </button>
          </div>
        ) : null}
        {missingAgentClarificationPayload && !pendingClarificationPlan ? (
          <div className="budget-continuation-chip">
            <span>{locale === "zh" ? "\u7b49\u5f85\u8865\u5145\u4fe1\u606f\uff0c\u4f46\u7f3a\u5c11\u53ef\u64cd\u4f5c\u9009\u9879\u3002" : "Clarification is waiting, but no choices were saved."}</span>
            <button type="button" onClick={fillClarificationRecovery}>
              {locale === "zh" ? "\u586b\u5165\u6062\u590d" : "Draft recovery"}
            </button>
          </div>
        ) : null}
        {budgetLimitFailure && !pendingClarificationPlan && !pendingAgentClarification && !missingAgentClarificationPayload ? (
          <div className="budget-continuation-chip">
            <span>{locale === "zh" ? "\u4e0a\u6b21\u8fd0\u884c\u8fbe\u5230\u6b65\u9aa4\u9884\u7b97\uff0c\u53ef\u7ee7\u7eed\u5b8c\u6210\u3002" : "The last run reached its step budget."}</span>
            <button type="button" onClick={fillBudgetContinuation}>
              {locale === "zh" ? "\u586b\u5165\u7ee7\u7eed" : "Draft continue"}
            </button>
          </div>
        ) : null}
      </div>
      {pendingClarificationPlan || pendingAgentClarification || pendingFinalSupplement ? null : (
        <AIComposer
          activeAgent={activeAgent}
          agentCards={agentCards}
          allowedTools={allowedTools}
          configuredModels={configuredModels}
          disabled={writeBusy}
          disabledSkillRefs={disabledSkillRefs}
          enabledSkillRefs={enabledSkillRefs}
          isSending={isSending}
          modelSelectionDisabled={modelSelectionDisabled}
          modelSettings={modelSettings}
          placeholder={t("workspace.askAiPlaceholder")}
          runtimeBudgetProfile={runtimeBudgetProfile}
          selectedModelConfigId={selectedModelConfigId}
          skillCatalog={skillCatalog}
          skillCatalogStatus={skillCatalogStatus}
          skillFolders={skillFolders}
          toolState={toolState}
          value={input}
          onRequestSkillCatalog={onRequestSkillCatalog}
          onSelectAgent={onSelectAgent}
          onSelectModel={onSelectModel}
          onStopSending={onStopSending}
          onSubmit={submitComposerPayload}
          onToggleSkill={onToggleSkill}
          onToolStateChange={onToolStateChange}
          onValueChange={setInput}
        />
      )}
    </motion.aside>
  );
}

function ProgressSegmentList({ completed, rawEvents, runTarget, segments }: {
  completed: boolean;
  rawEvents: RunTimelineEvent[];
  runTarget?: { threadId: string; runId: string };
  segments: ReturnType<typeof progressSegmentsForMessage>;
}) {
  const { locale } = useI18n();
  if (!segments.length) return null;
  const body = (
    <>
      <div className="progress-segment-list">
        {segments.map((segment) => (
          <div className="progress-segment" key={segment.id}>
            {segment.title ? <strong>{segment.title}</strong> : null}
            <p>{segment.summary}</p>
            {segment.next && segment.next !== segment.summary ? <small>{segment.next}</small> : null}
            {segment.evidence?.length ? (
              <div className="progress-evidence-list" aria-label={locale === "zh" ? "进展依据" : "Progress evidence"}>
                {segment.evidence.slice(0, 3).map((item) => (
                  <span className="progress-evidence-chip" key={`${segment.id}:${item.kind}:${item.label}:${item.ref ?? ""}`} title={item.ref ?? item.label}>
                    {progressEvidenceLabel(item)}
                  </span>
                ))}
              </div>
            ) : null}
            {segment.interventionHint ? <em>{segment.interventionHint}</em> : null}
          </div>
        ))}
      </div>
      <RawRunLogDetails fallbackEvents={rawEvents} runTarget={runTarget} />
    </>
  );
  if (!completed) return body;
  return (
    <details className="progress-segment-history">
      <summary>{locale === "zh" ? "\u9636\u6bb5\u6c47\u62a5" : "Stage reports"}</summary>
      {body}
    </details>
  );
}

function RawRunLogDetails({ fallbackEvents, runTarget }: { fallbackEvents: RunTimelineEvent[]; runTarget?: { threadId: string; runId: string } }) {
  const { locale } = useI18n();
  const [events, setEvents] = useState<RuntimeRunEvent[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  if (!runTarget && !fallbackEvents.length) return null;
  const displayEvents = events.length ? events : fallbackEvents.map(runtimeRunEventFromTimeline);
  const count = displayEvents.length;
  const label = locale === "zh" ? "\u5df2\u8fd0\u884c\u547d\u4ee4/\u5de5\u5177" : "Raw tool log";
  const loadEvents = () => {
    if (!runTarget || status !== "idle") return;
    setStatus("loading");
    fetchRuntimeRunEvents({ ...runTarget, limit: 500 })
      .then((nextEvents) => {
        setEvents(nextEvents);
        setStatus("loaded");
      })
      .catch(() => setStatus("failed"));
  };
  return (
    <details className="raw-run-log-details" onToggle={(event) => { if (event.currentTarget.open) loadEvents(); }}>
      <summary>
        {label}{count ? ` ${count}` : ""}
        {status === "loading" ? (locale === "zh" ? " \u52a0\u8f7d\u4e2d" : " loading") : null}
        {status === "failed" ? (locale === "zh" ? " \u4f7f\u7528\u6458\u8981" : " using summary") : null}
      </summary>
      <div className="raw-run-log-list">
        {displayEvents.length ? displayEvents.map((event, index) => (
          <div className="raw-run-log-item" key={`${event.sequence ?? index}:${event.eventType}`}>
            <strong>{runtimeRunEventTitle(event)}</strong>
            {runtimeRunEventDetail(event) ? <p>{runtimeRunEventDetail(event)}</p> : null}
          </div>
        )) : <div className="raw-run-log-item"><p>{locale === "zh" ? "\u6682\u65e0\u53ef\u5c55\u793a\u7684\u540e\u53f0\u65e5\u5fd7\u3002" : "No displayable raw events yet."}</p></div>}
      </div>
    </details>
  );
}

function QueuedInputStatus({ message, onRequestIntervention }: { message: CollaborationMessage; onRequestIntervention: (id: string) => void }) {
  const { locale } = useI18n();
  const queued = message.queuedInput;
  if (!queued) return null;
  const labels = queuedInputLabels(locale, queued.status);
  return (
    <div className="queued-input-status">
      <span>{labels.status}</span>
      {queued.status === "queued_after_run" ? (
        <button type="button" onClick={() => onRequestIntervention(queued.id)}>
          {labels.action}
        </button>
      ) : null}
    </div>
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

export function latestBudgetLimitFailure(messages: CollaborationMessage[]) {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && (message.text.trim() || message.timeline?.length));
  if (!latestAssistant) return false;
  const haystack = [
    latestAssistant.text,
    latestAssistant.statusLabel,
    ...(latestAssistant.completion?.reasons ?? []),
    ...(latestAssistant.completion?.missingRequirements ?? []),
    ...(latestAssistant.timeline ?? []).flatMap((event) => [
      event.title,
      event.summary,
      String(event.payload?.status ?? ""),
      String(event.payload?.type ?? ""),
      String(event.payload?.phase ?? ""),
      String(event.payload?.reason ?? ""),
      String(event.payload?.canResume ?? ""),
      String(event.payload?.error ?? ""),
      String(event.payload?.message ?? ""),
      String(event.payload?.finalization_retry_exhausted ?? ""),
      String(event.payload?.finalization_retry_count ?? "")
    ])
  ].join("\n");
  return /budget_exhausted|Recursion limit of \d+ reached|GRAPH_RECURSION_LIMIT|finalization_retry_exhausted|budget finalization retry|Continue finalization from gathered evidence/i.test(haystack);
}

export function agentPlanTraceTarget(events: RunTimelineEvent[] | undefined, plans: PlanRun[] = []) {
  const indexedPlans = new Map(plans.map((plan) => [plan.id, plan]));
  for (const event of [...(events ?? [])].sort((left, right) => right.sequence - left.sequence)) {
    const payload = event.payload ?? {};
    const planId = readString(payload.planId) || readString(payload.agentPlanId);
    if (!planId || !indexedPlans.has(planId)) continue;
    const plan = indexedPlans.get(planId);
    const stepId = readString(payload.stepId) || readString(payload.agentPlanStepId) || plan?.currentStepId || "";
    return { planId, stepId };
  }
  return {};
}

export type AgentClarificationPrompt = {
  clarificationId: string;
  question: string;
  options: Array<{ id: string; label: string; detail: string; recommended: boolean }>;
  resumeContext?: AgentClarificationResumeContext;
};

type AgentClarificationResumeContext = {
  originalInstruction: string;
  transientSkillRefs: string[];
  disabledSkillRefs: string[];
  runtimeResume?: {
    runtimeThreadId: string;
    runtimeRunId: string;
    interruptId: string;
    checkpointId?: string;
  };
  runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"];
  planExecution?: { planId: string; stepId: string };
  intakeState?: string;
  intakeRound?: number;
  maxIntakeRounds?: number;
  answeredSummary?: string;
  missingSlots?: string[];
  canvas: Record<string, unknown>;
};

type AgentClarificationSubmissionInput = {
  clarification: AgentClarificationPrompt;
  currentThreadId: string;
  optionId?: string;
  answerText?: string;
  enabledSkillRefs: string[];
  disabledSkillRefs: string[];
  runtimeBudgetChoice?: RuntimeBudgetChoice;
  runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"];
};

export function buildAgentClarificationSubmission(input: AgentClarificationSubmissionInput) {
  const option = input.optionId ? input.clarification.options.find((item) => item.id === input.optionId) : undefined;
  const customAnswer = (option ? "" : input.answerText ?? "").trim();
  if (!option && !customAnswer) return undefined;
  const selectedOption = option ?? {
    id: "custom",
    label: "Custom answer",
    detail: customAnswer,
    recommended: false
  };
  const resume = input.clarification.resumeContext;
  const transientSkillRefs = resume?.transientSkillRefs.length ? resume.transientSkillRefs : input.enabledSkillRefs;
  const resumeDisabledSkillRefs = resume?.disabledSkillRefs.length ? resume.disabledSkillRefs : input.disabledSkillRefs;
  const resumeRuntimeContext = resume
    ? {
      runtimeBudgetProfile: resume.runtimeBudgetProfile ?? input.runtimeBudgetChoice ?? input.runtimeBudgetProfile ?? "low",
      ...(Object.keys(sanitizeCanvasForAgentIntake(resume.canvas)).length ? { canvas: sanitizeCanvasForAgentIntake(resume.canvas) } : {})
    }
    : { runtimeBudgetProfile: input.runtimeBudgetChoice ?? input.runtimeBudgetProfile ?? "low" };
  const selectedText = option
    ? `${option.label}${option.detail ? ` - ${option.detail}` : ""}`
    : customAnswer;
  const answerValue = option ? option.label : customAnswer;
  const instructionText = resume?.originalInstruction
    ? `${resume.originalInstruction}\n\nSelected clarification: ${selectedText}`
    : selectedText;
  const answeredAt = new Date().toISOString();
  const optimisticClarification: AgentClarification = {
    id: input.clarification.clarificationId,
    threadId: input.currentThreadId,
    runId: "pending",
    status: "answered",
    question: input.clarification.question,
    options: input.clarification.options,
    ...(resume ? { resumeContext: resume } : {}),
    selectedOptionId: selectedOption.id,
    selectedOptionLabel: selectedOption.label,
    answer: answerValue,
    createdAt: answeredAt,
    updatedAt: answeredAt
  };
  return {
    instructionText,
    submittedKeys: agentClarificationSubmittedKeys(input.clarification),
    optimisticClarification,
    requestContext: {
      ...(transientSkillRefs.length ? { transientSkillRefs } : {}),
      ...(resumeDisabledSkillRefs.length ? { disabledSkillRefs: resumeDisabledSkillRefs } : {}),
      ...resumeRuntimeContext,
      ...(resume?.planExecution ? { planExecution: resume.planExecution } : {}),
      agentClarification: {
        clarificationId: input.clarification.clarificationId,
        question: input.clarification.question,
        selectedOptionId: selectedOption.id,
        answer: answerValue,
        option: selectedOption,
        ...(resume?.runtimeResume ? { requiresRuntimeResume: true } : {}),
        ...(resume ? { resumeContext: { ...resume, canvas: sanitizeCanvasForAgentIntake(resume.canvas) } } : {}),
        ...(resume?.originalInstruction ? { originalInstruction: resume.originalInstruction } : {})
      }
    }
  };
}

type PlanTimelineEntry =
  | { kind: "message"; value: CollaborationMessage }
  | { kind: "plan"; value: PlanRun };

type DrawerTimelineEntry =
  | PlanTimelineEntry
  | { kind: "agentClarification"; value: AgentClarification };

function buildAgentClarificationTimeline(entries: PlanTimelineEntry[], clarifications: AgentClarification[]): DrawerTimelineEntry[] {
  const remaining = clarifications
    .filter((clarification) => clarification.status === "answered")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const result: DrawerTimelineEntry[] = [];
  for (const entry of entries) {
    const entryTime = entry.value.createdAt;
    while (entryTime && remaining[0] && remaining[0].updatedAt <= entryTime) {
      result.push({ kind: "agentClarification", value: remaining.shift()! });
    }
    result.push(entry);
  }
  for (const clarification of remaining) result.push({ kind: "agentClarification", value: clarification });
  return result;
}

function AgentLoopRunPanel({
  completed,
  fallbackEvents,
  isStreaming,
  message,
  onFocusPlanArtifact,
  progressSegments,
  runTarget,
  traceTarget
}: {
  completed: boolean;
  fallbackEvents: RunTimelineEvent[];
  isStreaming: boolean;
  message: CollaborationMessage;
  onFocusPlanArtifact: (targetId: string) => void;
  progressSegments: ReturnType<typeof progressSegmentsForMessage>;
  runTarget?: { threadId: string; runId: string };
  traceTarget: { planId?: string; stepId?: string };
}) {
  const { locale, t } = useI18n();
  const completion = message.completion;
  const statusLabel = completion
    ? completionStatusLabel(locale, completion.status)
    : isStreaming
      ? t("workspace.preparingResponse")
      : locale === "zh" ? "运行记录" : "Run record";
  return (
    <section className="agent-loop-run" aria-label={locale === "zh" ? "Agent 运行循环" : "Agent run loop"}>
      <div className="agent-loop-run-header">
        <span>{statusLabel}</span>
        {isStreaming ? <i aria-hidden="true" /> : null}
      </div>
      {completion ? <CompletionVerdictSummary completion={completion} locale={locale} /> : null}
      {progressSegments.length ? (
        <ProgressSegmentList completed={completed} rawEvents={fallbackEvents} runTarget={runTarget} segments={progressSegments} />
      ) : (
        <>
          <AssistantRunTrace events={message.timeline} planId={traceTarget.planId} stepId={traceTarget.stepId} onFocusNode={onFocusPlanArtifact} />
          <ReasoningStreamPanel message={message} />
          <RawRunLogDetails fallbackEvents={fallbackEvents} runTarget={runTarget} />
        </>
      )}
      {isStreaming ? <StreamingStatus label={streamingStatusLabel(message, t("workspace.preparingResponse"))} /> : null}
    </section>
  );
}

function CompletionVerdictSummary({ completion, locale }: { completion: NonNullable<CollaborationMessage["completion"]>; locale: "en" | "zh" }) {
  const reason = completion.reasons[0];
  const missing = completion.missingRequirements[0];
  return (
    <div className="completion-verdict" data-status={completion.status}>
      <strong>{completionStatusLabel(locale, completion.status)}</strong>
      {reason ? <span>{reason}</span> : null}
      {missing ? <em>{missing}</em> : null}
    </div>
  );
}

function completionStatusLabel(locale: "en" | "zh", status: NonNullable<CollaborationMessage["completion"]>["status"]) {
  if (locale === "zh") {
    if (status === "completed") return "完成";
    if (status === "partial") return "部分完成";
    if (status === "waiting") return "等待用户";
    if (status === "failed") return "失败";
    if (status === "finalizing") return "最终整理";
    return "继续运行";
  }
  if (status === "completed") return "Completed";
  if (status === "partial") return "Partial";
  if (status === "waiting") return "Waiting";
  if (status === "failed") return "Failed";
  if (status === "finalizing") return "Finalizing";
  return "Continuing";
}

export function mergeAgentClarificationDisplayRecords(records: AgentClarification[], optimisticRecords: AgentClarification[]) {
  const persistedAnsweredKeys = new Set(records
    .filter((record) => record.status === "answered")
    .flatMap(agentClarificationRecordKeys));
  const optimistic = optimisticRecords.filter((record) => (
    !agentClarificationRecordKeys(record).some((key) => persistedAnsweredKeys.has(key))
  ));
  return [...records, ...optimistic];
}

export function removeSubmittedAgentClarificationKeys(current: ReadonlySet<string>, submittedKeys: string[]) {
  const next = new Set(current);
  for (const key of submittedKeys) next.delete(key);
  return next;
}

export function removeOptimisticAgentClarification(current: AgentClarification[], optimisticClarification: AgentClarification) {
  return current.filter((item) => item !== optimisticClarification);
}

export function pendingFinalSupplementForDisplay(finalSupplement: FinalSupplement | undefined, submittedIds: ReadonlySet<string>) {
  if (!finalSupplement || submittedIds.has(finalSupplement.id)) return undefined;
  return finalSupplement;
}

export function addSubmittedFinalSupplementId(current: ReadonlySet<string>, id: string) {
  return new Set([...current, id]);
}

export function removeSubmittedFinalSupplementId(current: ReadonlySet<string>, id: string) {
  const next = new Set(current);
  next.delete(id);
  return next;
}

export function appendFinalSupplementAddition(current: Record<string, string[]>, id: string, supplement: string) {
  const text = supplement.trim();
  if (!text) return current;
  return {
    ...current,
    [id]: [...(current[id] ?? []), text]
  };
}

function AgentClarificationChoiceCard({ clarification, busy, locale, variant = "message", onAnswer }: {
  clarification: AgentClarificationPrompt;
  busy: boolean;
  locale: "en" | "zh";
  variant?: "message" | "composer";
  onAnswer: (answer: { optionId?: string; customAnswer?: string }) => Promise<void>;
}) {
  const [customAnswer, setCustomAnswer] = useState("");
  const submitCustomAnswer = () => {
    const answer = customAnswer.trim();
    if (!answer) return;
    void onAnswer({ customAnswer: answer });
  };
  return (
    <section className={`plan-clarification-card plan-clarification-card-${variant}`} data-status="pending">
      <div className="plan-clarification-heading">
        <strong>{locale === "zh" ? "选择后继续" : "Choose to continue"}</strong>
        <span>{locale === "zh" ? "需要补充信息" : "Clarification needed"}</span>
      </div>
      <p>{clarification.question}</p>
      <div className="plan-clarification-options" role="group" aria-label={clarification.question}>
        {clarification.options.map((option) => (
          <button
            aria-label={`${option.label}${option.detail ? `: ${option.detail}` : ""}`}
            disabled={busy}
            key={option.id}
            onClick={() => void onAnswer({ optionId: option.id })}
            title={option.detail}
            type="button"
          >
            <span>
              <strong>{option.label}</strong>
              {option.recommended ? <em>{locale === "zh" ? "推荐" : "Recommended"}</em> : null}
              {option.detail ? <b className="plan-clarification-detail" title={option.detail}>?</b> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="plan-clarification-custom-entry">
        <label>
          <span>{locale === "zh" ? "\u81ea\u7531\u8f93\u5165" : "Custom answer"}</span>
          <textarea
            disabled={busy}
            onChange={(event) => setCustomAnswer(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitCustomAnswer();
            }}
            placeholder={locale === "zh" ? "\u8f93\u5165\u4f60\u81ea\u5df1\u7684\u7b54\u6848..." : "Type your own answer..."}
            rows={2}
            value={customAnswer}
          />
        </label>
        <button disabled={busy || !customAnswer.trim()} onClick={submitCustomAnswer} type="button">
          {locale === "zh" ? "\u63d0\u4ea4" : "Submit"}
        </button>
      </div>
    </section>
  );
}

function FinalSupplementCard({ additions, busy, locale, supplement, onAdd, onExecute }: {
  additions: string[];
  busy: boolean;
  locale: "en" | "zh";
  supplement: FinalSupplement;
  onAdd: (supplement: string) => Promise<void>;
  onExecute: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    await onAdd(text);
    setDraft("");
    setAdding(false);
  };
  return (
    <section className="plan-clarification-card plan-clarification-card-composer" data-status="pending">
      <div className="plan-clarification-heading">
        <strong>{locale === "zh" ? "\u6700\u7ec8\u786e\u8ba4" : "Final confirmation"}</strong>
        <span>{locale === "zh" ? "\u6267\u884c\u524d\u8865\u5145" : "Before execution"}</span>
      </div>
      <p>{supplement.question}</p>
      {additions.length ? (
        <div className="plan-clarification-custom-entry">
          <span>{locale === "zh" ? "\u5df2\u6dfb\u52a0\u8865\u5145" : "Added supplements"}</span>
          <ul>
            {additions.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="plan-clarification-options" role="group" aria-label={supplement.question}>
        <button disabled={busy} onClick={() => setAdding(true)} type="button">
          <span><strong>{locale === "zh" ? "\u662f\uff0c\u6211\u8981\u8865\u5145" : "Yes, I want to add something"}</strong></span>
        </button>
        <button disabled={busy} onClick={() => void onExecute()} type="button">
          <span><strong>{locale === "zh" ? "\u5426\uff0c\u8bf7\u6267\u884c\u4efb\u52a1" : "No, execute the task"}</strong></span>
        </button>
      </div>
      {adding ? (
        <div className="plan-clarification-custom-entry">
          <label>
            <span>{locale === "zh" ? "\u81ea\u7531\u8f93\u5165" : "Custom supplement"}</span>
            <textarea
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit();
              }}
              placeholder={locale === "zh" ? "\u8f93\u5165\u8981\u8865\u5145\u7684\u4fe1\u606f..." : "Type the information to add..."}
              rows={2}
              value={draft}
            />
          </label>
          <button disabled={busy || !draft.trim()} onClick={() => void submit()} type="button">
            {locale === "zh" ? "\u6dfb\u52a0\u8865\u5145" : "Add supplement"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function finalSupplementInstruction(instruction: string, additions: string[], locale: "en" | "zh") {
  const clean = additions.map((item) => item.trim()).filter(Boolean);
  if (!clean.length) return instruction;
  const heading = locale === "zh" ? "\u6700\u7ec8\u8865\u5145\uff1a" : "Final supplements:";
  return [instruction, "", heading, ...clean.map((item, index) => `${index + 1}. ${item}`)].join("\n");
}

function progressSegmentsForMessage(message: CollaborationMessage) {
  const byId = new Map<string, NonNullable<CollaborationMessage["progressSegments"]>[number]>();
  for (const segment of message.progressSegments ?? []) {
    if (segment.visibility === "raw") continue;
    byId.set(segment.id, segment);
  }
  for (const event of message.timeline ?? []) {
    if (!isProgressTimelineEvent(event)) continue;
    const segment = progressSegmentFromTimelineEvent(event);
    byId.set(segment.id, segment);
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isProgressTimelineEvent(event: RunTimelineEvent) {
  return event.payload?.kind === "progress_report" && event.payload?.visibility !== "raw";
}

function progressSegmentFromTimelineEvent(event: RunTimelineEvent): NonNullable<CollaborationMessage["progressSegments"]>[number] {
  const payload = event.payload ?? {};
  return {
    id: typeof payload.progressId === "string" ? payload.progressId : event.id,
    threadId: event.threadId,
    runId: event.runId,
    stageId: typeof payload.stageId === "string" ? payload.stageId : undefined,
    loopId: typeof payload.loopId === "string" ? payload.loopId : undefined,
    loopIndex: typeof payload.loopIndex === "number" ? payload.loopIndex : undefined,
    stepKind: readStepKind(payload.stepKind),
    actionId: typeof payload.actionId === "string" ? payload.actionId : undefined,
    observationId: typeof payload.observationId === "string" ? payload.observationId : undefined,
    completionStatus: readCompletionStatus(payload.completionStatus),
    completionReasons: readStringArray(payload.completionReasons),
    missingRequirements: readStringArray(payload.missingRequirements),
    phase: typeof payload.phase === "string" ? payload.phase : undefined,
    status: event.status,
    title: event.title,
    summary: event.summary,
    next: typeof payload.next === "string" ? payload.next : undefined,
    evidence: readProgressEvidence(payload.evidence),
    interventionHint: typeof payload.interventionHint === "string" ? payload.interventionHint : undefined,
    source: typeof payload.source === "string" ? payload.source : undefined,
    createdAt: event.createdAt
  };
}

function readStepKind(value: unknown): NonNullable<CollaborationMessage["progressSegments"]>[number]["stepKind"] | undefined {
  return value === "intake" || value === "context" || value === "decide" || value === "act" || value === "observe" || value === "evaluate" || value === "checkpoint" || value === "complete" || value === "fail"
    ? value
    : undefined;
}

function readCompletionStatus(value: unknown): NonNullable<CollaborationMessage["progressSegments"]>[number]["completionStatus"] | undefined {
  return value === "continue" || value === "waiting" || value === "finalizing" || value === "completed" || value === "partial" || value === "failed"
    ? value
    : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : undefined;
}

function rawRunLogEventsForMessage(message: CollaborationMessage) {
  return [...(message.timeline ?? [])]
    .filter((event) => !isProgressTimelineEvent(event))
    .filter((event) => !isCanvasDeliveryStartedTimelineEvent(event))
    .filter((event) => event.eventType === "tool_started" || event.eventType === "tool_completed" || event.status === "failed" || event.payload?.visibility === "raw")
    .sort((left, right) => left.sequence - right.sequence);
}

function isCanvasDeliveryStartedTimelineEvent(event: RunTimelineEvent) {
  if (event.eventType !== "tool_started") return false;
  const payloadEventType = typeof event.payload?.eventType === "string" ? event.payload.eventType : "";
  return /^canvas_delivery_.*_started$/.test(payloadEventType);
}

function runtimeRunTargetForMessage(message: CollaborationMessage, rawEvents: RunTimelineEvent[]) {
  if (message.runtimeRun?.threadId && message.runtimeRun.runId) return message.runtimeRun;
  const candidates = [
    ...(message.progressSegments ?? []).map((event) => ({ threadId: event.threadId, runId: event.runId })),
    ...rawEvents.map((event) => ({ threadId: event.threadId, runId: event.runId }))
  ].reverse();
  return candidates.find((candidate): candidate is { threadId: string; runId: string } => Boolean(candidate.threadId && candidate.runId));
}

function runtimeRunEventFromTimeline(event: RunTimelineEvent): RuntimeRunEvent {
  return {
    threadId: event.threadId,
    runId: event.runId,
    eventType: event.eventType,
    category: "timeline",
    content: event.summary,
    metadata: event.payload,
    sequence: event.sequence,
    createdAt: event.createdAt
  };
}

function runtimeRunEventTitle(event: RuntimeRunEvent) {
  const label = event.eventType.replace(/[_:.]+/g, " ").trim();
  return event.category ? `${label} / ${event.category}` : label;
}

function runtimeRunEventDetail(event: RuntimeRunEvent) {
  const content = compactRuntimeValue(event.content);
  if (content) return content;
  return compactRuntimeValue(event.metadata);
}

function compactRuntimeValue(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value) return "";
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return "";
  }
}

function queuedInputLabels(locale: string, status: NonNullable<CollaborationMessage["queuedInput"]>["status"]) {
  if (status === "intervention_requested") {
    return {
      status: locale === "zh" ? "\u5df2\u6807\u8bb0\u4ecb\u5165\uff0c\u5c06\u5728\u5b89\u5168\u70b9\u5904\u7406" : "Intervention requested; it will be handled at a safe point.",
      action: ""
    };
  }
  if (status === "sent_after_run") {
    return {
      status: locale === "zh" ? "\u5df2\u5728\u5f53\u524d\u8fd0\u884c\u540e\u53d1\u9001" : "Sent after the current run.",
      action: ""
    };
  }
  if (status === "injected") {
    return {
      status: locale === "zh" ? "\u5df2\u4ecb\u5165\u5f53\u524d\u8fd0\u884c" : "Injected into the current run.",
      action: ""
    };
  }
  return {
    status: locale === "zh" ? "\u5df2\u6392\u961f\uff0c\u5c06\u5728\u5f53\u524d\u8fd0\u884c\u540e\u5904\u7406" : "Queued; it will run after the current task.",
    action: locale === "zh" ? "\u4ecb\u5165\u5f53\u524d\u8fd0\u884c" : "Intervene current run"
  };
}

function AgentClarificationAnswerCard({ clarification, locale }: {
  clarification: AgentClarification;
  locale: "en" | "zh";
}) {
  const selectedLabel = clarification.selectedOptionLabel || clarification.answer || "";
  const selectedOption = clarification.options.find((option) => (
    option.id === clarification.selectedOptionId || option.label === selectedLabel
  ));
  return (
    <section className="plan-clarification-card plan-clarification-card-message" data-status="answered">
      <div className="plan-clarification-heading">
        <strong>{locale === "zh" ? "\u5df2\u9009\u62e9" : "Choice saved"}</strong>
        <span>{locale === "zh" ? "\u8865\u5145\u4fe1\u606f" : "Clarification answered"}</span>
      </div>
      <p>{clarification.question}</p>
      <div className="plan-clarification-options" role="group" aria-label={clarification.question}>
        {clarification.options.map((option) => {
          const selected = option.id === selectedOption?.id;
          return (
            <button
              aria-label={`${option.label}${option.detail ? `: ${option.detail}` : ""}`}
              className={selected ? "is-selected" : ""}
              disabled
              key={option.id}
              title={option.detail}
              type="button"
            >
              <span>
                <strong>{option.label}</strong>
                {selected ? <em>{locale === "zh" ? "\u5df2\u9009" : "Selected"}</em> : null}
                {option.detail ? <b className="plan-clarification-detail" title={option.detail}>?</b> : null}
              </span>
            </button>
          );
        })}
      </div>
      {!selectedOption && selectedLabel ? (
        <div className="plan-clarification-custom-answer">
          <strong>{locale === "zh" ? "\u5df2\u9009" : "Selected"}</strong>
          <small>{selectedLabel}</small>
        </div>
      ) : null}
    </section>
  );
}

export function agentClarificationFromRecord(clarification?: AgentClarification, answeredKeys: ReadonlySet<string> = new Set()): AgentClarificationPrompt | undefined {
  if (!clarification || clarification.status !== "pending" || clarification.options.length < 2) return undefined;
  if (isAgentClarificationRecordAnswered(clarification, answeredKeys)) return undefined;
  const resumeContext = readAgentClarificationResumeContext(clarification.resumeContext);
  return {
    clarificationId: clarification.id,
    question: clarification.question,
    options: clarification.options,
    ...(resumeContext ? { resumeContext } : {})
  };
}

export function latestPendingAgentClarification(messages: CollaborationMessage[], answeredKeys: ReadonlySet<string> = new Set()): AgentClarificationPrompt | undefined {
  let latestPrompt: AgentClarificationPrompt | undefined;
  for (const event of timelineEventsAfterLastUserMessage(messages)) {
    if (latestPrompt && event.status !== "waiting") latestPrompt = undefined;
    const payload = event?.payload;
    if (!payload) continue;
    const eventType = readString(payload.eventType) || readString(payload.type);
    if (eventType !== "agent_backend_agent_clarification_requested" && eventType !== "agent_clarification_requested") {
      continue;
    }
    const clarificationId = readString(payload.toolCallId) || readString(payload.clarificationId) || event.id;
    if (!clarificationId) continue;
    const question = readString(payload.question);
    const options = readClarificationOptions(payload.options);
    const resumeContext = readAgentClarificationResumeContext(payload.resumeContext);
    if (question && options.length >= 2) {
      const prompt = { clarificationId, question, options, ...(resumeContext ? { resumeContext } : {}) };
      latestPrompt = isAgentClarificationPromptAnswered(prompt, answeredKeys) ? undefined : prompt;
    } else {
      latestPrompt = undefined;
    }
  }
  return latestPrompt;
}

export function hasUnresolvedAgentClarificationTrace(messages: CollaborationMessage[], answeredKeys: ReadonlySet<string> = new Set()) {
  let unresolved = false;
  for (const event of timelineEventsAfterLastUserMessage(messages)) {
    if (event.status !== "waiting") {
      if (unresolved) unresolved = false;
      continue;
    }
    const payload = readRecord(event.payload);
    const eventType = readString(payload.eventType) || readString(payload.type);
    if (eventType !== "agent_backend_agent_clarification_requested" && eventType !== "agent_clarification_requested") continue;
    const clarificationId = readString(payload.toolCallId) || readString(payload.clarificationId) || event.id;
    const question = readString(payload.question);
    const options = readClarificationOptions(payload.options);
    unresolved = Boolean(question && options.length < 2 && !agentClarificationTraceKeys(clarificationId, question, options).some((key) => answeredKeys.has(key)));
  }
  return unresolved;
}

function timelineEventsAfterLastUserMessage(messages: CollaborationMessage[]) {
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      startIndex = index + 1;
      break;
    }
  }
  return messages.slice(startIndex).flatMap((message) => message.timeline ?? []);
}

function readClarificationOptions(value: unknown): AgentClarificationPrompt["options"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = readString(record.label);
    if (!label) return [];
    return [{
      id: readString(record.id) || `option_${index + 1}`,
      label,
      detail: readString(record.detail) || readString(record.description),
      recommended: record.recommended === true
    }];
  }).slice(0, 3);
}

function readString(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^(?:undefined|null|none|nan)$/i.test(text) ? "" : text;
}

export function agentClarificationRecordKeys(clarification: AgentClarification) {
  return agentClarificationKeys(clarification.id, clarification.question, clarification.options);
}

export function agentClarificationAnsweredKeys(clarification: AgentClarification) {
  return agentClarificationTraceKeys(clarification.id, clarification.question, clarification.options);
}

function agentClarificationPromptKeys(clarification: AgentClarificationPrompt) {
  return agentClarificationKeys(clarification.clarificationId, clarification.question, clarification.options);
}

function agentClarificationSubmittedKeys(clarification: AgentClarificationPrompt) {
  return agentClarificationTraceKeys(clarification.clarificationId, clarification.question, clarification.options);
}

function isAgentClarificationRecordAnswered(clarification: AgentClarification, answeredKeys: ReadonlySet<string>) {
  return agentClarificationRecordKeys(clarification).some((key) => answeredKeys.has(key));
}

function isAgentClarificationPromptAnswered(clarification: AgentClarificationPrompt, answeredKeys: ReadonlySet<string>) {
  return agentClarificationPromptKeys(clarification).some((key) => answeredKeys.has(key));
}

function agentClarificationKeys(id: string, question: string, options: Array<{ id: string; label: string }>) {
  const keys = [];
  const normalizedId = id.trim();
  if (normalizedId) keys.push(`id:${normalizedId}`);
  const fingerprint = agentClarificationFingerprint(question, options);
  if (fingerprint) keys.push(`fingerprint:${fingerprint}`);
  return keys;
}

function agentClarificationTraceKeys(id: string, question: string, options: Array<{ id: string; label: string }>) {
  const keys = agentClarificationKeys(id, question, options);
  const questionKey = agentClarificationQuestionKey(question);
  if (questionKey) keys.push(questionKey);
  return keys;
}

function agentClarificationFingerprint(question: string, options: Array<{ id: string; label: string }>) {
  const normalizedQuestion = question.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalizedQuestion) return "";
  const optionSignature = options.map((option) => `${option.id.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`).join("|");
  return `${normalizedQuestion}|${optionSignature}`;
}

function agentClarificationQuestionKey(question: string) {
  const normalizedQuestion = question.trim().replace(/\s+/g, " ").toLowerCase();
  return normalizedQuestion ? `question:${normalizedQuestion}` : "";
}

function readAgentClarificationResumeContext(value: unknown): AgentClarificationResumeContext | undefined {
  const record = readRecord(value);
  const originalInstruction = readString(record.originalInstruction);
  const transientSkillRefs = readStringList(record.transientSkillRefs);
  const disabledSkillRefs = readStringList(record.disabledSkillRefs);
  const runtimeResume = readAgentClarificationRuntimeResume(record.runtimeResume);
  const runtimeBudgetProfile = readRuntimeBudgetProfile(record.runtimeBudgetProfile);
  const planExecution = readAgentClarificationPlanExecution(record.planExecution);
  const intakeState = readString(record.intakeState);
  const intakeRound = readPositiveInteger(record.intakeRound);
  const maxIntakeRounds = readPositiveInteger(record.maxIntakeRounds);
  const answeredSummary = readString(record.answeredSummary);
  const missingSlots = readStringList(record.missingSlots);
  const canvas = readRecord(record.canvas);
  if (!originalInstruction && transientSkillRefs.length === 0 && disabledSkillRefs.length === 0 && !runtimeResume && !runtimeBudgetProfile && !planExecution && !intakeState && !intakeRound && !maxIntakeRounds && !answeredSummary && missingSlots.length === 0 && Object.keys(canvas).length === 0) {
    return undefined;
  }
  return {
    originalInstruction,
    transientSkillRefs,
    disabledSkillRefs,
    ...(runtimeResume ? { runtimeResume } : {}),
    ...(runtimeBudgetProfile ? { runtimeBudgetProfile } : {}),
    ...(planExecution ? { planExecution } : {}),
    ...(intakeState ? { intakeState } : {}),
    ...(intakeRound ? { intakeRound } : {}),
    ...(maxIntakeRounds ? { maxIntakeRounds } : {}),
    ...(answeredSummary ? { answeredSummary } : {}),
    ...(missingSlots.length ? { missingSlots } : {}),
    canvas
  };
}

function readAgentClarificationPlanExecution(value: unknown): AgentClarificationResumeContext["planExecution"] {
  const record = readRecord(value);
  const planId = readString(record.planId);
  const stepId = readString(record.stepId);
  return planId && stepId ? { planId, stepId } : undefined;
}

function readAgentClarificationRuntimeResume(value: unknown): AgentClarificationResumeContext["runtimeResume"] {
  const record = readRecord(value);
  const runtimeThreadId = readString(record.runtimeThreadId);
  const runtimeRunId = readString(record.runtimeRunId);
  const interruptId = readString(record.interruptId);
  const checkpointId = readString(record.checkpointId);
  if (!runtimeThreadId || !runtimeRunId || !interruptId) return undefined;
  return {
    runtimeThreadId,
    runtimeRunId,
    interruptId,
    ...(checkpointId ? { checkpointId } : {})
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringList(value: unknown) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readRuntimeBudgetProfile(value: unknown): GenerateRequest["runtimeBudgetProfile"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function isAgentClarificationRequired(value: unknown) {
  return readRecord(value).finishReason === "clarification_required";
}

function isFailedSendResult(value: unknown) {
  return readRecord(value).ok === false;
}

function isWriteConfirmation(text: string) {
  return /^(?:是|好|生成节点|yes|\u5199\u5165|\u5199\u5165\u5168\u90e8|\u76f4\u63a5\u5199\u5165|\u786e\u8ba4\u5199\u5165|\u786e\u8ba4|\u4fdd\u5b58|\u4fdd\u5b58\u5230\u753b\u677f|\u52a0\u5165\u753b\u677f|\u4fdd\u5b58\u5230\s*canvas|\u52a0\u5165\s*canvas|save\s+to\s+canvas|write\s+this|write\s+it|write|write\s+all)$/i.test(text.trim());
}

function modelSettingsToThinkingChoice(modelSettings?: ConversationModelControls): ThinkingChoice {
  if (!isThinkingSupportedModel(modelSettings) || modelSettings?.thinkingMode !== "enabled") return "disabled";
  return modelSettings.reasoningEffort === "max" || modelSettings.reasoningEffort === "xhigh" ? "max" : "high";
}

function readProgressEvidence(value: unknown): NonNullable<CollaborationMessage["progressSegments"]>[number]["evidence"] {
  if (!Array.isArray(value)) return undefined;
  const evidence = value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ kind: "runtime" as const, label: item.trim().slice(0, 120) }];
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const kind = readProgressEvidenceKind(source.kind);
    const label = typeof source.label === "string" ? source.label.trim().slice(0, 120) : "";
    const ref = typeof source.ref === "string" ? source.ref.trim().slice(0, 160) : "";
    return kind && label ? [{ kind, label, ...(ref ? { ref } : {}) }] : [];
  }).slice(0, 5);
  return evidence.length ? evidence : undefined;
}

function readProgressEvidenceKind(value: unknown): NonNullable<NonNullable<CollaborationMessage["progressSegments"]>[number]["evidence"]>[number]["kind"] | undefined {
  return value === "tool" || value === "subagent" || value === "codegraph" || value === "search" || value === "file" || value === "runtime"
    ? value
    : undefined;
}

function progressEvidenceLabel(item: NonNullable<NonNullable<CollaborationMessage["progressSegments"]>[number]["evidence"]>[number]) {
  return `${item.kind}: ${item.label}`;
}

function thinkingOverridesFromChoice(choice: ThinkingChoice): GenerateRequest["modelOverrides"] {
  if (choice === "disabled") return { thinkingMode: "disabled" };
  return { thinkingMode: "enabled", reasoningEffort: choice };
}

