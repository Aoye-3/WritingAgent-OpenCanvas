import { useEffect, useState } from "react";
import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale } from "../types";

type DiagramNodeRendererProps = {
  isSelected: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function DiagramNodeRenderer({ isSelected, locale, node, onUpdateNode }: DiagramNodeRendererProps) {
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);
  const [editing, setEditing] = useState<"title" | "content" | null>(null);

  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setContent(node.content), [node.content]);

  return (
    <div className="canvas-diagram-node-body">
      {editing === "title" ? (
        <input
          autoFocus
          className="canvas-diagram-node-title nodrag"
          data-testid="canvas-diagram-node-title"
          value={title}
          onBlur={() => {
            if (title !== node.title) void onUpdateNode(node.id, { title });
            setEditing(null);
          }}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        />
      ) : (
        <button
          className="canvas-diagram-node-title nodrag"
          data-testid="canvas-diagram-node-title"
          type="button"
          onClick={() => { if (isSelected) setEditing("title"); }}
        >
          {title}
        </button>
      )}
      {editing === "content" ? (
        <textarea
          autoFocus
          className="canvas-diagram-node-content nodrag nowheel"
          data-testid="canvas-diagram-node-content"
          value={content}
          placeholder={locale === "zh" ? "编辑说明..." : "Edit detail..."}
          onBlur={() => {
            if (content !== node.content) void onUpdateNode(node.id, { content });
            setEditing(null);
          }}
          onChange={(event) => setContent(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        />
      ) : content ? (
        <button
          className="canvas-diagram-node-content nodrag"
          data-testid="canvas-diagram-node-content"
          type="button"
          onClick={() => { if (isSelected) setEditing("content"); }}
        >
          {content}
        </button>
      ) : null}
    </div>
  );
}
