import { apiGet } from "../../shared/apiClient";
import type { DeerFlowDashboard } from "./types";

export function fetchDeerFlowDashboard() {
  return apiGet<DeerFlowDashboard>("/api/deerflow/dashboard");
}
