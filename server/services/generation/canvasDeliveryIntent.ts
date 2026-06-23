const canvasSurfacePattern = /canvas|board|画板|画布|白板/i;
const nodeSurfacePattern = /nodes?|cards?|节点|卡片|文档节点|参考链接|参考文献|来源/i;

const diagramSurfacePattern = /思维导图|脑图|流程图|用户流程|自由图形节点|导图|\bmind\s*map\b|\bmindmap\b|\buser\s*flow\b|\bflowchart\b|\bdiagram\b/i;

const directCanvasDeliveryPatterns = [
  /(?:总结|整理|归纳).{0,30}(?:到|进|为|成).{0,30}(?:canvas|board|画板|画布|白板|节点|卡片)/i,
  /(?:放到|放进|保存到|加入|添加|生成|创建|新建|写入).{0,30}(?:canvas|board|画板|画布|白板|节点|卡片)/i,
  /(?:概述|正文|参考链接|参考文献|来源).{0,60}(?:节点|canvas|board|画板|画布|白板)/i,
  /(?:节点|卡片).{0,30}(?:概述|正文|参考链接|参考文献|来源)/i,
  /\b(?:summari[sz]e|organize|turn|split|make|create|add|put|save|write|send)\b.{0,40}\b(?:canvas|board|nodes?|cards?)\b/i,
  /\b(?:canvas|board)\b.{0,40}\b(?:nodes?|cards?|overview|body|sources?|references?)\b/i
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
