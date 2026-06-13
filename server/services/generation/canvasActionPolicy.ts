import { createHash } from "node:crypto";

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
  return {
    id: `canvas_action_${createHash("sha256").update(`${input.threadId}\n${input.sequence ?? 0}\n${instruction}`).digest("hex").slice(0, 24)}`,
    operation,
    risk: operation === "create" || operation === "append" ? "low" : "high",
    requiresTool: true,
    targetNodeId: input.selectedCanvasNodeId
  };
}

function mentionsCanvas(value: string) {
  return /canvas|\u753b\u5e03|\u756b\u5e03|\u753b\u677f|\u756b\u677f/i.test(value);
}

function resolveOperation(value: string, selectedCanvasNodeId?: string): CanvasAction["operation"] | undefined {
  if (/\u5220\u9664|\u522a\u9664|\u79fb\u9664|delete|remove/i.test(value)) return "delete";
  if (/\u8986\u76d6|\u8986\u84cb|\u66ff\u6362|\u66ff\u63db|\u91cd\u5199|\u91cd\u5beb|replace|overwrite/i.test(value)) return "replace";
  if (/\u8ffd\u52a0|\u8865\u5145\u5230|\u88dc\u5145\u5230|\u7eed\u5199\u5230|\u7e8c\u5beb\u5230|append|add\s+to/i.test(value)) {
    return selectedCanvasNodeId ? "append" : "create";
  }
  if (/\u521b\u5efa|\u5275\u5efa|\u65b0\u5efa|\u65b0\u589e|\u5efa\u7acb|\u5199\u5165|\u5beb\u5165|\u4fdd\u5b58\u5230|\u52a0\u5165|\u6dfb\u52a0|\u653e\u5230|create|write|save/i.test(value)) {
    return "create";
  }
  return undefined;
}
