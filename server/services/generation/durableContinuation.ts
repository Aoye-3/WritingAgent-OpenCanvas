import type { GenerateRequest } from "../../contracts/generation.js";
import type { DurableContinuationDescriptor, StoredDurableContinuation } from "../../storageTypes.js";
import { isCanvasWorkflowMode } from "../../../shared/canvasWorkflow.js";

const durableContinuationMetadata = Symbol("durableContinuationMetadata");

type DurableContinuationMetadata = {
  deliveryId?: string;
  claimToken?: string;
  visibleUserMessage?: string;
  descriptor?: DurableContinuationDescriptor;
};

type InternalGenerateRequest = GenerateRequest & {
  [durableContinuationMetadata]?: DurableContinuationMetadata;
};

type DurableContinuationStorage = {
  readDurableContinuation: (threadId: string) => Pick<StoredDurableContinuation, "state" | "descriptor" | "sourceRunId"> | undefined;
  claimDurableContinuation: (threadId: string) => Pick<StoredDurableContinuation, "state" | "descriptor" | "sourceRunId" | "claimToken" | "attempts">;
  supersedeDurableContinuation: (threadId: string) => boolean;
  failDurableContinuation: (threadId: string, claimToken: string, error: string) => boolean;
  readDurableContinuationCanvas: (projectId: string) => Record<string, unknown>;
  listDurableContinuationEvidence?: (threadId: string, sourceRunId: string | undefined, deliveryId: string) => unknown[];
};

const safeContextKeys = [
  "agentIntake",
  "ordinaryClarificationIntake",
  "facetwrite_clarification_policy",
  "taskHandlingPolicy",
  "taskComplexity",
  "progressiveCanvasDelivery",
  "orchestrationPolicy",
  "agentPlan",
  "awaitingPlan",
  "planExecution",
  "runtimeBudgetProfile",
  "autoPreflightPlan"
] as const;

const safeContextFields: Partial<Record<(typeof safeContextKeys)[number], ReadonlySet<string>>> = {
  agentIntake: new Set(["phase", "completed"]),
  ordinaryClarificationIntake: new Set(["mode", "state", "maxRounds", "minAnsweredRoundsAfterFirstAsk", "answeredRounds", "remainingRounds", "answeredSummary"]),
  facetwrite_clarification_policy: new Set(["mode", "skillName", "skillRefs", "disabledSkillRefs", "answeredSlots", "answeredSummary", "intakeState", "intakeRound"]),
  taskHandlingPolicy: new Set(["kind", "canvasDeliveryMode", "allowPlan"]),
  taskComplexity: new Set(["requiresAgentPlan", "score", "reasons"]),
  progressiveCanvasDelivery: new Set(["enabled", "runtimeBudgetProfile", "recursionLimit", "modelCallLimit", "evidenceToolLimit", "bodyDraftWriteLimit", "synthesisReserveSteps", "forceSynthesisAfterEvidence", "evidenceTools", "trigger"]),
  orchestrationPolicy: new Set(["mode", "trigger", "clarificationPolicy", "deliveryPolicy"]),
  agentPlan: new Set(["id", "stepId", "origin", "phase", "stepBudget"]),
  awaitingPlan: new Set(["id", "selectedOptionId", "answer", "option"]),
  planExecution: new Set(["planId", "stepId"]),
  autoPreflightPlan: new Set(["enabled"])
};

const unsafeKey = /(?:durableContinuation|runtimeResume|checkpoint|claimToken|credential|interrupt)/i;

export function isStandaloneDurableContinuationIntent(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLocaleLowerCase().replace(/[.!?。！？…,:;，：；]+$/u, "").trim();
  return normalized === "继续"
    || normalized === "接着做"
    || normalized === "继续执行"
    || normalized === "continue"
    || normalized === "go on"
    || normalized === "resume";
}

export function withDurableContinuationDelivery(payload: GenerateRequest, deliveryId: string): GenerateRequest {
  return withMetadata(payload, { ...metadata(payload), deliveryId });
}

export function durableContinuationDeliveryId(payload: GenerateRequest) {
  return metadata(payload).descriptor?.deliveryId ?? metadata(payload).deliveryId;
}

