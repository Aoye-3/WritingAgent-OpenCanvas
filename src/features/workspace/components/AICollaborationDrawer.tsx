import { FormEvent, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SendIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import type { CanvasWriteRequest, StoredToolEvent } from "../../agents/types";
import type { AgentSettings } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import { AnnotationChipRow, CanvasWriteProposalPanel, type MessageAnnotation } from "./CanvasWriteProposalPanel";
import { ToolEventDrawer } from "./ToolEventDrawer";

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

type AICollaborationDrawerProps = {
  allowedTools: string[];
  canvasWriteRequests: CanvasWriteRequest[];
  collapsed: boolean;
  messages: CollaborationMessage[];
  isSending: boolean;
  modelSettings?: AgentSettings["model"];
  toolEvents: StoredToolEvent[];
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => Promise<void>;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  toolState: GenerateRequest["toolState"];
};

const toolMeta: Record<string, { en: string; zh: string; icon: string; hint: string }> = {
  web_search: { en: "Web search", zh: "联网搜索", icon: "W", hint: "Web search intent only" },
  knowledge_base: { en: "Knowledge base", zh: "知识库引用", icon: "K", hint: "Use selected knowledge hints" },
  quick_messages: { en: "Quick message", zh: "快捷消息", icon: "Q", hint: "Treat input as a quick editing command" },
  clear_context: { en: "Clear context", zh: "清除上下文", icon: "C", hint: "Ignore previous conversational context" }
};

export function AICollaborationDrawer({
  allowedTools,
  canvasWriteRequests,
  collapsed,
  messages,
  isSending,
  modelSettings,
  toolEvents,
  onApproveWriteRequest,
  onApplyWriteText,
  onRejectWriteRequest,
  onResizeStart,
  onSend,
  onToggleCollapsed,
  onToolStateChange,
  toolState
}: AICollaborationDrawerProps) {
  const { locale } = useI18n();
  const [input, setInput] = useState("");
  const supportsThinking = modelSettings?.providerId === "deepseek";
  const [thinkEnabled, setThinkEnabled] = useState(modelSettings?.thinkingMode === "enabled");
  const [reasoningEffort, setReasoningEffort] = useState<NonNullable<GenerateRequest["modelOverrides"]>["reasoningEffort"]>(modelSettings?.reasoningEffort ?? "high");
  const [annotations, setAnnotations] = useState<MessageAnnotation[]>([]);
  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeStatus, setWriteStatus] = useState("");

  const pendingWriteRequest = canvasWriteRequests[0];
  const lastAssistantText = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text ?? "", [messages]);
  const proposalFullText = writeDraft?.text || pendingWriteRequest?.content || lastAssistantText;
  const annotatedText = annotations.map((annotation) => annotation.text).join("\n\n");
  const hasWriteProposal = Boolean(writeDraft || pendingWriteRequest || annotations.length);

  useEffect(() => {
    setThinkEnabled(modelSettings?.thinkingMode === "enabled");
    setReasoningEffort(modelSettings?.reasoningEffort ?? "high");
  }, [modelSettings?.providerId, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

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
      await applyWrite(annotations.length ? "snippets" : "default", hasWriteProposal ? undefined : lastAssistantText);
      return;
    }
    await onSend(text, supportsThinking ? {
      thinkingMode: thinkEnabled ? "enabled" : "disabled",
      reasoningEffort
    } : undefined);
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

  const startMessageWrite = (message: CollaborationMessage) => {
    setWriteDraft({ messageId: message.id, text: message.text });
    setWriteStatus("");
  };

  if (collapsed) {
    return (
      <aside className="ai-drawer ai-drawer-collapsed" aria-label="AI collaboration drawer collapsed">
        <button className="drawer-rail drawer-rail-right" type="button" onClick={onToggleCollapsed} aria-label={locale === "zh" ? "展开 AI 协作层" : "Expand AI collaboration"}>
          <span>AI</span>
          <small>{messages.length}</small>
          <b>&lt;</b>
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-drawer" aria-label="AI collaboration drawer">
      <div
        aria-label={locale === "zh" ? "调整 AI 协作层宽度" : "Resize AI collaboration drawer"}
        aria-orientation="vertical"
        className="ai-drawer-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={0}
        title={locale === "zh" ? "向左拖动扩大 AI 协作层" : "Drag left to expand AI collaboration"}
      />
      <div className="ai-drawer-header">
        <div>
          <p className="eyebrow">{locale === "zh" ? "AI 协作层" : "AI Collaboration"}</p>
          <h2>{locale === "zh" ? "对话与修改建议" : "Chat and revision support"}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onToggleCollapsed} aria-label={locale === "zh" ? "收起右侧栏" : "Collapse right drawer"}>
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>

      <div className="drawer-message-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-chat-state">
            {locale === "zh" ? "在这里追问、要求改写，或让 Agent 解释本次生成。" : "Ask follow-ups, request rewrites, or have the agent explain the current draft."}
          </div>
        ) : null}
        {messages.map((message) => {
          const messageAnnotations = annotations.filter((annotation) => annotation.messageId === message.id);
          return (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "U" : "F"}</div>
              <div className="message-bubble">
                {message.role === "assistant" ? (
                  <div className="assistant-selectable-text" onMouseUp={(event) => captureSelection(event, message)}>
                    <MarkdownText text={message.text} highlights={messageAnnotations.map((annotation) => annotation.text)} />
                  </div>
                ) : <p>{message.text}</p>}
                {message.role === "assistant" && message.text.trim() ? (
                  <WriteMessageButton onWrite={() => startMessageWrite(message)} />
                ) : null}
                {message.usedMock ? <span className="message-meta">{locale === "zh" ? "Mock 兜底" : "Mock fallback"}</span> : null}
              </div>
            </article>
          );
        })}
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

      <form className="drawer-chat-composer" onSubmit={submit}>
        <AnnotationChipRow annotations={annotations} compact onRemoveAnnotation={removeAnnotation} />
        <textarea
          aria-label="AI collaboration message"
          placeholder={locale === "zh" ? "让 AI 协作修改当前草稿..." : "Ask AI to collaborate on this draft..."}
          rows={3}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <div className="composer-tool-row">
          <ToolUseIconBar allowedTools={allowedTools} toolState={toolState} onToolStateChange={onToolStateChange} />
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
          <button className="button button-primary chat-send" type="submit" disabled={isSending || writeBusy}>
            <SendIcon />
            {isSending ? (locale === "zh" ? "发送中" : "Sending") : (locale === "zh" ? "发送" : "Send")}
          </button>
        </div>
      </form>

      <ToolEventDrawer events={toolEvents} />
    </aside>
  );
}

