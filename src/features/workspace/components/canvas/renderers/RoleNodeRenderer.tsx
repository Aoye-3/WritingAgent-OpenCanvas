import { useEffect, useMemo, useState } from "react";
import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale } from "../types";

type RoleNodeRendererProps = {
  isSelected: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function RoleNodeRenderer({ isSelected, locale, node, onUpdateNode }: RoleNodeRendererProps) {
  const role = useMemo(() => readWorkflowRole(node), [node]);
  const [label, setLabel] = useState(role.label);
  const [prompt, setPrompt] = useState(role.prompt);
  const [editing, setEditing] = useState<"label" | "prompt" | null>(null);

  useEffect(() => setLabel(role.label), [role.label]);
  useEffect(() => setPrompt(role.prompt), [role.prompt]);

  const saveRole = (patch: { label?: string; prompt?: string }) => {
    const nextRole = {
      roleId: role.roleId,
      label: patch.label ?? label,
      prompt: patch.prompt ?? prompt,
      ...(role.description ? { description: role.description } : {})
    };
    void onUpdateNode(node.id, {
      title: nextRole.label,
      metadata: { ...(node.metadata as Record<string, unknown> | undefined), workflowRole: nextRole }
    });
  };

  return (
    <div className="canvas-role-node-body">
      {editing === "label" ? <input
        autoFocus
        className="canvas-node-title nodrag"
        data-testid="canvas-role-label"
        value={label}
        placeholder={locale === "zh" ? "Role 名称" : "Role label"}
        onBlur={() => {
          if (label !== role.label) saveRole({ label });
          setEditing(null);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        onChange={(event) => setLabel(event.currentTarget.value)}
      /> : <div className="canvas-node-title canvas-node-readonly" data-testid="canvas-role-label" onClick={() => { if (isSelected) setEditing("label"); }}>{label}</div>}
      {editing === "prompt" ? <textarea
        autoFocus
        className="canvas-node-content nodrag nowheel"
        data-testid="canvas-role-prompt"
        value={prompt}
        placeholder={locale === "zh" ? "输入这个 Role 的建议视角 prompt..." : "Prompt for this role perspective..."}
        onBlur={() => {
          if (prompt !== role.prompt) saveRole({ prompt });
          setEditing(null);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        onChange={(event) => setPrompt(event.currentTarget.value)}
      /> : <div className="canvas-node-content canvas-node-readonly" data-testid="canvas-role-prompt" onClick={() => { if (isSelected) setEditing("prompt"); }}>{prompt || (locale === "zh" ? "再次点击编辑 Role prompt" : "Click again to edit Role prompt")}</div>}
    </div>
  );
}

function readWorkflowRole(node: CanvasNode) {
  const metadata = node.metadata as { workflowRole?: { roleId?: unknown; label?: unknown; prompt?: unknown; description?: unknown } } | undefined;
  const workflowRole = metadata?.workflowRole;
  const roleId = typeof workflowRole?.roleId === "string" && workflowRole.roleId ? workflowRole.roleId : node.id;
  const label = typeof workflowRole?.label === "string" && workflowRole.label ? workflowRole.label : node.title || "Role";
  const prompt = typeof workflowRole?.prompt === "string" ? workflowRole.prompt : "";
  const description = typeof workflowRole?.description === "string" ? workflowRole.description : "";
  return { roleId, label, prompt, description };
}
