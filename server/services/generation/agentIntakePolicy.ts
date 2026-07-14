import type { GenerateRequest } from "../../contracts/generation.js";
import { sanitizeCanvasForAgentIntake } from "../../../shared/agentIntakeCanvas.js";
import { isServerDurableContinuationContext, withServerDurableContinuationContext } from "./durableContinuation.js";

export const AGENT_INTAKE_TOOL_REFS = ["ask_clarification", "agent_intake_complete"] as const;
export const SKILL_SCOPE_GUARD_TOOL_REFS = ["ask_clarification"] as const;

export function isAgentIntakePhase(payload: GenerateRequest) {
  if (readRecord(payload.contextValues?.finalSupplementFeedback).action === "execute") return false;
  if (isAgentIntakeExecution(payload.contextValues)) return false;
  if (isPlanGenerationPhase(payload)) return false;
  if (isSkillClarificationGuarded(payload)) return true;
  if (isOrdinaryClarificationIntakeCollecting(payload.contextValues)) return true;
  if (hasAnsweredAgentClarification(payload.contextValues)) return false;
  if (isRecord(payload.contextValues?.agentClarification)) return true;
  if ((payload.transientSkillRefs ?? []).length > 0) return true;
  if (isProgressiveCanvasDelivery(payload)) return true;
  return Boolean(payload.contextValues?.facetwrite_clarification_policy);
}

export function withAgentIntakeExecutionPhase(payload: GenerateRequest): GenerateRequest {
  const ordinaryClarificationIntake = payload.contextValues?.ordinaryClarificationIntake;
  const hasTrustedOrdinaryIntake = isOrdinaryClarificationIntake(payload.contextValues)
    && isServerDurableContinuationContext(payload, "ordinaryClarificationIntake", ordinaryClarificationIntake);
  const executionPayload: GenerateRequest = {
    ...payload,
    contextValues: {
      ...payload.contextValues,
      agentIntake: {
        ...readRecord(payload.contextValues?.agentIntake),
        phase: "execution",
        completed: true
      },
      ...(hasTrustedOrdinaryIntake
        ? {
          ordinaryClarificationIntake: {
            ...readRecord(payload.contextValues?.ordinaryClarificationIntake),
            mode: "ordinary",
            state: "completed"
          }
        }
        : {})
    }
  };
  const markedExecutionPayload = withServerDurableContinuationContext(
    executionPayload,
    "agentIntake",
    executionPayload.contextValues?.agentIntake
  );
  return hasTrustedOrdinaryIntake
    ? withServerDurableContinuationContext(
      markedExecutionPayload,
      "ordinaryClarificationIntake",
      executionPayload.contextValues?.ordinaryClarificationIntake
    )
    : markedExecutionPayload;
}

export function withSanitizedAgentIntakeCanvas(payload: GenerateRequest): GenerateRequest {
  if (!isAgentIntakePhase(payload)) return payload;
  const contextValues = payload.contextValues ?? {};
  const policy = readRecord(contextValues.facetwrite_clarification_policy);
  const sanitizedPolicyCanvas = sanitizeCanvasForAgentIntake(policy.canvas);
  const sanitizedPolicy = Object.keys(policy).length
    ? {
      ...policy,
      ...("canvas" in policy && Object.keys(sanitizedPolicyCanvas).length ? { canvas: sanitizedPolicyCanvas } : {})
    }
    : policy;
  const sanitizedCanvas = sanitizeCanvasForAgentIntake(contextValues.canvas);
  return {
    ...payload,
    contextValues: {
      ...contextValues,
      ...(Object.keys(sanitizedCanvas).length ? { canvas: sanitizedCanvas } : {}),
      ...(Object.keys(sanitizedPolicy).length ? { facetwrite_clarification_policy: sanitizedPolicy } : {})
    }
  };
}

export function isSkillClarificationGuarded(payload: GenerateRequest) {
  const policy = readRecord(payload.contextValues?.facetwrite_clarification_policy);
  return policy.mode === "skill_scope_guard";
}

export function agentIntakeToolRefsForPayload(payload: GenerateRequest) {
  if (isSkillClarificationGuarded(payload)) return [...SKILL_SCOPE_GUARD_TOOL_REFS];
  const ordinaryIntake = readOrdinaryClarificationIntake(payload.contextValues);
  if (ordinaryIntake?.state === "collecting") {
    if (ordinaryIntake.remainingRounds <= 0) {
      return ["agent_intake_complete"];
    }
    if (ordinaryIntake.answeredRounds >= ordinaryIntake.minAnsweredRoundsAfterFirstAsk) {
      return [...AGENT_INTAKE_TOOL_REFS];
    }
    if (ordinaryIntake.answeredRounds > 0) {
      return ["ask_clarification"];
    }
  }
  return [...AGENT_INTAKE_TOOL_REFS];
}

export function isProgressiveCanvasDelivery(payload: GenerateRequest) {
  const delivery = readRecord(payload.contextValues?.progressiveCanvasDelivery);
  return delivery.enabled === true;
}

export function isAgentIntakeExecution(contextValues: GenerateRequest["contextValues"]) {
  const intake = readRecord(contextValues?.agentIntake);
  return intake.phase === "execution" || intake.completed === true;
}

export function hasAnsweredAgentClarification(contextValues: GenerateRequest["contextValues"]) {
  const clarification = readRecord(contextValues?.agentClarification);
  const option = readRecord(clarification.option);
  return Boolean(
    readString(clarification.answer)
    || readString(clarification.selectedOptionId)
    || readString(option.id)
    || readString(option.label)
  );
}

export function isOrdinaryClarificationIntakeCollecting(contextValues: GenerateRequest["contextValues"]) {
  return readOrdinaryClarificationIntake(contextValues)?.state === "collecting";
}

export function ordinaryClarificationIntakeCanComplete(contextValues: GenerateRequest["contextValues"]) {
  const intake = readOrdinaryClarificationIntake(contextValues);
  if (!intake || intake.state !== "collecting") return true;
  return intake.answeredRounds === 0
    || intake.answeredRounds >= intake.minAnsweredRoundsAfterFirstAsk
    || intake.remainingRounds <= 0;
}

function isOrdinaryClarificationIntake(contextValues: GenerateRequest["contextValues"]) {
  return readRecord(contextValues?.ordinaryClarificationIntake).mode === "ordinary";
}

function readOrdinaryClarificationIntake(contextValues: GenerateRequest["contextValues"]) {
  const intake = readRecord(contextValues?.ordinaryClarificationIntake);
  if (intake.mode !== "ordinary") return undefined;
  return {
    state: intake.state === "completed" ? "completed" as const : "collecting" as const,
    answeredRounds: readNonNegativeInteger(intake.answeredRounds),
    remainingRounds: readNonNegativeInteger(intake.remainingRounds),
    minAnsweredRoundsAfterFirstAsk: readPositiveInteger(intake.minAnsweredRoundsAfterFirstAsk) || 2
  };
}

function isPlanGenerationPhase(payload: GenerateRequest) {
  if (payload.planPhase) return true;
  if (isRecord(payload.planGeneration)) return true;
  return isRecord(payload.contextValues?.planGeneration);
}

function readRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : undefined;
  return typeof number === "number" && Number.isInteger(number) && number >= 0 ? number : 0;
}

function readPositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : undefined;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
