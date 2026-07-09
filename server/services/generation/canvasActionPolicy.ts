import { createHash } from "node:crypto";
import { isDirectCanvasDeliveryIntent, mentionsCanvasSurfaceOrNode } from "./canvasDeliveryIntent.js";

export type CanvasAction = {
  id: string;
  operation: "create" | "append" | "replace" | "replace_range" | "delete";
  risk: "low" | "high";
  requiresTool: boolean;
  targetNodeId?: string;
};

export function resolveCanvasAction(input: {
  threadId: string;
  instruction?: string;
  selectedCanvasNodeId?: string;
  sequence?: number;
}): CanvasAction | undefined {
  const instruction = input.instruction?.trim();
  if (!instruction || !mentionsCanvas(instruction)) return undefined;

  const operation = resolveOperation(instruction, input.selectedCanvasNodeId);
  if (!operation) return undefined;
  const serverManagedDelivery = operation === "create" && isDirectCanvasDeliveryIntent(instruction) && !isSingleNodeCreationIntent(instruction);
  return {
    id: `canvas_action_${createHash("sha256").update(`${input.threadId}\n${input.sequence ?? 0}\n${instruction}`).digest("hex").slice(0, 24)}`,
    operation,
    risk: operation === "create" || operation === "append" ? "low" : "high",
    requiresTool: !serverManagedDelivery,
    targetNodeId: input.selectedCanvasNodeId
  };
}

function mentionsCanvas(value: string) {
  return mentionsCanvasSurfaceOrNode(value);
}

function resolveOperation(value: string, selectedCanvasNodeId?: string): CanvasAction["operation"] | undefined {
  if (/\u5220\u9664|\u522a\u9664|\u79fb\u9664|delete|remove/i.test(value)) return "delete";
  if (hasExplicitReplaceIntent(value, selectedCanvasNodeId)) return "replace";
  if (/\u8ffd\u52a0|\u8865\u5145\u5230|\u88dc\u5145\u5230|\u7eed\u5199\u5230|\u7e8c\u5beb\u5230|append|add\s+to/i.test(value)) {
    return selectedCanvasNodeId ? "append" : "create";
  }
  if (/\u521b\u5efa|\u5275\u5efa|\u65b0\u5efa|\u65b0\u589e|\u5efa\u7acb|\u5199\u5165|\u5beb\u5165|\u4fdd\u5b58\u5230|\u52a0\u5165|\u6dfb\u52a0|\u653e\u5230|create|write|save/i.test(value)) {
    return "create";
  }
  if (isDirectCanvasDeliveryIntent(value)) return "create";
  return undefined;
}

function isSingleNodeCreationIntent(value: string) {
  return /(?:创建|創建|新建|新增|create|make).{0,12}(?:一个|一個|1|one)?\s*(?:节点|節點|node)/i.test(value);
}

function hasExplicitReplaceIntent(value: string, selectedCanvasNodeId?: string) {
  const replaceTerm = /(?:\u8986\u76d6|\u8986\u84cb|\u66ff\u6362|\u66ff\u63db|\u91cd\u5199|\u91cd\u5beb|replace|overwrite)/i;
  if (!replaceTerm.test(value)) return false;
  const explicitTarget = /(?:canvas|board|nodes?|cards?|\u753b\u677f|\u753b\u5e03|\u767d\u677f|\u8282\u70b9|\u7bc0\u9ede|\u5361\u7247|\u5f53\u524d|\u7576\u524d|\u9009\u4e2d|\u9078\u4e2d|\u73b0\u6709|\u73fe\u6709)/i;
  if (explicitTarget.test(value)) return true;
  return Boolean(selectedCanvasNodeId && /(?:\u8fd9\u4e2a|\u9019\u500b|\u4e0a\u9762|\u5185\u5bb9|\u5167\u5bb9|current|selected)/i.test(value));
}
