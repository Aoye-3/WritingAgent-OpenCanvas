import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolState } from "../../toolRegistry.js";

export type PlanRequestPhase = "chat" | "planning" | "execution";

export function resolvePlanRequestPolicy(payload: Pick<GenerateRequest, "chatInstruction" | "contextValues" | "toolState">) {
  const execution = record(payload.contextValues?.planExecution);
  const executionStepId = string(execution.stepId);
  const isPlanning = /^\s*\/plan\b/i.test(payload.chatInstruction ?? "") || Boolean(payload.contextValues?.awaitingPlan);
  const phase: PlanRequestPhase = executionStepId ? "execution" : isPlanning ? "planning" : "chat";
  return { phase, executionStepId, toolState: toolsForPhase(payload.toolState ?? {}, phase) };
}

export function planPhaseSystemPrompt(payload: Pick<GenerateRequest, "chatInstruction" | "contextValues" | "toolState">) {
  const policy = resolvePlanRequestPolicy(payload);
  if (policy.phase === "planning") {
    const awaiting = record(payload.contextValues?.awaitingPlan);
    const planId = string(awaiting.id);
    return [
      "# Plan Phase Policy",
      "This request is planning-only. Do not search the web, browse, write Canvas content, or execute task steps.",
      planId
        ? `Continue planning on the existing plan ${planId}. Use plan_update(action=\"revise\") to update that same plan; never create a replacement plan.`
        : "Analyze the user's intent. If material scope is missing, create a preliminary plan and then call plan_update(action=\"request_input\") with one concise user-facing question. If scope is sufficient, create the ordered plan for approval.",
      "Stop after requesting input or producing an approval-ready plan. User approval is required before execution."
    ].join("\n");
  }
  if (policy.phase === "execution") {
    const execution = record(payload.contextValues?.planExecution);
    return [
      "# Plan Execution Policy",
      `Execute only plan ${string(execution.planId)} step ${policy.executionStepId}. Do not start or complete any other step in this run.`,
      "Mark this step running before work. Stage durable text/image artifacts for this step as soon as they are ready, then mark only this step completed.",
      "If essential information is missing, request user input and stop. Do not finish the whole plan unless no steps remain."
    ].join("\n");
  }
  return "";
}

function toolsForPhase(current: ToolState, phase: PlanRequestPhase): ToolState {
  if (phase === "planning") {
    return {
      web_search: false,
      artifact_stage: false,
      knowledge_base: false,
      quick_messages: false,
      clear_context: false,
      canvas_write: false,
      plan_update: true
    };
  }
  if (phase === "execution") {
    return {
      ...current,
      quick_messages: false,
      clear_context: false,
      canvas_write: false,
      plan_update: true,
      artifact_stage: true,
      web_search: true
    };
  }
  return { ...current };
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
