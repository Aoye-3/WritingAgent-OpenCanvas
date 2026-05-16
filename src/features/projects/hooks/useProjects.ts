import { useCallback, useState } from "react";
import { batchHardDeleteThreads, batchMoveThreadsToTrash, fetchProjects, fetchRecentThreads, renameThread } from "../../agents/agentClient";
import type { ProjectSummary, StoredThread } from "../../agents/types";

export function useProjects() {
  const [recentThreads, setRecentThreads] = useState<StoredThread[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trashProjects, setTrashProjects] = useState<ProjectSummary[]>([]);

  const refreshRecentThreads = useCallback(async () => {
    try {
      setRecentThreads(await fetchRecentThreads());
    } catch {
      setRecentThreads([]);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const [active, trash] = await Promise.all([fetchProjects(false), fetchProjects(true)]);
      setProjects(active);
      setTrashProjects(trash);
    } catch {
      setProjects([]);
      setTrashProjects([]);
    }
  }, []);

  const refreshProjectSurfaces = useCallback(async () => {
    await Promise.all([refreshRecentThreads(), refreshProjects()]);
  }, [refreshProjects, refreshRecentThreads]);

  const handleRenameThread = useCallback(async (threadId: string, title: string) => {
    await renameThread(threadId, title);
    await refreshProjectSurfaces();
  }, [refreshProjectSurfaces]);

  const handleBatchMoveToTrash = useCallback(async (threadIds: string[]) => {
    await batchMoveThreadsToTrash(threadIds);
    await refreshProjectSurfaces();
  }, [refreshProjectSurfaces]);

  const handleBatchHardDelete = useCallback(async (threadIds: string[]) => {
    await batchHardDeleteThreads(threadIds);
    await refreshProjectSurfaces();
  }, [refreshProjectSurfaces]);

  return {
    handleBatchHardDelete,
    handleBatchMoveToTrash,
    handleRenameThread,
    projects,
    recentThreads,
    refreshProjects,
    refreshProjectSurfaces,
    refreshRecentThreads,
    trashProjects
  };
}
