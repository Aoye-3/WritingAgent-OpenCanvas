import type { AgentRuntimePort, AgentRuntimeRunInput } from "../../runtime/agentRuntimePort.js";

export type AgentRuntimeRunnerInput = AgentRuntimeRunInput;

export async function runAgentRuntimeGeneration(input: AgentRuntimeRunnerInput, runtime?: AgentRuntimePort) {
  if (!runtime) return undefined;
  const run = await runtime.run(input);
  if (!run) return undefined;
  if (!run.text) {
    throw new Error("Agent Runtime returned an empty response");
  }
  return run;
}
