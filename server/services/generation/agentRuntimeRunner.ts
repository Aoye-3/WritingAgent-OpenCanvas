import type { AgentRuntimePort, AgentRuntimeRunInput, AgentRuntimeRunResult } from "../../runtime/agentRuntimePort.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";

export type AgentRuntimeRunnerInput = AgentRuntimeRunInput;

export async function runAgentRuntimeGeneration(input: AgentRuntimeRunnerInput, runtime?: AgentRuntimePort) {
  if (!runtime) return undefined;
  const run = await runtime.run(input);
  if (!run) return undefined;
  const phase = resolvePlanRequestPolicy(input.payload).phase;
  const canvasActionRequired = input.payload.canvasAction?.requiresTool === true;
  if (phase === "planning" && !hasExpectedPlanningEvent(run.events, input.payload.contextValues)) {
    throw new Error("Plan planning phase completed without the required stage submission.");
  }
  if (phase === "execution" && !hasStructuredPlanEvent(run.events)) {
    throw new Error("Plan execution phase completed without a Plan or Artifact state update. The model did not advance the current step.");
  }
  if (phase === "execution" && !hasCommittedArtifact(run.events) && !hasExecutionInterruption(run.events)) {
    throw new Error("Plan execution phase completed without committing a Canvas artifact. Each successful step must persist its output to Canvas.");
  }
  if (phase === "chat" && canvasActionRequired && !hasCanvasWriteResult(run.events)) {
    throw new Error("Canvas action completed without a committed node or pending approval request.");
  }
  if (!run.text && !hasStructuredLifecycleEvent(run.events)) {
    throw new Error("Agent Runtime completed with no visible assistant text or structured lifecycle events");
  }
  return run;
}

function hasCanvasWriteResult(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)canvas_(?:mutation_committed|write_pending_approval|mutation_failed)$/.test(event.eventType));
}

function hasStructuredPlanEvent(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)(?:plan|artifact)_/.test(event.eventType));
}

function hasStructuredLifecycleEvent(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)(?:plan|artifact|canvas)_/.test(event.eventType));
}

function hasExpectedPlanningEvent(events: AgentRuntimeRunResult["events"], contextValues?: Record<string, unknown>) {
  const awaitingPlan = contextValues?.awaitingPlan;
  const isContinuation = Boolean(awaitingPlan && typeof awaitingPlan === "object" && !Array.isArray(awaitingPlan) && "id" in awaitingPlan);
  return events.some((event) => isContinuation
    ? /(?:^|_)plan_updated$/.test(event.eventType)
    : /(?:^|_)plan_waiting_for_user$/.test(event.eventType));
}

function hasCommittedArtifact(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)artifact_committed$/.test(event.eventType));
}

function hasExecutionInterruption(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)plan_(?:waiting_for_user|failed)$/.test(event.eventType));
}
