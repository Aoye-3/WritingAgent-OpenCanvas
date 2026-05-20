import type { AgentRuntimePort } from "./agentRuntimePort.js";
import { createAgentBackendRuntimePort } from "./agentBackendAdapter/index.js";

export function createAgentRuntime(): AgentRuntimePort {
  return createAgentBackendRuntimePort();
}

export type { AgentRuntimePort, AgentRuntimeRunInput, AgentRuntimeRunResult } from "./agentRuntimePort.js";
