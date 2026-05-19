import type {
  AgentCard,
  AgentRuntimeConfig,
  AgentSettings,
  ProjectSummary,
  SkillCatalogItem,
  StoredThread,
  ThreadCreateResponse,
  ThreadStateResponse,
  ToolCatalogItem
} from "./types";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../shared/apiClient";

export async function fetchAgentCards(): Promise<AgentCard[]> {
  const payload = await apiGet<{ agentCards: AgentCard[] }>("/api/agent-cards");
  return payload.agentCards;
}

export async function createThread(agentCardId: string): Promise<ThreadCreateResponse> {
  return apiPost<ThreadCreateResponse>("/api/threads", { agentCardId });
}

export async function fetchRecentThreads(): Promise<StoredThread[]> {
  const payload = await apiGet<{ threads: StoredThread[] }>("/api/threads/recent");
  return payload.threads;
}

export async function fetchProjects(trash = false): Promise<ProjectSummary[]> {
  const payload = await apiGet<{ projects: ProjectSummary[] }>(trash ? "/api/projects/trash" : "/api/projects");
  return payload.projects;
}

export async function moveThreadToTrash(threadId: string): Promise<void> {
  await apiPost<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/trash`);
}

export async function batchMoveThreadsToTrash(threadIds: string[]): Promise<void> {
  await apiPost<{ ok: true; movedCount: number }>("/api/threads/batch-trash", { threadIds });
}

export async function restoreThreadFromTrash(threadId: string): Promise<void> {
  await apiPost<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/restore`);
}

export async function hardDeleteThread(threadId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}`);
}

export async function batchHardDeleteThreads(threadIds: string[]): Promise<void> {
  await apiPost<{ ok: true; deletedCount: number }>("/api/threads/batch-delete", { threadIds });
}

export async function renameThread(threadId: string, title: string): Promise<StoredThread> {
  const payload = await apiPatch<{ thread: StoredThread }>(`/api/threads/${encodeURIComponent(threadId)}`, { title });
  return payload.thread;
}

export async function saveThreadInputs(threadId: string, structuredValues: Record<string, string | string[]>): Promise<Record<string, string | string[]>> {
  const payload = await apiPatch<{ structuredValues: Record<string, string | string[]> }>(`/api/threads/${encodeURIComponent(threadId)}/inputs`, { structuredValues });
  return payload.structuredValues;
}

export async function fetchAgentSettings(agentCardId: string): Promise<AgentSettings> {
  const payload = await apiGet<{ settings: AgentSettings }>(`/api/agent-cards/${encodeURIComponent(agentCardId)}/settings`);
  return payload.settings;
}

export async function fetchAgentRuntimeConfig(agentCardId: string): Promise<AgentRuntimeConfig> {
  return apiGet<AgentRuntimeConfig>(`/api/agent-cards/${encodeURIComponent(agentCardId)}/runtime-config`);
}

export async function fetchToolCatalog(): Promise<ToolCatalogItem[]> {
  const payload = await apiGet<{ tools: ToolCatalogItem[] }>("/api/tools/catalog");
  return payload.tools;
}

export async function fetchSkillCatalog(): Promise<SkillCatalogItem[]> {
  const payload = await apiGet<{ skills: SkillCatalogItem[] }>("/api/skills/catalog");
  return payload.skills;
}

export async function saveAgentSettings(agentCardId: string, settings: AgentSettings): Promise<{ settings: AgentSettings; agentCard: AgentCard }> {
  return apiPut<{ settings: AgentSettings; agentCard: AgentCard }>(`/api/agent-cards/${encodeURIComponent(agentCardId)}/settings`, { settings });
}

export async function fetchThreadState(threadId: string): Promise<ThreadStateResponse> {
  return apiGet<ThreadStateResponse>(`/api/threads/${encodeURIComponent(threadId)}/state`);
}
