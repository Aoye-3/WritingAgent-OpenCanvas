import { apiGet } from "../../shared/apiClient";
import type { AgentBackendDashboard } from "./types";

export function fetchAgentRuntimeDashboard() {
  return apiGet<AgentBackendDashboard>("/api/agent-runtime/dashboard");
}
