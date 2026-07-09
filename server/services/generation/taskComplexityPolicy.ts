import type { GenerateRequest } from "../../contracts/generation.js";
import { isDirectCanvasDeliveryIntent } from "./canvasDeliveryIntent.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";
import { resolveOrchestrationPolicy } from "./orchestrationPolicy.js";

export type TaskComplexity = "simple" | "routine" | "complex";

export type ComplexityDecision = {
  complexity: TaskComplexity;
  requiresAgentPlan: boolean;
  confidence: number;
  signals: string[];
  recommendedStepCount?: 2 | 3 | 4 | 5;
};

export function resolveTaskComplexity(input: {
  payload: GenerateRequest;
  transientSkillCount?: number;
  thinkingMode?: "enabled" | "disabled";
}): ComplexityDecision {
  const payload = input.payload;
  const instruction = (payload.chatInstruction ?? payload.freeTextPrompt ?? "").trim();
  const signals = new Set<string>();
  const planPolicy = resolvePlanRequestPolicy(payload);
  const orchestration = resolveOrchestrationPolicy(instruction);

  if (planPolicy.phase === "planning" || /^\s*\/plan\b/i.test(instruction)) {
    signals.add("explicit_plan");
  }
  if (planPolicy.phase === "execution" || payload.planGeneration || payload.planId || payload.stepId) {
    signals.add("plan_context");
  }
  if (recordHasKeys(payload.contextValues?.awaitingPlan) || recordHasKeys(payload.contextValues?.planExecution)) {
    signals.add("persisted_plan_context");
  }
  if (orchestration.mode === "guided" || orchestration.mode === "managed_plan") {
    signals.add("guided_orchestration");
  }
  if (hasMultiStageIntent(instruction)) {
    signals.add("multi_stage_intent");
  }
  if (countActionSignals(instruction) >= 2) {
    signals.add("multiple_deliverable_actions");
  }
  if (countLayerSignals(instruction) >= 2) {
    signals.add("cross_system_scope");
  }
  if (hasPersistenceIntent(instruction)) {
    signals.add("persistence_or_recovery");
  }
  if (hasBudgetIntent(instruction) || input.thinkingMode === "enabled") {
    signals.add("budget_or_reasoning_risk");
  }
  if ((input.transientSkillCount ?? 0) > 0) {
    signals.add("skill_assisted_task");
  }
  if (isDirectCanvasDeliveryIntent(instruction)) {
    signals.add("durable_delivery");
  }

  const signalList = [...signals];
  const explicitPlan = signals.has("explicit_plan") || signals.has("plan_context") || signals.has("persisted_plan_context");
  const complex = explicitPlan || signals.has("skill_assisted_task") || signalList.length >= 2;
  if (complex) {
    return {
      complexity: "complex",
      requiresAgentPlan: true,
      confidence: explicitPlan ? 0.95 : Math.min(0.9, 0.55 + signalList.length * 0.1),
      signals: signalList,
      recommendedStepCount: recommendedStepCount(signalList)
    };
  }

  if (signalList.length === 1 || orchestration.mode === "guided") {
    return {
      complexity: "routine",
      requiresAgentPlan: false,
      confidence: 0.65,
      signals: signalList
    };
  }

  return {
    complexity: "simple",
    requiresAgentPlan: false,
    confidence: 0.8,
    signals: signalList
  };
}

function recommendedStepCount(signals: string[]): 2 | 3 | 4 | 5 {
  if (signals.includes("cross_system_scope") && signals.includes("persistence_or_recovery")) return 5;
  if (signals.includes("multi_stage_intent") && signals.includes("budget_or_reasoning_risk")) return 4;
  if (signals.includes("explicit_plan")) return 3;
  return 3;
}

function hasMultiStageIntent(value: string) {
  return /\b(?:research|investigate|debug|rewrite|migrate|architecture|implement|test|verify|validate|end-to-end|full[-\s]?stack|full[-\s]?chain|refactor|redesign|audit|compare|plan)\b/i.test(value)
    || /(?:调研|排查|重写|迁移|架构|实现|测试|验证|全链路|重构|审计|对比|计划|方案)/.test(value);
}

function countActionSignals(value: string) {
  return [
    ...value.matchAll(/\b(?:research|investigate|debug|rewrite|migrate|architect|implement|test|verify|validate|refactor|redesign|audit|compare|plan|write|draft|report|document|summari[sz]e)\b/gi),
    ...value.matchAll(/(?:调研|排查|重写|迁移|架构|实现|测试|验证|重构|审计|对比|计划|撰写|报告|文档|总结)/g)
  ].length;
}

function hasPersistenceIntent(value: string) {
  return /\b(?:persist|persistent|durable|recover|resume|progress|task list|todo|checkpoint|state|where.*step|which step)\b/i.test(value)
    || /(?:持久化|恢复|继续|进度|任务列表|步骤|状态|走到哪一步)/.test(value);
}

function hasBudgetIntent(value: string) {
  return /\b(?:budget|token|cost|limit|quota|multi-call|multiple calls|long running|timeout)\b/i.test(value)
    || /(?:预算|令牌|成本|限制|多轮|长任务|超时)/.test(value);
}

function countLayerSignals(value: string) {
  const layers = [
    /\b(?:frontend|ui|react|component|browser)\b|(?:前端|界面|组件)/i,
    /\b(?:backend|server|api|route|service)\b|(?:后端|服务端|接口)/i,
    /\b(?:database|db|sqlite|schema|migration)\b|(?:数据库|持久化表|迁移)/i,
    /\b(?:runtime|agentbackend|agent backend|llm|model)\b|(?:运行时|模型|大模型)/i,
    /\b(?:test|e2e|playwright|verification)\b|(?:测试|端到端|验证)/i
  ];
  return layers.filter((pattern) => pattern.test(value)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordHasKeys(value: unknown) {
  return isRecord(value) && Object.keys(value).length > 0;
}
