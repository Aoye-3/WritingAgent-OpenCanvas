import type {
  AgentCard,
  AgentRuntimeConfig,
  AgentSettings,
  ProjectBrief,
  ProjectSummary,
  SkillCatalogItem,
  SkillFolderItem,
  StoredThread,
  ThreadCreateResponse,
  ThreadStateResponse,
  TaskBrief,
  ToolCatalogItem
} from "./types";
import type { PlanRun } from "./types";
import type { CanvasWriteSuggestion } from "./types";
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

export async function saveProjectThumbnail(projectId: string, thumbnail: { imageBase64: string; mimeType: string }): Promise<void> {
  await apiPost<{ thumbnail: { mimeType: string; updatedAt: string } }>(`/api/projects/${encodeURIComponent(projectId)}/thumbnail`, thumbnail);
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

export async function saveProjectBrief(projectId: string, brief: ProjectBrief, revision: number) {
  return apiPatch<{ brief: ProjectBrief; revision: number }>(`/api/projects/${encodeURIComponent(projectId)}/brief`, { brief, revision });
}

export async function saveTaskBrief(threadId: string, brief: TaskBrief, revision: number) {
  return apiPatch<{ brief: TaskBrief; revision: number }>(`/api/threads/${encodeURIComponent(threadId)}/task-brief`, { brief, revision });
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
  const payload = await apiGet<{ skills: SkillCatalogItem[]; folders?: SkillFolderItem[] }>("/api/skills/catalog");
  return payload.skills;
}

export async function fetchSkillCatalogState(): Promise<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }> {
  const payload = await apiGet<{ skills: SkillCatalogItem[]; folders?: SkillFolderItem[] }>("/api/skills/catalog");
  return { skills: payload.skills, folders: payload.folders ?? [] };
}

export async function createSkillFolder(folderId: string): Promise<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }> {
  const payload = await apiPost<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }>("/api/skills/folders", { folderId });
  return payload;
}

export async function renameSkillFolder(currentFolderId: string, folderId: string): Promise<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }> {
  return apiPatch<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }>(`/api/skills/folders/${encodeURIComponent(currentFolderId)}`, { folderId });
}

export async function deleteSkillFolder(folderId: string): Promise<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }> {
  return apiDelete<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }>(`/api/skills/folders/${encodeURIComponent(folderId)}`);
}

export async function moveSkillToFolder(skillRef: string, folderId: string): Promise<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }> {
  return apiPatch<{ skills: SkillCatalogItem[]; folders: SkillFolderItem[] }>(`/api/skills/${encodeURIComponent(skillRef)}/folder`, { folderId });
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

export async function approvePlan(threadId: string, planId: string): Promise<PlanRun> {
  return (await apiPost<{ plan: PlanRun }>(`/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/approve`)).plan;
}
export async function cancelPlan(threadId: string, planId: string): Promise<PlanRun> {
  return (await apiPost<{ plan: PlanRun }>(`/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/cancel`)).plan;
}
export async function pausePlan(threadId: string, planId: string, message = "Conversation changed"): Promise<PlanRun> {
  return (await apiPost<{ plan: PlanRun }>(`/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/pause`, { message })).plan;
}
export async function retryPlanStep(threadId: string, planId: string, stepId: string) {
  return apiPost<{ step: unknown }>(`/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}/retry`);
}
export async function answerPlan(threadId: string, planId: string, answer: string | { optionId?: string; customAnswer?: string }): Promise<PlanRun> {
  const body = typeof answer === "string" ? { answer } : answer;
  return (await apiPost<{ plan: PlanRun }>(`/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/answer`, body)).plan;
}

export async function acceptCanvasWriteSuggestion(threadId: string, suggestionId: string): Promise<CanvasWriteSuggestion> {
  return (await apiPost<{ suggestion: CanvasWriteSuggestion }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-suggestions/${encodeURIComponent(suggestionId)}/accept`)).suggestion;
}

export async function dismissCanvasWriteSuggestion(threadId: string, suggestionId: string): Promise<CanvasWriteSuggestion> {
  return (await apiPost<{ suggestion: CanvasWriteSuggestion }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-suggestions/${encodeURIComponent(suggestionId)}/dismiss`)).suggestion;
}