export function durableContinuationClaim(payload: GenerateRequest) {
  const current = metadata(payload);
  return current.claimToken && current.visibleUserMessage !== undefined && current.descriptor
    ? { claimToken: current.claimToken, visibleUserMessage: current.visibleUserMessage, descriptor: current.descriptor }
    : undefined;
}

export function createDurableContinuationDescriptor(payload: GenerateRequest): DurableContinuationDescriptor {
  const instruction = payload.chatInstruction?.trim() || payload.freeTextPrompt?.trim() || "";
  const contextValues = readRecord(payload.contextValues);
  const canvas = readRecord(contextValues.canvas);
  const workflow = readRecord(canvas.workflow);
  const deliveryId = durableContinuationDeliveryId(payload);
  if (!instruction || !payload.agentCardId || !payload.projectId || !deliveryId) {
    throw new Error("durable_continuation_descriptor_incomplete");
  }
  const safeContext = Object.fromEntries(safeContextKeys.flatMap((key) => {
    const sanitized = sanitizeSafeContextField(key, contextValues[key]);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
  const phase = payload.planGeneration?.phase ?? payload.planPhase;
  const planId = payload.planGeneration?.planId ?? payload.planId;
  const stepId = payload.planGeneration?.stepId ?? payload.stepId;
  return {
    version: 1,
    resolvedInstruction: instruction,
    agentCardId: payload.agentCardId,
    projectId: payload.projectId,
    ...(payload.transientSkillRefs?.length ? { transientSkillRefs: [...payload.transientSkillRefs] } : {}),
    ...(payload.disabledSkillRefs?.length ? { disabledSkillRefs: [...payload.disabledSkillRefs] } : {}),
    ...(payload.runtimeBudgetProfile ? { runtimeBudgetProfile: payload.runtimeBudgetProfile } : {}),
    ...(payload.modelOverrides ? { modelOverrides: { ...payload.modelOverrides } } : {}),
    ...(phase && planId ? {
      plan: {
        phase,
        planId,
        ...(stepId ? { stepId } : {}),
        ...(payload.planGeneration?.phaseAttemptId ? { phaseAttemptId: payload.planGeneration.phaseAttemptId } : {}),
        ...(payload.planGeneration?.executionVersion !== undefined ? { executionVersion: payload.planGeneration.executionVersion } : {})
      }
    } : {}),
    deliveryId,
    workflowMode: isCanvasWorkflowMode(workflow.mode) ? workflow.mode : "batch_delivery",
    ...(payload.selectedCanvasNodeId ? { selectedCanvasNodeId: payload.selectedCanvasNodeId } : {}),
    ...(Object.keys(safeContext).length ? { safeContext } : {})
  };
}

function sanitizeSafeContextField(key: (typeof safeContextKeys)[number], value: unknown) {
  if (key === "runtimeBudgetProfile") return value === "low" || value === "medium" || value === "high" ? value : undefined;
  if (!isRecord(value)) return undefined;
  const allowed = safeContextFields[key];
  if (!allowed) return undefined;
  const selected = Object.fromEntries(Object.entries(value).filter(([field]) => allowed.has(field)));
  return Object.keys(selected).length ? sanitizeSafeValue(selected, 0) : undefined;
}

export function resolveDurableContinuationRequest(
  storage: DurableContinuationStorage,
  threadId: string,
  input: GenerateRequest
): { payload: GenerateRequest; claimed: boolean } {
  const literalInstruction = input.chatInstruction ?? input.freeTextPrompt ?? "";
  const sanitizedInput = withoutClientDurableContinuation(input);
  if (isProtectedContinuationRequest(sanitizedInput)) return { payload: sanitizedInput, claimed: false };

  const active = storage.readDurableContinuation(threadId);
  if (active?.state === "claimed") storage.claimDurableContinuation(threadId);

  if (!isStandaloneDurableContinuationIntent(literalInstruction)) {
    if (literalInstruction.trim()) storage.supersedeDurableContinuation(threadId);
    return { payload: sanitizedInput, claimed: false };
  }

  if (!active || (active.state !== "ready" && active.state !== "failed")) {
    return { payload: sanitizedInput, claimed: false };
  }
  const claim = storage.claimDurableContinuation(threadId);
  if (!claim.claimToken) throw new Error("durable_continuation_claim_token_missing");
  try {
    const descriptor = claim.descriptor;
    const currentCanvas = storage.readDurableContinuationCanvas(descriptor.projectId);
    const currentWorkflow = readRecord(currentCanvas.workflow);
    const canvas = {
      ...currentCanvas,
      deliveryId: descriptor.deliveryId,
      ...(descriptor.selectedCanvasNodeId ? { selectedCanvasNodeId: descriptor.selectedCanvasNodeId } : {}),
      workflow: { ...currentWorkflow, mode: descriptor.workflowMode }
    };
    const evidence = storage.listDurableContinuationEvidence?.(threadId, claim.sourceRunId, descriptor.deliveryId) ?? [];
    const contextValues = {
      ...(descriptor.safeContext ?? {}),
      canvas,
      ...(evidence.length ? { durableContinuationEvidence: evidence } : {})
    };
    const planGeneration = descriptor.plan?.phaseAttemptId ? {
      phase: descriptor.plan.phase,
      planId: descriptor.plan.planId,
      ...(descriptor.plan.stepId ? { stepId: descriptor.plan.stepId } : {}),
      phaseAttemptId: descriptor.plan.phaseAttemptId,
      ...(descriptor.plan.executionVersion !== undefined ? { executionVersion: descriptor.plan.executionVersion } : {})
    } : undefined;
    const restored: GenerateRequest = {
      mode: "chat",
      locale: sanitizedInput.locale,
      threadId,
      chatInstruction: descriptor.resolvedInstruction,
      agentCardId: descriptor.agentCardId,
      projectId: descriptor.projectId,
      contextValues,
      ...(descriptor.transientSkillRefs ? { transientSkillRefs: [...descriptor.transientSkillRefs] } : {}),
      ...(descriptor.disabledSkillRefs ? { disabledSkillRefs: [...descriptor.disabledSkillRefs] } : {}),
      ...(descriptor.runtimeBudgetProfile ? { runtimeBudgetProfile: descriptor.runtimeBudgetProfile } : {}),
      ...(descriptor.modelOverrides ? { modelOverrides: { ...descriptor.modelOverrides } } : {}),
      ...(descriptor.selectedCanvasNodeId ? { selectedCanvasNodeId: descriptor.selectedCanvasNodeId } : {}),
      ...(descriptor.plan ? {
        planPhase: descriptor.plan.phase,
        planId: descriptor.plan.planId,
        ...(descriptor.plan.stepId ? { stepId: descriptor.plan.stepId } : {})
      } : {}),
      ...(planGeneration ? { planGeneration } : {})
    };
    return {
      payload: withMetadata(restored, {
        deliveryId: descriptor.deliveryId,
        claimToken: claim.claimToken,
        visibleUserMessage: literalInstruction,
        descriptor
      }),
      claimed: true
    };
  } catch (error) {
    storage.failDurableContinuation(
      threadId,
      claim.claimToken,
      error instanceof Error ? error.message : "durable_continuation_restore_failed"
    );
    throw error;
  }
}

function withoutClientDurableContinuation(payload: GenerateRequest): GenerateRequest {
  const contextValues = { ...readRecord(payload.contextValues) };
  delete contextValues.durableContinuation;
  return { ...payload, contextValues };
}

function isProtectedContinuationRequest(payload: GenerateRequest) {
  const context = readRecord(payload.contextValues);
  return Boolean(
    isRecord(context.agentClarification)
    || isRecord(context.awaitingPlan)
    || isRecord(context.planExecution)
    || isRecord(context.queuedIntervention)
    || isRecord(context.finalSupplementFeedback)
    || payload.planPhase === "intake"
    || payload.planPhase === "revise"
    || payload.planPhase === "preflight"
  );
}

function metadata(payload: GenerateRequest) {
  return (payload as InternalGenerateRequest)[durableContinuationMetadata] ?? {};
}

function withMetadata(payload: GenerateRequest, value: DurableContinuationMetadata): GenerateRequest {
  const restored = { ...payload } as InternalGenerateRequest;
  Object.defineProperty(restored, durableContinuationMetadata, { value, enumerable: true });
  return restored;
}

function sanitizeSafeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSafeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (unsafeKey.test(key)) return [];
    const sanitized = sanitizeSafeValue(entry, depth + 1);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
