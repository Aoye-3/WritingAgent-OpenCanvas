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

export async function createProject(title: string): Promise<ProjectSummary> {
  const payload = await apiPost<{ project: ProjectSummary }>("/api/projects", { title });
  return payload.project;
}

export async function createThread(projectId: string, title = "New conversation"): Promise<ThreadCreateResponse> {
  return apiPost<ThreadCreateResponse>("/api/threads", { projectId, title });
}

export async function fetchProjectThreads(projectId: string): Promise<StoredThread[]> {
  const payload = await apiGet<{ threads: StoredThread[] }>(`/api/projects/${encodeURIComponent(projectId)}/threads`);
  return payload.threads;
}

export async function fetchProjectFirstHealth(): Promise<unknown> {
  return apiGet<unknown>("/api/health");
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

export async function renameProject(projectId: string, title: string): Promise<ProjectSummary> {
  const payload = await apiPatch<{ project: ProjectSummary }>(`/api/projects/${encodeURIComponent(projectId)}`, { title });
  return payload.project;
}

export async function bindProjectModels(projectId: string, configuredModelApiIds: string[]): Promise<string[]> {
  const payload = await apiPut<{ configuredModelApiIds: string[] }>(`/api/projects/${encodeURIComponent(projectId)}/models`, { configuredModelApiIds });
  return payload.configuredModelApiIds;
}

export async function selectThreadModel(threadId: string, configuredModelApiId?: string): Promise<StoredThread> {
  const payload = await apiPatch<{ thread: StoredThread }>(`/api/threads/${encodeURIComponent(threadId)}/model`, { configuredModelApiId });
  return payload.thread;
}

export async function resetThreadContext(threadId: string): Promise<StoredThread> {
  const payload = await apiPost<{ thread: StoredThread }>(`/api/threads/${encodeURIComponent(threadId)}/context-reset`);
  return payload.thread;
}

export async function moveProjectToTrash(projectId: string): Promise<void> {
  await apiPost<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}/trash`);
}

export async function restoreProjectFromTrash(projectId: string): Promise<void> {
  await apiPost<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}/restore`);
}

export async function hardDeleteProject(projectId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}`);
}

export async function saveThreadInputs(threadId: string, agentCardId: string, structuredValues: Record<string, string | string[]>, revision: number): Promise<{ structuredValues: Record<string, string | string[]>; revision: number }> {
  return apiPatch<{ structuredValues: Record<string, string | string[]>; revision: number }>(`/api/threads/${encodeURIComponent(threadId)}/inputs`, { agentCardId, structuredValues, revision });
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

export async function setOutputVersionProjectContext(threadId: string, versionId: string, included: boolean): Promise<void> {
  await apiPatch<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/output-versions/${encodeURIComponent(versionId)}/context`, { included });
}
