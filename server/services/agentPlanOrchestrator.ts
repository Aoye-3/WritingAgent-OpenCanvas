import type { GenerateRequest } from "../contracts/generation.js";
import type { ProjectRuntimeSettings, SQLiteStorageRepository } from "../storage.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import { resolveTaskComplexity, type ComplexityDecision } from "./generation/taskComplexityPolicy.js";
import { shouldAutoPreflightPlan } from "./generation/taskHandlingPolicy.js";
import { PlanOrchestrator } from "./planOrchestrator.js";

export class AgentPlanOrchestrator {
  private readonly legacy: PlanOrchestrator;

  constructor(private readonly storage: SQLiteStorageRepository) {
    this.legacy = new PlanOrchestrator(storage);
  }

  prepareAutoPreflight(threadId: string, payload: GenerateRequest, projectSettings: ProjectRuntimeSettings): GenerateRequest {
    const decision = resolveTaskComplexity({
      payload,
      transientSkillCount: payload.transientSkillRefs?.length ?? 0,
      thinkingMode: payload.modelOverrides?.thinkingMode
    });
    if (!shouldAutoPreflightPlan({
      payload,
      transientSkillCount: payload.transientSkillRefs?.length ?? 0,
      thinkingMode: payload.modelOverrides?.thinkingMode
    })) {
      return withComplexityDecision(payload, decision);
    }

    const instruction = payload.chatInstruction || payload.freeTextPrompt || "Plan the task";
    const plan = this.storage.createPlanIntake(threadId, {
      title: "Task plan",
      goal: instruction,
      origin: "auto_complex_task",
      complexity: decision,
      budget: planBudget(projectSettings, decision),
      preflight: publicPreflightSummary(instruction, decision)
    });
    return {
      ...withComplexityDecision(payload, decision),
      planPhase: "preflight",
      planId: plan.id,
      contextValues: {
        ...payload.contextValues,
        taskComplexity: decision,
        agentPlan: {
          id: plan.id,
          origin: "auto_complex_task",
          phase: "preflight"
        },
        autoPreflightPlan: {
          id: plan.id,
          trigger: "complex_task",
          requiresApproval: false
        }
      }
    };
  }

  prepare(threadId: string, payload: GenerateRequest) {
    this.legacy.prepare(threadId, payload);
  }

  observe(threadId: string, event: ToolEventRecord) {
    this.legacy.observe(threadId, event);
  }

  complete(threadId: string, payload: GenerateRequest, events: ToolEventRecord[] = []) {
    this.legacy.complete(threadId, payload, events);
  }

  assertPostcondition(threadId: string, payload: GenerateRequest, events: ToolEventRecord[] = []) {
    try {
      this.legacy.assertPostcondition(threadId, payload, events);
    } catch (error) {
      if (!this.persistProtocolRecovery(threadId, payload, error)) throw error;
    }
  }

  fail(threadId: string, payload: GenerateRequest, error: unknown) {
    this.legacy.fail(threadId, payload, error);
  }

  private persistProtocolRecovery(threadId: string, payload: GenerateRequest, error: unknown) {
    const generation = payload.planGeneration;
    if (!generation) return false;
    const message = error instanceof Error ? error.message.slice(0, 240) : "Plan protocol state was not persisted.";
    const plan = this.storage.getPlanRun(threadId, generation.planId);
    if (!plan) return false;
    this.storage.recordPlanActivity(threadId, plan.id, {
      stepId: generation.stepId,
      type: "plan_failed",
      status: "needs_recovery",
      summary: message,
      detail: {
        phase: generation.phase,
        phaseAttemptId: generation.phaseAttemptId,
        recovery: true
      }
    });
    this.storage.setPlanRunStatus(threadId, plan.id, "failed", message);
    return true;
  }
}

function withComplexityDecision(payload: GenerateRequest, decision: ComplexityDecision): GenerateRequest {
  return {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      taskComplexity: decision
    }
  };
}

function publicPreflightSummary(instruction: string, decision: ComplexityDecision) {
  return {
    summary: instruction.slice(0, 240),
    signals: decision.signals,
    recommendedStepCount: decision.recommendedStepCount,
    needsClarification: false
  };
}

function planBudget(settings: ProjectRuntimeSettings, decision: ComplexityDecision) {
  const stepCount = decision.recommendedStepCount ?? 3;
  return {
    profile: settings.runtimeBudgetProfile,
    plan: {
      modelCallLimit: settings.modelCallLimit,
      evidenceToolLimit: settings.evidenceToolLimit,
      recursionLimit: settings.recursionLimit
    },
    step: {
      modelCallLimit: Math.max(1, Math.floor(settings.modelCallLimit / stepCount)),
      evidenceToolLimit: Math.max(1, Math.floor(settings.evidenceToolLimit / stepCount)),
      recursionLimit: Math.max(10, Math.floor(settings.recursionLimit / stepCount))
    }
  };
}
