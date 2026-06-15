const canvasSurfacePattern = /canvas|board|画板|畫板|画布|畫布/i;
const nodeSurfacePattern = /nodes?|cards?|节点|節點|卡片|文档节点|文檔節點/i;

const diagramSurfacePattern = /思维导图|脑图|流程图|用户流程|自由图形节点|导图|\bmind\s*map\b|\bmindmap\b|\buser\s*flow\b|\bflowchart\b|\bdiagram\b/i;

const directCanvasDeliveryPatterns = [
  /总结(?:到|成|进|進)|總結(?:到|成|進)/i,
  /整理(?:到|成|进|進)|归纳(?:到|成|进|進)|歸納(?:到|成|進)/i,
  /(?:放|写|寫|保存|加入|添加|生成|创建|創建|新建)(?:到|进|進|入|成)?/i,
  /(?:拆|分)(?:成|为|為)?/i,
  /做成|整理成|放进|放進/i,
  /\b(?:summari[sz]e|organize|turn|split|make|create|add|put|save|write|send)\b.{0,40}\b(?:canvas|board|nodes?|cards?)\b/i,
  /\b(?:canvas|board)\b.{0,40}\b(?:nodes?|cards?)\b/i
];

export function mentionsCanvasSurfaceOrNode(value: string) {
  return canvasSurfacePattern.test(value) || nodeSurfacePattern.test(value) || diagramSurfacePattern.test(value);
}

export function isDirectCanvasDeliveryIntent(value: string) {
  const instruction = value.trim();
  if (!instruction || !mentionsCanvasSurfaceOrNode(instruction)) return false;
  if (isDiagramCanvasDeliveryIntent(instruction)) return true;
  if (canvasSurfacePattern.test(instruction) && nodeSurfacePattern.test(instruction)) return true;
  return directCanvasDeliveryPatterns.some((pattern) => pattern.test(instruction));
}

export function isDiagramCanvasDeliveryIntent(value: string) {
  return diagramSurfacePattern.test(value.trim());
}
