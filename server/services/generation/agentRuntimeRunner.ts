import type { AgentRuntimePort, AgentRuntimeRunInput, AgentRuntimeRunResult } from "../../runtime/agentRuntimePort.js";
import { resolvePlanRequestPolicy } from "./planRequestPolicy.js";

export type AgentRuntimeRunnerInput = AgentRuntimeRunInput;

export async function runAgentRuntimeGeneration(input: AgentRuntimeRunnerInput, runtime?: AgentRuntimePort) {
  if (!runtime) return undefined;
  const run = await runtime.run(input);
  if (!run) return undefined;
  const phase = resolvePlanRequestPolicy(input.payload).phase;
  const canvasActionRequired = input.payload.canvasAction?.requiresTool === true;
  if (phase === "chat" && canvasActionRequired && !hasCanvasWriteResult(run.events)) {
    throw new Error("Canvas action completed without a committed node or pending approval request.");
  }
  if (phase === "chat" && !run.text && !hasStructuredLifecycleEvent(run.events)) {
    throw new Error("Agent Runtime completed with no visible assistant text or structured lifecycle events");
  }
  return run;
}

function hasCanvasWriteResult(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)canvas_(?:mutation_committed|write_pending_approval|mutation_failed)$/.test(event.eventType));
}

function hasStructuredLifecycleEvent(events: AgentRuntimeRunResult["events"]) {
  return events.some((event) => /(?:^|_)(?:plan|artifact|canvas)_/.test(event.eventType) || /agent_clarification_requested$/.test(event.eventType));
}
