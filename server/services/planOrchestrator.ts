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
    const planPolicy = resolvePlanRequestPolicy(payload);
    const preflightPlanId = payload.planGeneration?.phase === "preflight" ? payload.planGeneration.planId : "";
    const planningPlanId = planPolicy.stage === "preflight" ? preflightPlanId : awaitingPlanId;
    if ((planPolicy.stage === "revise" && awaitingPlanId) || (planPolicy.stage === "preflight" && planningPlanId)) {
      this.storage.recordPlanActivity(threadId, planningPlanId, {
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

  complete(threadId: string, payload: GenerateRequest, events: ToolEventRecord[] = []) {
    const context = executionContext(payload);
    if (!context) return;
    const plan = this.storage.getPlanRun(threadId, context.planId);
    const committedDelivery = plan && ensureCanvasDeliveryArtifact(this.storage, threadId, context.planId, context.stepId, events);
    const committed = plan?.artifacts.some((artifact) => artifact.stepId === context.stepId && artifact.status === "committed")
      || Boolean(committedDelivery);
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

  assertPostcondition(threadId: string, payload: GenerateRequest, events: ToolEventRecord[] = []) {
    const generation = payload.planGeneration;
    if (!generation) return;
    const plan = this.storage.getPlanRun(threadId, generation.planId);
    if (!plan) throw new Error("Plan phase completed without its persisted Plan state.");

    if (generation.phase === "intake") {
      if (plan.status !== "awaiting_user" || plan.clarification?.status !== "pending") {
        throw new Error("Plan planning phase completed without a persisted clarification.");
      }
      return;
    }

    if (generation.phase === "revise" || generation.phase === "preflight") {
      const waitingForPlanClarification = plan.status === "awaiting_user" && plan.clarification?.status === "pending";
      const approvalReady = plan.status === "awaiting_approval" && plan.approval === "pending" && plan.steps.length >= 2 && plan.steps.length <= 5;
      if (!waitingForPlanClarification && !approvalReady) {
        throw new Error("Plan revision phase completed without an approval-ready persisted Plan.");
      }
      return;
    }

    const stepId = generation.stepId;
    const artifactCommitted = Boolean(stepId && plan.artifacts.some((artifact) => artifact.stepId === stepId && artifact.status === "committed"));
    const canvasDeliveryCommitted = Boolean(stepId && planCanvasDeliveryEvent(events));
    const interrupted = plan.status === "awaiting_user" || plan.status === "failed" || plan.status === "paused";
    if (!artifactCommitted && !canvasDeliveryCommitted && !interrupted) {
      throw new Error("This Plan step did not produce a Canvas deliverable. The Plan has paused so you can retry the step or revise the Plan.");
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
  if (/(?:web_search|web_fetch|knowledge_base)/i.test(tool)) return fallback === "Tool completed" ? "Source check completed" : "Checking sources";
  if (/(?:artifact_stage|canvas_write|canvas_delivery)/i.test(tool)) return fallback === "Tool completed" ? "Canvas update completed" : "Updating Canvas";
  if (/(?:read_file|write_file|present_files|bash|grep|glob|ls)/i.test(tool)) return fallback === "Tool completed" ? "Workspace check completed" : "Checking workspace";
  return fallback === "Tool completed" ? "Tool work completed" : "Tool work running";
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function ensureCanvasDeliveryArtifact(
  storage: SQLiteStorageRepository,
  threadId: string,
  planId: string,
  stepId: string,
  events: ToolEventRecord[]
) {
  const event = planCanvasDeliveryEvent(events);
  if (!event) return undefined;
  const payload = record(event.payload);
  const nodeId = string(payload.nodeId);
  if (!nodeId) return undefined;
  const deliveryId = string(payload.deliveryId) || "canvas_delivery";
  const artifactId = `canvas_${stepId}_${deliveryId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  const title = string(payload.title) || "Canvas deliverable";
  const staged = storage.stagePlanArtifact(threadId, planId, {
    artifactId,
    stepId,
    type: "text",
    title,
    payload: {
      nodeId,
      deliveryId,
      eventType: event.eventType
    }
  });
  return staged ? storage.markPlanArtifactCommitted(threadId, planId, staged.id, nodeId) : undefined;
}

function planCanvasDeliveryEvent(events: ToolEventRecord[]) {
  return [...events].reverse().find((event) => {
    const payload = record(event.payload);
    const eventType = string(payload.eventType) || event.eventType;
    return /^canvas_delivery_/.test(eventType)
      && /_committed$/.test(eventType)
      && eventType !== "canvas_delivery_failed_summary_committed"
      && Boolean(string(payload.nodeId));
  });
}
