import type { GenerateRequest } from "../../contracts/generation.js";
import { isDirectCanvasDeliveryIntent } from "./canvasDeliveryIntent.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";
import { resolveOrchestrationPolicy } from "./orchestrationPolicy.js";

export type TaskHandlingKind = "simple_chat" | "plan_intake" | "long_task" | "explicit_canvas" | "plan_execution";
export type CanvasDeliveryMode = "none" | "progressive" | "explicit";

export type TaskHandlingPolicy = {
  kind: TaskHandlingKind;
  canvasDeliveryMode: CanvasDeliveryMode;
  allowPlan: boolean;
};

export function resolveTaskHandlingPolicy(input: {
  payload: GenerateRequest;
  transientSkillCount?: number;
  thinkingMode?: "enabled" | "disabled";
}): TaskHandlingPolicy {
  const payload = input.payload;
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  if (isDirectCanvasDeliveryIntent(instruction)) {
    return { kind: "explicit_canvas", canvasDeliveryMode: "explicit", allowPlan: false };
  }

  const planPolicy = resolvePlanRequestPolicy(payload);
  if (planPolicy.phase === "execution") {
    return { kind: "plan_execution", canvasDeliveryMode: "progressive", allowPlan: true };
  }
  if (planPolicy.phase === "planning") {
    return { kind: "plan_intake", canvasDeliveryMode: "none", allowPlan: true };
  }

  if (isDurableLongTask(payload, input.transientSkillCount ?? 0, input.thinkingMode)) {
    return { kind: "long_task", canvasDeliveryMode: "progressive", allowPlan: false };
  }

  return { kind: "simple_chat", canvasDeliveryMode: "none", allowPlan: false };
}

export function shouldAutoPreflightPlan(input: {
  payload: GenerateRequest;
  transientSkillCount?: number;
  thinkingMode?: "enabled" | "disabled";
}): boolean {
  const payload = input.payload;
  if (payload.planGeneration || payload.planPhase || payload.planId || payload.stepId) return false;
  if (payload.mode !== "chat") return false;
  if (recordHasKeys(payload.contextValues?.agentClarification)) return false;
  if (recordHasKeys(payload.contextValues?.awaitingPlan)) return false;
  if (recordHasKeys(payload.contextValues?.planExecution)) return false;
  if (record(payload.contextValues?.autoPreflightPlan).enabled === false) return false;
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  if (/^\s*\/plan\b/i.test(instruction)) return false;
  if (isDirectCanvasDeliveryIntent(instruction)) return false;
  const policy = resolveOrchestrationPolicy(instruction);
  if (policy.mode === "managed_plan") return false;
  return isDurableLongTask(payload, input.transientSkillCount ?? 0, input.thinkingMode);
}

export function isCanvasEligibleTaskPolicy(value: unknown): boolean {
  const record = isRecord(value) ? value : {};
  return record.canvasDeliveryMode === "progressive" || record.canvasDeliveryMode === "explicit";
}

export function isProcessClarificationText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return [
    /濂界殑.{0,20}闇€瑕佸厛.{0,80}纭/i,
    /闇€瑕佸厛[\s\S]{0,160}纭/i,
    /璺熸偍[\s\S]{0,120}纭/i,
    /(?:需要|我需要|请|先)(?:您|你)?(?:确认|澄清|补充|选择)(?:几个|一些|一下)?(?:关键点|问题|方向|选项)/i,
    /(?:需要|我需要).{0,12}(?:确认|澄清|补充|选择)(?:几个|一些|一下)?(?:关键点|问题|方向|选项)/i,
    /(?:需要|我需要|请|先).{0,20}(?:明确|确定|选定)(?:几个|一些|一下)?(?:关键点|问题|方向|选项|范围)/i,
    /(?:明确|确定|选定).{0,20}(?:关键点|问题|方向|选项|范围)(?:后|之后|以后)?(?:再|才)?(?:开始|继续|执行|检索|研究|撰写)?/i,
    /(?:在|开始|继续|撰写|执行|检索|研究)(?:之前|前).{0,40}(?:确认|澄清|补充|选择)/i,
    /(?:before i (?:proceed|continue|start|write|research)|i need to (?:clarify|confirm|ask)|let me clarify|please (?:clarify|confirm|choose))/i,
    /now i have the full skill.{0,160}(?:clarif|phase|scope|format)/i,
    /(?:i have|i['’]?ve) (?:loaded|read).{0,80}skill.{0,160}(?:clarif|proceed|phase|scope|format)/i,
    /let me proceed with phase \d+.{0,160}(?:clarif|scope|format)/i
  ].some((pattern) => pattern.test(text));
}

function isDurableLongTask(payload: GenerateRequest, transientSkillCount: number, thinkingMode?: "enabled" | "disabled") {
  const instruction = payload.chatInstruction ?? payload.freeTextPrompt ?? "";
  const policy = resolveOrchestrationPolicy(instruction);
  if (policy.mode === "guided" || policy.deliveryPolicy === "canvas_required") return true;
  if (transientSkillCount > 0 && hasDurableDeliverableIntent(instruction)) return true;
  if (transientSkillCount > 0 && instruction.trim().length > 20 && !looksLikeSimpleQuestion(instruction)) return true;
  if (thinkingMode === "enabled" && hasDurableDeliverableIntent(instruction)) return true;
  return hasDurableDeliverableIntent(instruction) && countTaskSignals(instruction) >= 2;
}

function hasDurableDeliverableIntent(value: string) {
  return /\b(?:research|analy[sz]e|audit|compare|review|summari[sz]e|write|draft|report|document|deliver|implement|test|verify|plan|design)\b|(?:研究|调研|分析|排查|审计|对比|综述|总结|撰写|报告|文档|交付|实现|测试|验证|设计|方案|维护|阅读技术文档)/i.test(value);
}

function countTaskSignals(value: string) {
  return [
    /\b(?:research|analy[sz]e|audit|compare|review|summari[sz]e|write|draft|report|document|deliver|implement|test|verify|plan|design)\b/gi,
    /(?:研究|调研|分析|排查|审计|对比|综述|总结|撰写|报告|文档|交付|实现|测试|验证|设计|方案|维护|阅读技术文档)/gi
  ].reduce((count, pattern) => count + [...value.matchAll(pattern)].length, 0);
}

function looksLikeSimpleQuestion(value: string) {
  const text = value.trim();
  if (text.length > 80) return false;
  return /^(?:what is|what are|who is|when is|where is|how do i|how to|why is)\b/i.test(text)
    || /^(?:什么是|什么叫|谁是|哪里是|如何|怎么|为什么)/.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown) {
  return isRecord(value) ? value : {};
}

function recordHasKeys(value: unknown) {
  return isRecord(value) && Object.keys(value).length > 0;
}
