import { canvasShapeIds, type CanvasShapeId } from "../../../../../shared/canvasObjects";

export type CanvasShapeCategory = "basic" | "flowchart" | "advanced";

export type CanvasShapeDefinition = {
  id: CanvasShapeId;
  category: CanvasShapeCategory;
  label: { en: string; zh: string };
  className: string;
};

export const canvasShapes: CanvasShapeDefinition[] = [
  { id: "rectangle", category: "basic", label: { en: "Rectangle", zh: "矩形" }, className: "rectangle" },
  { id: "circle", category: "basic", label: { en: "Circle", zh: "圆形" }, className: "circle" },
  { id: "diamond", category: "basic", label: { en: "Decision", zh: "决策菱形" }, className: "diamond" },
  { id: "triangle", category: "basic", label: { en: "Triangle", zh: "三角形" }, className: "triangle" },
  { id: "star", category: "basic", label: { en: "Star", zh: "星形" }, className: "star" },
  { id: "arrow-right", category: "basic", label: { en: "Block arrow", zh: "块箭头" }, className: "arrow-right" },
  { id: "process", category: "flowchart", label: { en: "Flow process", zh: "流程处理" }, className: "rectangle" },
  { id: "terminator", category: "flowchart", label: { en: "Terminator", zh: "流程起止" }, className: "terminator" },
  { id: "data", category: "flowchart", label: { en: "Data", zh: "流程数据" }, className: "data" },
  { id: "document", category: "flowchart", label: { en: "Document", zh: "流程文档" }, className: "document" },
  { id: "database", category: "flowchart", label: { en: "Database", zh: "数据库" }, className: "database" },
  { id: "hexagon", category: "advanced", label: { en: "Hexagon", zh: "六边形" }, className: "hexagon" },
  { id: "speech", category: "advanced", label: { en: "Speech bubble", zh: "对话气泡" }, className: "speech" },
  { id: "cross", category: "advanced", label: { en: "Cross", zh: "十字形" }, className: "cross" },
];

if (canvasShapes.length !== canvasShapeIds.length) {
  throw new Error("Canvas shape catalog must define every shared Canvas shape id");
}

export function getCanvasShape(id: string | undefined) {
  return canvasShapes.find((shape) => shape.id === id) ?? canvasShapes[0];
}

export function filterCanvasShapes(query: string, locale: "en" | "zh") {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return canvasShapes;
  return canvasShapes.filter((shape) =>
    `${shape.id} ${shape.category} ${shape.label[locale]} ${shape.label.en} ${shape.label.zh}`
      .toLowerCase()
      .includes(normalized),
  );
}
