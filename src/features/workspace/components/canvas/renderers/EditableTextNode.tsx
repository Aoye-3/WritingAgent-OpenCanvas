import { useEffect, useRef, useState } from "react";
import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import { getAutoNodeHeight, hasManualCanvasSize } from "../nodeLayout";
import type { CanvasLocale } from "../types";
import { SourceMarkdownText } from "./SourceMarkdownText";

type EditableTextNodeProps = {
  isSelected: boolean;
  isResizing: boolean;
  linksEnabled?: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function EditableTextNode({ isSelected, isResizing, linksEnabled = false, locale, node, onUpdateNode }: EditableTextNodeProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);
  const [editing, setEditing] = useState<"title" | "content" | null>(null);

  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setContent(node.content), [node.content]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (content !== node.content || isResizing || hasManualCanvasSize(node.metadata)) return;
    const previousHeight = textarea.style.height;
    textarea.style.height = "0px";
    const nextHeight = getAutoNodeHeight(node.kind, textarea.scrollHeight);
    textarea.style.height = previousHeight;
    if (nextHeight > node.height + 12) {
      void onUpdateNode(node.id, { height: nextHeight });
    }
  }, [content, isResizing, node.content, node.height, node.id, node.kind, node.metadata, onUpdateNode]);

  return (
    <div className="canvas-text-node-body">
      {editing === "title" ? <input
        autoFocus
        className="canvas-node-title nodrag"
        data-testid="canvas-node-title"
        onBlur={() => {
          if (title !== node.title) void onUpdateNode(node.id, { title });
          setEditing(null);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        onChange={(event) => setTitle(event.currentTarget.value)}
        value={title}
      /> : <div className="canvas-node-title canvas-node-readonly" data-testid="canvas-node-title" onClick={() => { if (isSelected) setEditing("title"); }}>{title}</div>}
      {editing === "content" ? <textarea
        autoFocus
        className="canvas-node-content nodrag nowheel"
        data-testid="canvas-node-content"
        ref={textareaRef}
        value={content}
        placeholder={locale === "zh" ? "在这里编辑节点内容..." : "Edit node content..."}
        onBlur={() => {
          if (content !== node.content) void onUpdateNode(node.id, { content });
          setEditing(null);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        onChange={(event) => setContent(event.currentTarget.value)}
      /> : <div className="canvas-node-content canvas-node-readonly" data-testid="canvas-node-content" onClick={() => { if (isSelected) setEditing("content"); }}>
        {content ? <SourceMarkdownText linksEnabled={linksEnabled} text={content} /> : (locale === "zh" ? "再次点击编辑内容" : "Click again to edit content")}
      </div>}
    </div>
  );
}
