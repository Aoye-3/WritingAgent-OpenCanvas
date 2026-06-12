import type { AgentRuntimePort, AgentRuntimeRunInput, AgentRuntimeRunResult } from "../../runtime/agentRuntimePort.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";

export type AgentRuntimeRunnerInput = AgentRuntimeRunInput;

export async function runAgentRuntimeGeneration(input: AgentRuntimeRunnerInput, runtime?: AgentRuntimePort) {
  if (!runtime) return undefined;
  const run = await runtime.run(input);
  if (!run) return undefined;
  const phase = resolvePlanRequestPolicy(input.payload).phase;
  if (phase === "planning" && !hasPlanEvent(run.events)) {
    throw new Error("Plan planning phase completed without a Plan state update. The model returned text instead of calling plan_update.");
  }
  if (phase === "execution" && !hasStructuredPlanEvent(run.events)) {
    throw new Error("Plan execution phase completed without a Plan or Artifact state update. The model did not advance the current step.");
  }
  if (phase === "execution" && !hasCommittedArtifact(run.events) && !hasExecutionInterruption(run.events)) {
    throw new Error("Plan execution phase completed without committing a Canvas artifact. Each successful step must persist its output to Canvas.");
  }
  if (!run.text && !hasStructuredPlanEvent(run.events)) throw new Error("Agent Runtime completed with no visible assistant text or structured Plan events");
  return run;
}

function hasStructuredPlanEvent(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)(?:plan|artifact)_/.test(event.eventType));
}

function hasPlanEvent(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)plan_/.test(event.eventType));
}

function hasCommittedArtifact(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)artifact_committed$/.test(event.eventType));
}

function hasExecutionInterruption(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)plan_(?:waiting_for_user|failed)$/.test(event.eventType));
}
