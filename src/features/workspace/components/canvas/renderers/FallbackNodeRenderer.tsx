import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale } from "../types";

type FallbackNodeRendererProps = {
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function FallbackNodeRenderer({ locale, node, onUpdateNode }: FallbackNodeRendererProps) {
  return (
    <>
      <input
        className="canvas-node-title nodrag"
        data-testid="canvas-node-title"
        defaultValue={node.title}
        onBlur={(event) => void onUpdateNode(node.id, { title: event.currentTarget.value })}
      />
      <p className="canvas-node-fallback">
        {locale === "zh" ? "这个节点类型暂未安装专属渲染器，将以安全文本节点显示。" : "This node type does not have a dedicated renderer yet, so it is shown as a safe text node."}
      </p>
      <textarea
        className="canvas-node-content nodrag nowheel"
        data-testid="canvas-node-content"
        defaultValue={node.content}
        placeholder={locale === "zh" ? "在这里编辑节点内容..." : "Edit node content..."}
        onBlur={(event) => void onUpdateNode(node.id, { content: event.currentTarget.value })}
      />
    </>
  );
}
