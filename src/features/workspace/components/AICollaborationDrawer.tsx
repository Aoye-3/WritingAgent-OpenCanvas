import { FormEvent, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SendIcon } from "../../../shared/icons";
import { MarkdownText } from "../../../shared/MarkdownText";
import type { CanvasWriteRequest, StoredToolEvent } from "../../agents/types";
import type { AgentSettings } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import { ToolEventDrawer } from "./ToolEventDrawer";

type ToolKey = NonNullable<GenerateRequest["toolState"]> extends Partial<Record<infer Key, boolean>> ? Key : never;

type AICollaborationDrawerProps = {
  allowedTools: string[];
  canvasWriteRequests: CanvasWriteRequest[];
  collapsed: boolean;
  messages: CollaborationMessage[];
  isSending: boolean;
  modelSettings?: AgentSettings["model"];
  toolEvents: StoredToolEvent[];
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onRequestWriteMessage: (text: string) => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => Promise<void>;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  toolState: GenerateRequest["toolState"];
};

const toolMeta: Record<string, { en: string; zh: string; icon: string; hint: string }> = {
  web_search: { en: "Web search", zh: "联网搜索", icon: "⌁", hint: "Web search intent only" },
  knowledge_base: { en: "Knowledge base", zh: "知识库引用", icon: "◫", hint: "Use selected knowledge hints" },
  quick_messages: { en: "Quick message", zh: "快捷消息", icon: "⚡", hint: "Treat input as a quick editing command" },
  clear_context: { en: "Clear context", zh: "清除上下文", icon: "⌫", hint: "Ignore previous conversational context" }
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
  onRejectWriteRequest,
  onRequestWriteMessage,
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

  useEffect(() => {
    setThinkEnabled(modelSettings?.thinkingMode === "enabled");
    setReasoningEffort(modelSettings?.reasoningEffort ?? "high");
  }, [modelSettings?.providerId, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await onSend(text, supportsThinking ? {
      thinkingMode: thinkEnabled ? "enabled" : "disabled",
      reasoningEffort
    } : undefined);
  };

  if (collapsed) {
    return (
      <aside className="ai-drawer ai-drawer-collapsed" aria-label="AI collaboration drawer collapsed">
        <button className="drawer-rail drawer-rail-right" type="button" onClick={onToggleCollapsed} aria-label={locale === "zh" ? "展开 AI 协作层" : "Expand AI collaboration"}>
          <span>AI</span>
          <small>{messages.length}</small>
          <b>‹</b>
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
        title={locale === "zh" ? "向左拖拽扩大 AI 协作层" : "Drag left to expand AI collaboration"}
      />
      <div className="ai-drawer-header">
        <div>
          <p className="eyebrow">{locale === "zh" ? "AI 协作层" : "AI Collaboration"}</p>
          <h2>{locale === "zh" ? "对话与修改建议" : "Chat and revision support"}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onToggleCollapsed} aria-label={locale === "zh" ? "收起右侧栏" : "Collapse right drawer"}>
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="drawer-message-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-chat-state">
            {locale === "zh" ? "在这里追问、要求改写，或让 Agent 解释本次生成。" : "Ask follow-ups, request rewrites, or have the agent explain the current draft."}
          </div>
        ) : null}
        {messages.map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "U" : "F"}</div>
            <div className="message-bubble">
              {message.role === "assistant" ? <MarkdownText text={message.text} /> : <p>{message.text}</p>}
              {message.role === "assistant" && message.text.trim() ? (
                <WriteMessageButton onWrite={() => onRequestWriteMessage(message.text)} />
              ) : null}
              {message.usedMock ? <span className="message-meta">{locale === "zh" ? "Mock 兜底" : "Mock fallback"}</span> : null}
            </div>
          </article>
        ))}
        {canvasWriteRequests.map((request) => (
          <CanvasWriteRequestCard
            key={request.id}
            request={request}
            onApprove={() => onApproveWriteRequest(request.id)}
            onReject={() => onRejectWriteRequest(request.id)}
          />
        ))}
      </div>

      <form className="drawer-chat-composer" onSubmit={submit}>
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
          <button className="button button-primary chat-send" type="submit" disabled={isSending}>
            <SendIcon />
            {isSending ? (locale === "zh" ? "发送中" : "Sending") : (locale === "zh" ? "发送" : "Send")}
          </button>
        </div>
      </form>

      <ToolEventDrawer events={toolEvents} />
    </aside>
  );
}

function WriteMessageButton({ onWrite }: { onWrite: () => Promise<void> }) {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);

  const act = async () => {
    setBusy(true);
    try {
      await onWrite();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="button button-secondary button-small message-write-button" type="button" disabled={busy} onClick={() => void act()}>
      {busy ? (locale === "zh" ? "创建中" : "Creating") : (locale === "zh" ? "写入画板" : "Write to canvas")}
    </button>
  );
}

function CanvasWriteRequestCard({ request, onApprove, onReject }: { request: CanvasWriteRequest; onApprove: () => Promise<void>; onReject: () => Promise<void> }) {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const operation = locale === "zh" ? ({ create: "创建", replace: "替换", append: "追加" }[request.operation]) : request.operation;
  const kind = locale === "zh" ? ({ document: "文档", note: "便签", reference: "引用卡" }[request.nodeKind]) : request.nodeKind;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="canvas-write-card">
      <div className="canvas-write-card-header">
        <span>{locale === "zh" ? "Canvas 写入申请" : "Canvas write request"}</span>
        <b>{operation} · {kind}</b>
      </div>
      <h3>{request.title}</h3>
      {request.rationale ? <p className="canvas-write-rationale">{request.rationale}</p> : null}
      <pre>{request.content}</pre>
      <div className="canvas-write-actions">
        <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void act(onReject)}>
          {locale === "zh" ? "拒绝" : "Reject"}
        </button>
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void act(onApprove)}>
          {locale === "zh" ? "批准写入" : "Approve"}
        </button>
      </div>
    </article>
  );
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
