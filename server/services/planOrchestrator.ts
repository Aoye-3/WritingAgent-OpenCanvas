import type { GenerateRequest } from "../contracts/generation.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import { resolvePlanRequestPolicy } from "./generation/planRequestPolicy.js";

export class PlanOrchestrator {
  constructor(private readonly storage: SQLiteStorageRepository) {}

  prepare(threadId: string, payload: GenerateRequest) {
    const context = executionContext(payload);
    if (context) {
      const plan = this.storage.getPlanRun(threadId, context.planId);
      const step = plan?.steps.find((item) => item.id === context.stepId);
      if (!plan || plan.status !== "running" || plan.approval !== "approved" || !step) {
        throw new Error("Plan execution is not active for the requested step.");
      }
      if (step.status === "pending") this.storage.updatePlanStep(threadId, plan.id, step.id, { status: "running" });
      this.storage.recordPlanActivity(threadId, plan.id, {
        stepId: step.id,
        type: "step_started",
        status: "running",
        summary: `Started: ${step.title}`
      });
      return;
    }
    const awaitingPlanId = string(record(payload.contextValues?.awaitingPlan).id);
    const intakePlanId = payload.planGeneration?.phase === "intake" ? payload.planGeneration.planId : "";
    if (intakePlanId && this.storage.getPlanRun(threadId, intakePlanId)) {
      this.storage.recordPlanActivity(threadId, intakePlanId, {
        type: "intent_recognized",
        status: "running",
        summary: "Using skill: brainstorming",
        detail: { skill: "brainstorming" }
      });
      this.storage.recordPlanActivity(threadId, intakePlanId, {
        type: "clarification_preparing",
        status: "running",
        summary: "Preparing one key question"
      });
    }
    if (resolvePlanRequestPolicy(payload).stage === "revise" && awaitingPlanId) {
      this.storage.recordPlanActivity(threadId, awaitingPlanId, {
        type: "plan_preparing",
        status: "running",
        summary: "Preparing an approval-ready plan"
      });
    }
  }

  observe(threadId: string, event: ToolEventRecord) {
    const payload = record(event.payload);
    const isToolActivity = /(?:^|_)tool_(?:started|completed)$/.test(event.eventType);
    const runningPlans = isToolActivity
      ? this.storage.listPlanRuns(threadId).filter((plan) => plan.status === "running")
      : [];
    const planId = string(payload.planId) || (runningPlans.length === 1 ? runningPlans[0].id : "");
    if (!planId || !this.storage.getPlanRun(threadId, planId)) return;
    const firstArtifact = Array.isArray(payload.artifacts) ? record(payload.artifacts[0]) : {};
    const stepId = string(payload.stepId) || string(firstArtifact.stepId) || undefined;
    if (/(?:^|_)artifact_committed$/.test(event.eventType)) {
      this.storage.recordPlanActivity(threadId, planId, { stepId, type: "artifact_committed", status: "committed", summary: "Canvas artifact committed" });
    } else if (/(?:^|_)plan_waiting_for_user$/.test(event.eventType)) {
      this.storage.recordPlanActivity(threadId, planId, { type: "clarification_ready", status: "awaiting_user", summary: "Clarification is ready" });
    } else if (/(?:^|_)plan_updated$/.test(event.eventType)) {
      this.storage.recordPlanActivity(threadId, planId, { type: "plan_ready", status: "awaiting_approval", summary: "Plan is ready for approval" });
    } else if (/(?:^|_)tool_started$/.test(event.eventType)) {
      this.storage.recordPlanActivity(threadId, planId, { stepId, type: "tool_started", status: "running", summary: safeToolSummary(payload, "Tool started") });
    } else if (/(?:^|_)tool_completed$/.test(event.eventType)) {
      this.storage.recordPlanActivity(threadId, planId, { stepId, type: "tool_completed", status: "completed", summary: safeToolSummary(payload, "Tool completed") });
    }
  }

  complete(threadId: string, payload: GenerateRequest) {
    const context = executionContext(payload);
    if (!context) return;
    const plan = this.storage.getPlanRun(threadId, context.planId);
    const committed = plan?.artifacts.some((artifact) => artifact.stepId === context.stepId && artifact.status === "committed");
    if (!plan || !committed) return;
    this.storage.updatePlanStep(threadId, plan.id, context.stepId, { status: "completed" });
    this.storage.recordPlanActivity(threadId, plan.id, {
      stepId: context.stepId,
      type: "step_completed",
      status: "completed",
      summary: `Completed: ${plan.steps.find((step) => step.id === context.stepId)?.title ?? context.stepId}`
    });
    if (this.storage.getPlanRun(threadId, plan.id)?.status === "completed") {
      this.storage.recordPlanActivity(threadId, plan.id, { type: "plan_completed", status: "completed", summary: "Plan completed" });
    }
  }

  fail(threadId: string, payload: GenerateRequest, error: unknown) {
    const context = executionContext(payload);
    if (!context) return;
    const message = error instanceof Error ? error.message.slice(0, 240) : "Plan execution failed";
    this.storage.recordPlanActivity(threadId, context.planId, { stepId: context.stepId, type: "plan_failed", status: "failed", summary: message });
    this.storage.pausePlanRun(threadId, context.planId, message);
  }
}

function executionContext(payload: GenerateRequest) {
  const value = record(payload.contextValues?.planExecution);
  const planId = payload.planId ?? string(value.planId);
  const stepId = payload.stepId ?? string(value.stepId);
  return planId && stepId ? { planId, stepId } : undefined;
}

function safeToolSummary(payload: Record<string, unknown>, fallback: string) {
  const tool = string(payload.toolName) || string(payload.tool);
  return tool ? `${fallback}: ${tool}` : fallback;
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