function WriteMessageButton({ onWrite }: { onWrite: () => void }) {
  const { locale } = useI18n();
  return (
    <button className="button button-secondary button-small message-write-button" type="button" onClick={onWrite}>
      {locale === "zh" ? "写入画板" : "Write to canvas"}
    </button>
  );
}

function isWriteConfirmation(text: string) {
  return /^(写入|写入全部|直接写入|确认写入|确认|保存|保存到画板|加入画板|保存到\s*canvas|加入\s*canvas|save\s+to\s+canvas|write\s+this|write\s+it|write|write\s+all)$/i.test(text.trim());
}

function ToolUseIconBar({ allowedTools, toolState, onToolStateChange }: Pick<AICollaborationDrawerProps, "allowedTools" | "toolState" | "onToolStateChange">) {
  const { locale } = useI18n();
  const visibleTools = allowedTools.filter((tool) => tool !== "canvas_write");
  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="composer-tool-icons" aria-label="ToolUse">
      {visibleTools.map((tool) => {
        const active = Boolean(toolState?.[tool as ToolKey]);
        const meta = toolMeta[tool] ?? { en: tool, zh: tool, icon: tool.slice(0, 1).toUpperCase(), hint: tool };
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
            <span aria-hidden="true">{meta.icon}</span>
            {active ? <i aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
