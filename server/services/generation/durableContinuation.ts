import type { GenerateRequest } from "../../contracts/generation.js";
import type { DurableContinuationDescriptor, StoredDurableContinuation } from "../../storageTypes.js";
import { isCanvasWorkflowMode } from "../../../shared/canvasWorkflow.js";

const durableContinuationMetadata = Symbol("durableContinuationMetadata");

type DurableServerContextKey =
  | "agentIntake"
  | "taskHandlingPolicy"
  | "progressiveCanvasDelivery"
  | "ordinaryClarificationIntake"
  | "facetwrite_clarification_policy";

type DurableContinuationMetadata = {
  deliveryId?: string;
  claimToken?: string;
  visibleUserMessage?: string;
  descriptor?: DurableContinuationDescriptor;
  serverSafeContext?: Partial<Record<DurableServerContextKey, unknown>>;
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

const taskHandlingKinds = ["simple_chat", "plan_intake", "long_task", "explicit_canvas", "plan_execution"] as const;
const canvasDeliveryModes = ["none", "progressive", "explicit"] as const;
const runtimeBudgetProfiles = ["low", "medium", "high"] as const;
const progressiveTriggers = ["direct_canvas_intent", "skill_long_task", "thinking_long_task", "orchestration_canvas_required", "tool_event_long_task"] as const;

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

export function withServerDurableContinuationContext(
  payload: GenerateRequest,
  key: DurableServerContextKey,
  value: unknown
): GenerateRequest {
  const current = metadata(payload);
  return withMetadata(payload, {
    ...current,
    serverSafeContext: {
      ...current.serverSafeContext,
      [key]: value
    }
  });
}

export function isServerDurableContinuationContext(
  payload: GenerateRequest,
  key: DurableServerContextKey,
  value: unknown
) {
  const current = metadata(payload);
  return current.serverSafeContext?.[key] === value
    || current.descriptor?.safeContext?.[key] === value;
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
  const currentMetadata = metadata(payload);
  const safeContext = pickDurableSafeContext({
    ...currentMetadata.descriptor?.safeContext,
    ...currentMetadata.serverSafeContext
  });
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
  const planExecution = readRecord(context.planExecution);
  const typedPlanExecution = Boolean(readNonemptyString(planExecution.planId) && readNonemptyString(planExecution.stepId));
  const executionContinuation = payload.planPhase === "execution" || typedPlanExecution;
  return Boolean(
    isRecord(context.agentClarification)
    || isRecord(context.awaitingPlan)
    || (isRecord(context.planExecution) && !executionContinuation)
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

function pickDurableSafeContext(context: Record<string, unknown>) {
  const safe: Record<string, Record<string, unknown>> = {};
  const agentIntake = pickAgentIntake(context.agentIntake);
  const taskHandlingPolicy = pickTaskHandlingPolicy(context.taskHandlingPolicy);
  const progressiveCanvasDelivery = pickProgressiveCanvasDelivery(context.progressiveCanvasDelivery);
  const ordinaryClarificationIntake = pickOrdinaryClarificationIntake(context.ordinaryClarificationIntake);
  const skillClarificationPolicy = pickSkillClarificationPolicy(context.facetwrite_clarification_policy);
  if (agentIntake) safe.agentIntake = agentIntake;
  if (taskHandlingPolicy) safe.taskHandlingPolicy = taskHandlingPolicy;
  if (progressiveCanvasDelivery) safe.progressiveCanvasDelivery = progressiveCanvasDelivery;
  if (ordinaryClarificationIntake) safe.ordinaryClarificationIntake = ordinaryClarificationIntake;
  if (skillClarificationPolicy) safe.facetwrite_clarification_policy = skillClarificationPolicy;
  return safe;
}

function pickAgentIntake(value: unknown) {
  const source = readRecord(value);
  return source.phase === "execution" && source.completed === true
    ? { phase: "execution", completed: true }
    : undefined;
}

function pickTaskHandlingPolicy(value: unknown) {
  const source = readRecord(value);
  const kind = readEnum(source.kind, taskHandlingKinds);
  const canvasDeliveryMode = readEnum(source.canvasDeliveryMode, canvasDeliveryModes);
  const allowPlan = readBoolean(source.allowPlan);
  return compactRecord({ kind, canvasDeliveryMode, allowPlan });
}

function pickProgressiveCanvasDelivery(value: unknown) {
  const source = readRecord(value);
  return compactRecord({
    enabled: readBoolean(source.enabled),
    runtimeBudgetProfile: readEnum(source.runtimeBudgetProfile, runtimeBudgetProfiles),
    recursionLimit: readPositiveInteger(source.recursionLimit),
    modelCallLimit: readPositiveInteger(source.modelCallLimit),
    evidenceToolLimit: readPositiveInteger(source.evidenceToolLimit),
    bodyDraftWriteLimit: readPositiveInteger(source.bodyDraftWriteLimit),
    synthesisReserveSteps: readPositiveInteger(source.synthesisReserveSteps),
    forceSynthesisAfterEvidence: readBoolean(source.forceSynthesisAfterEvidence),
    evidenceTools: readStringArray(source.evidenceTools),
    trigger: readEnum(source.trigger, progressiveTriggers)
  });
}

function pickOrdinaryClarificationIntake(value: unknown) {
  const source = readRecord(value);
  return compactRecord({
    mode: readEnum(source.mode, ["ordinary"] as const),
    state: readEnum(source.state, ["collecting", "completed"] as const),
    maxRounds: readNonnegativeInteger(source.maxRounds),
    minAnsweredRoundsAfterFirstAsk: readNonnegativeInteger(source.minAnsweredRoundsAfterFirstAsk),
    answeredRounds: readNonnegativeInteger(source.answeredRounds),
    remainingRounds: readNonnegativeInteger(source.remainingRounds),
    answeredSummary: readString(source.answeredSummary)
  });
}

function pickSkillClarificationPolicy(value: unknown) {
  const source = readRecord(value);
  return compactRecord({
    mode: readEnum(source.mode, ["skill_scope_guard"] as const),
    intakeState: readEnum(source.intakeState, ["intake_collecting"] as const),
    intakeRound: readPositiveInteger(source.intakeRound),
    maxIntakeRounds: readPositiveInteger(source.maxIntakeRounds),
    answeredSummary: readString(source.answeredSummary),
    answeredSlots: readStringArray(source.answeredSlots),
    missingSlots: readStringArray(source.missingSlots),
    allowEvidenceTools: readBoolean(source.allowEvidenceTools),
    skillRefs: readStringArray(source.skillRefs),
    disabledSkillRefs: readStringArray(source.disabledSkillRefs),
    runtimeBudgetProfile: readEnum(source.runtimeBudgetProfile, runtimeBudgetProfiles)
  });
}

function compactRecord(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function readEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNonemptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length ? strings : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
