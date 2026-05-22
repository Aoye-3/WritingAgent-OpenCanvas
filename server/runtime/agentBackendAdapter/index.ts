import type { AgentRuntimePort, AgentRuntimeRunInput } from "../agentRuntimePort.js";
import { runAgentBackendGeneration, type AgentBackendRunnerDeps } from "../../services/generation/agentBackendRunner.js";
import { getAgentBackendDashboard } from "./dashboard.js";
import { getAgentBackendConfigOverview } from "./proxy.js";
import { getAgentBackendRuntimeStatus } from "./status.js";

export function createAgentBackendRuntimePort(deps: AgentBackendRunnerDeps = {}): AgentRuntimePort {
  return {
    providerId: "agent-backend",
    run: (input: AgentRuntimeRunInput) => runAgentBackendGeneration(input, deps),
    getStatus: () => getAgentBackendRuntimeStatus(),
    getConfigOverview: () => getAgentBackendConfigOverview(),
    getDashboard: ({ agentRuntime }) => getAgentBackendDashboard({ agentRuntime })
  };
}
