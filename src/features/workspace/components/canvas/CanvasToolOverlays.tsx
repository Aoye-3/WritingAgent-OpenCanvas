import { useEffect, useRef } from "react";
import type { CanvasNode, CanvasObject } from "../../../agents/types";
import type { CanvasShapeId } from "../../../../../shared/canvasObjects";
import { ShapeLibraryPanel } from "./ShapeLibraryPanel";
import type { CanvasTool } from "./toolState";

export function CanvasAssetInput({ activeTool, onToolChange, onUploadAsset }: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onUploadAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (activeTool === "asset") inputRef.current?.click();
  }, [activeTool]);

  return <input
    accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.txt,.md"
    className="canvas-asset-input"
    ref={inputRef}
    type="file"
    onChange={(event) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = "";
      if (!file) return onToolChange("select");
      void readFileBase64(file).then((fileBase64) => onUploadAsset({ fileName: file.name, fileBase64 })).finally(() => onToolChange("select"));
    }}
  />;
}

export function CanvasToolOverlays(props: {
  activeTool: CanvasTool;
  locale: "en" | "zh";
  nodes: CanvasNode[];
  objects: CanvasObject[];
  recentShapeIds: string[];
  selectedNodeIds: string[];
  selectedObjectIds: string[];
  onSelectShape: (shapeId: CanvasShapeId) => void;
  onSendToChat: (text: string) => void;
  onToolChange: (tool: CanvasTool) => void;
}) {
  if (props.activeTool === "shape") {
    return <ShapeLibraryPanel locale={props.locale} recentShapeIds={props.recentShapeIds} onClose={() => props.onToolChange("select")} onSelectShape={props.onSelectShape} />;
  }
  if (props.activeTool !== "agent") return null;
  const actions = [
    [props.locale === "zh" ? "总结选区" : "Summarize selection", "Summarize the selected Canvas items."],
    [props.locale === "zh" ? "解释关系" : "Explain relationships", "Explain the relationships between the selected Canvas items."],
    [props.locale === "zh" ? "生成内容提案" : "Create content proposal", "Create a content proposal based on the selected Canvas items."],
    [props.locale === "zh" ? "布局整理建议" : "Suggest layout cleanup", "Suggest a clearer layout for the selected Canvas items without changing the Canvas."],
  ];
  return <div className="canvas-agent-tool-menu" data-testid="canvas-agent-tool-menu">
    <strong>{props.locale === "zh" ? "选区 Agent 操作" : "Selection Agent actions"}</strong>
    {actions.map(([label, instruction]) => <button key={label} type="button" onClick={() => {
      const nodes = props.nodes.filter((node) => props.selectedNodeIds.includes(node.id)).map((node) => `${node.title}: ${node.content}`);
      const objects = props.objects.filter((object) => props.selectedObjectIds.includes(object.id)).map((object) => `[${object.kind}] ${JSON.stringify(object.data)}`);
      props.onSendToChat(`${instruction}\n\n${[...nodes, ...objects].join("\n") || "No Canvas items selected."}`);
      props.onToolChange("select");
    }}>{label}</button>)}
  </div>;
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}
