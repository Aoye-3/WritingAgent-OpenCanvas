import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Bold, Italic, Link } from "lucide-react";
import type { CanvasNode, CanvasWriteRequest } from "../../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../../canvas/canvasClient";
import { applyMarkdownFormat } from "../../../../../../shared/canvasRangeEdit";
import { SourceMarkdownText } from "./SourceMarkdownText";
import type { CanvasLocale } from "../types";
import { getAutoNodeHeight, hasManualCanvasSize } from "../nodeLayout";

type SelectionState = { start: number; end: number; text: string; rect: DOMRect };

type CollaborativeDocumentNodeProps = {
  agentCardId?: string;
  isSelected: boolean;
  isResizing: boolean;
  locale: CanvasLocale;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  node: CanvasNode;
  pendingRequest?: CanvasWriteRequest;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function CollaborativeDocumentNode(props: CollaborativeDocumentNodeProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState(props.node.title);
  const [content, setContent] = useState(props.node.content);
  const [editing, setEditing] = useState<"title" | "content" | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [instruction, setInstruction] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [href, setHref] = useState("https://");
  const [submitting, setSubmitting] = useState(false);
  const [localRequest, setLocalRequest] = useState<CanvasWriteRequest | undefined>();
  const [error, setError] = useState("");
  const request = props.pendingRequest ?? localRequest;

  useEffect(() => setTitle(props.node.title), [props.node.title]);
  useEffect(() => setContent(props.node.content), [props.node.content]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || props.isResizing || hasManualCanvasSize(props.node.metadata)) return;
    const nextHeight = getAutoNodeHeight(props.node.kind, body.scrollHeight);
    if (nextHeight > props.node.height + 12) void props.onUpdateNode(props.node.id, { height: nextHeight });
  }, [props.isResizing, props.node.content, props.node.height, props.node.id, props.node.kind, props.node.metadata, props.onUpdateNode, request?.id]);
  useEffect(() => {
    if (!props.pendingRequest && localRequest?.status !== "pending") setLocalRequest(undefined);
  }, [localRequest?.status, props.pendingRequest]);

  const readSelection = () => {
    if (!props.isSelected || editing || request) return;
    const active = window.getSelection();
    if (!active || active.isCollapsed || active.rangeCount === 0) return setSelection(null);
    const range = active.getRangeAt(0);
    if (!bodyRef.current?.contains(range.commonAncestorContainer)) return setSelection(null);
    const start = sourcePoint(range.startContainer, range.startOffset);
    const end = sourcePoint(range.endContainer, range.endOffset);
    if (!start || !end || start.token !== end.token || start.paragraph !== end.paragraph) return setSelection(null);
    const rangeStart = Math.min(start.offset, end.offset);
    const rangeEnd = Math.max(start.offset, end.offset);
    if (rangeEnd <= rangeStart) return setSelection(null);
    setSelection({ start: rangeStart, end: rangeEnd, text: props.node.content.slice(rangeStart, rangeEnd), rect: range.getBoundingClientRect() });
    setError("");
  };

  const applyFormat = async (format: "bold" | "italic" | "link") => {
    if (!selection) return;
    try {
      const next = applyMarkdownFormat(props.node.content, selection.start, selection.end, format, format === "link" ? href : undefined);
      await props.onUpdateNode(props.node.id, { content: next });
      setSelection(null);
      clearSelection();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to format selection");
    }
  };

  const requestRewrite = async () => {
    if (!selection || !instruction.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const next = await props.onRequestRangeRewrite({
        nodeId: props.node.id,
        rangeStart: selection.start,
        rangeEnd: selection.end,
        originalText: selection.text,
        instruction: instruction.trim(),
        locale: props.locale,
        agentCardId: props.agentCardId,
        modelOverrides: props.modelOverrides
      });
      setLocalRequest(next);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to rewrite selection");
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async () => {
    if (!request) return;
    const result = await props.onApproveWriteRequest(request.id);
    setLocalRequest(undefined);
    if (result.request.status === "stale") setError(props.locale === "zh" ? "原文已变化，请重新选择后再试。" : "The source changed. Select it again and retry.");
  };

  const reject = async () => {
    if (!request) return;
    await props.onRejectWriteRequest(request.id);
    setLocalRequest(undefined);
  };

  return (
    <div className="canvas-text-node-body collaborative-document-node">
      {editing === "title" ? <input
        autoFocus className="canvas-node-title nodrag" data-testid="canvas-node-title" value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onBlur={() => { if (title !== props.node.title) void props.onUpdateNode(props.node.id, { title }); setEditing(null); }}
      /> : <div className="canvas-node-title canvas-node-readonly" data-testid="canvas-node-title" onClick={() => { if (props.isSelected) setEditing("title"); }}>{title}</div>}

      {editing === "content" ? <textarea
        autoFocus className="canvas-node-content nodrag nowheel" data-testid="canvas-node-content" value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        onBlur={() => { if (content !== props.node.content) void props.onUpdateNode(props.node.id, { content }); setEditing(null); }}
      /> : <div
        className="canvas-node-content canvas-node-readonly collaborative-document-content nowheel"
        data-testid="canvas-node-content"
        ref={bodyRef}
        onClick={() => {
          if (!props.isSelected || request) return;
          setEditing("content");
        }}
        onMouseUp={props.isSelected ? readSelection : undefined}
      >
        {request?.operation === "replace_range" ? <div className="canvas-range-proposal-shell">
          <ProposalActions locale={props.locale} onApprove={() => void approve()} onReject={() => void reject()} />
          <RangeProposal content={props.node.content} request={request} />
        </div> : <SourceMarkdownText linksEnabled={false} text={props.node.content} />}
      </div>}

      {error ? <div className="canvas-range-error nodrag">{error}</div> : null}
      {selection ? createPortal(<SelectionToolbar
        href={href} instruction={instruction} linkMode={linkMode} locale={props.locale} rect={selection.rect} submitting={submitting}
        onBold={() => void applyFormat("bold")} onHrefChange={setHref} onInstructionChange={setInstruction}
        onItalic={() => void applyFormat("italic")} onLink={() => linkMode ? void applyFormat("link") : setLinkMode(true)}
        onSubmit={() => void requestRewrite()}
      />, document.body) : null}
    </div>
  );
}

function RangeProposal({ content, request }: { content: string; request: CanvasWriteRequest }) {
  const start = request.rangeStart ?? 0;
  const end = request.rangeEnd ?? start;
  return <div className="canvas-range-proposal-text">
    <span>{content.slice(0, start)}</span>
    <del data-range-request-id={request.id}>{content.slice(start, end)}</del>
    <ins>{request.content}</ins>
    <span>{content.slice(end)}</span>
  </div>;
}

function SelectionToolbar(props: {
  href: string; instruction: string; linkMode: boolean; locale: CanvasLocale; rect: DOMRect; submitting: boolean;
  onBold: () => void; onHrefChange: (value: string) => void; onInstructionChange: (value: string) => void;
  onItalic: () => void; onLink: () => void; onSubmit: () => void;
}) {
  const style = { left: Math.max(12, Math.min(window.innerWidth - 390, props.rect.left + props.rect.width / 2 - 190)), top: Math.max(12, props.rect.top - 54) };
  return <div className="canvas-selection-toolbar nodrag" style={style}>
    <span className="canvas-selection-ai-badge">AI</span>
    {props.linkMode ? <input autoFocus aria-label="Link URL" className="canvas-selection-link-input" value={props.href} onChange={(event) => props.onHrefChange(event.currentTarget.value)} /> : <input autoFocus
      aria-label={props.locale === "zh" ? "描述更改" : "Describe change"} className="canvas-selection-instruction"
      placeholder={props.locale === "zh" ? "描述更改" : "Describe change"} value={props.instruction}
      onChange={(event) => props.onInstructionChange(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmit(); }}
    />}
    <button aria-label="Bold" type="button" onClick={props.onBold}><Bold size={16} /></button>
    <button aria-label="Italic" type="button" onClick={props.onItalic}><Italic size={16} /></button>
    <button aria-label="Link" type="button" onClick={props.onLink}><Link size={16} /></button>
    <button aria-label={props.locale === "zh" ? "提交更改" : "Submit change"} className="is-primary" disabled={props.submitting || (!props.linkMode && !props.instruction.trim())} type="button" onClick={props.linkMode ? props.onLink : props.onSubmit}><ArrowUp size={16} /></button>
  </div>;
}

function ProposalActions({ locale, onApprove, onReject }: { locale: CanvasLocale; onApprove: () => void; onReject: () => void }) {
  return <div className="canvas-range-proposal-actions">
    <button type="button" onClick={onReject}>{locale === "zh" ? "撤销" : "Cancel"}</button>
    <button className="is-primary" type="button" onClick={onApprove}>{locale === "zh" ? "接受" : "Accept"}</button>
  </div>;
}

function sourcePoint(node: Node, localOffset: number) {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  const span = element?.closest<HTMLElement>("[data-source-start][data-source-token]");
  if (!span) return null;
  const sourceStart = Number(span.dataset.sourceStart);
  const offset = node.nodeType === Node.TEXT_NODE ? localOffset : Math.min(localOffset, span.textContent?.length ?? 0);
  return { offset: sourceStart + offset, paragraph: span.dataset.sourceParagraph, token: span.dataset.sourceToken };
}

function clearSelection() {
  window.getSelection()?.removeAllRanges();
}
