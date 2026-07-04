import type { GenerateRequest, GenerateResponse } from "../contracts/generation.js";
import type { SQLiteStorageRepository } from "../storage.js";

type PlanExecutionStorage = Pick<SQLiteStorageRepository,
  "getPlanRun" | "getPlanExecution" | "claimPlanExecution" | "renewPlanExecutionLease" | "releasePlanExecutionLease" | "pausePlanRun">;

export class PlanExecutor {
  private readonly active = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: PlanExecutionStorage,
    private readonly generate: (payload: GenerateRequest) => Promise<Partial<Pick<GenerateResponse, "finishReason">> | unknown>,
    private readonly options: { heartbeatMs?: number } = {}
  ) {}

  wake(threadId: string, planId: string) {
    if (this.active.has(planId)) return;
    const work = this.run(threadId, planId).finally(() => this.active.delete(planId));
    this.active.set(planId, work);
  }

  async whenIdle(planId: string) {
    await this.active.get(planId);
  }

  private async run(threadId: string, planId: string) {
    const owner = `executor_${crypto.randomUUID()}`;
    if (!this.storage.claimPlanExecution(threadId, planId, owner)) return;
    const heartbeat = setInterval(() => {
      this.storage.renewPlanExecutionLease(threadId, planId, owner);
    }, this.options.heartbeatMs ?? 20_000);
    try {
      while (true) {
        const plan = this.storage.getPlanRun(threadId, planId);
        const execution = this.storage.getPlanExecution(threadId, planId);
        if (!plan || !execution || plan.status !== "running" || plan.approval !== "approved") return;
        const stepId = plan.currentStepId ?? execution.currentStepId;
        if (!stepId) return;
        const result = await this.generate({
          mode: "chat",
          locale: "en",
          threadId,
          projectId: plan.projectId,
          chatInstruction: `Continue approved plan ${plan.id}. Execute only step ${stepId}.`,
          planPhase: "execution",
          planId: plan.id,
          stepId,
          planGeneration: {
            phase: "execution",
            planId: plan.id,
            stepId,
            phaseAttemptId: `execution_${plan.executionVersion}_${stepId}_${execution.attempt}`,
            executionVersion: plan.executionVersion
          },
          contextValues: { planExecution: { planId: plan.id, stepId } }
        });
        if (isClarificationRequiredResult(result)) return;
      }
    } catch (error) {
      this.storage.pausePlanRun(threadId, planId, error instanceof Error ? error.message : "Plan execution paused");
    } finally {
      clearInterval(heartbeat);
      this.storage.releasePlanExecutionLease(threadId, planId, owner);
    }
  }
}

function isClarificationRequiredResult(value: unknown) {
  return Boolean(value && typeof value === "object" && "finishReason" in value && (value as { finishReason?: unknown }).finishReason === "clarification_required");
}
