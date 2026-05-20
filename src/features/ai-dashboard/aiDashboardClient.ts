import { apiGet } from "../../shared/apiClient";
import type { AgentBackendDashboard } from "./types";

export function fetchAgentBackendDashboard() {
  return apiGet<AgentBackendDashboard>("/api/agent-backend/dashboard");
}
