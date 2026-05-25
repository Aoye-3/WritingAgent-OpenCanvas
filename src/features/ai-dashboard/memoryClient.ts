import { apiDelete, apiGet, apiPut } from "../../shared/apiClient";
import type { AgentRuntimeMemoryState } from "./types";

export function fetchAgentRuntimeMemory() {
  return apiGet<AgentRuntimeMemoryState>("/api/agent-runtime/memory");
}

export function saveAgentRuntimeMemory(content: string) {
  return apiPut<AgentRuntimeMemoryState>("/api/agent-runtime/memory", { content });
}

export function clearAgentRuntimeMemory() {
  return apiDelete<AgentRuntimeMemoryState>("/api/agent-runtime/memory");
}
