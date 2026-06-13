import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolState } from "../../toolRegistry.js";

export type PlanRequestPhase = "chat" | "planning" | "execution";
export type PlanRequestStage = "chat" | "intake" | "revise" | "execution";

export function resolvePlanRequestPolicy(payload: Pick<GenerateRequest, "chatInstruction" | "contextValues" | "toolState" | "planPhase" | "planId" | "stepId">) {
  const execution = record(payload.contextValues?.planExecution);
  const executionStepId = string(execution.stepId);
  const awaitingPlan = record(payload.contextValues?.awaitingPlan);
  const orchestration = record(payload.contextValues?.orchestrationPolicy);
  const isPlanning = /^\s*\/plan\b/i.test(payload.chatInstruction ?? "") || Boolean(awaitingPlan.id) || orchestration.mode === "managed_plan";
  const explicitStage = payload.planPhase;
  const phase: PlanRequestPhase = explicitStage === "execution" || executionStepId ? "execution" : explicitStage === "intake" || explicitStage === "revise" || isPlanning ? "planning" : "chat";
  const stage: PlanRequestStage = explicitStage ?? (phase === "execution" ? "execution" : phase === "planning" ? (string(awaitingPlan.id) ? "revise" : "intake") : "chat");
  return { phase, stage, executionStepId: payload.stepId ?? executionStepId, toolState: toolsForStage(payload.toolState ?? {}, stage) };
}

export function planPhaseSystemPrompt(payload: Pick<GenerateRequest, "chatInstruction" | "contextValues" | "toolState" | "planPhase" | "planId" | "stepId">) {
  const policy = resolvePlanRequestPolicy(payload);
  if (policy.phase === "planning") {
    const awaiting = record(payload.contextValues?.awaitingPlan);
    const planId = payload.planId ?? string(awaiting.id);
    return [
      "# Plan Phase Policy",
      "This request is planning-only. Do not search the web, browse, write Canvas content, or execute task steps.",
      planId
        ? `Continue planning on the existing plan ${planId}. Submit exactly one plan_revision_submit result for that same plan; never create a replacement plan.`
        : "Apply the brainstorming skill. Submit exactly one plan_clarification_submit result containing 2-3 mutually exclusive options and exactly one recommended option. Do not create an approval-ready plan yet.",
      planId ? "Apply the writing-plans skill and produce a short approval-ready sequential plan." : "Stop immediately after requesting input.",
      "Stop after requesting input or producing an approval-ready plan. User approval is required before execution."
    ].join("\n");
  }
  if (policy.phase === "execution") {
    const execution = record(payload.contextValues?.planExecution);
    return [
      "# Plan Execution Policy",
      `Execute only plan ${payload.planId ?? string(execution.planId)} step ${policy.executionStepId}. Do not start or complete any other step in this run.`,
      "The product runtime owns step status. Stage durable text/image artifacts for this step as soon as they are ready.",
      "If essential information is missing, request user input and stop. Do not finish the whole plan unless no steps remain."
    ].join("\n");
  }
  return "";
}

function toolsForStage(current: ToolState, stage: PlanRequestStage): ToolState {
  if (stage === "intake" || stage === "revise") {
    return {
      web_search: false,
      artifact_stage: false,
      knowledge_base: false,
      quick_messages: false,
      clear_context: false,
      canvas_write: false,
      plan_clarification_submit: stage === "intake",
      plan_revision_submit: stage === "revise"
    };
  }
  if (stage === "execution") {
    return {
      ...current,
      quick_messages: false,
      clear_context: false,
      canvas_write: false,
      plan_clarification_submit: false,
      plan_revision_submit: false,
      artifact_stage: true,
      web_search: true
    };
  }
  return {
    ...current,
    plan_clarification_submit: false,
    plan_revision_submit: false,
    artifact_stage: false
  };
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
