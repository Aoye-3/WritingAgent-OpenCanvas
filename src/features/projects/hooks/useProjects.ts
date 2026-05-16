import { useCallback, useMemo, useState } from "react";
import { batchHardDeleteThreads, batchMoveThreadsToTrash, fetchProjects, fetchRecentThreads, renameThread } from "../../agents/agentClient";
import type { ProjectSummary, StoredThread } from "../../agents/types";

const PINNED_RECENT_THREADS_KEY = "facetwrite:pinned-recent-threads";

export function useProjects() {
  const [recentThreads, setRecentThreads] = useState<StoredThread[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trashProjects, setTrashProjects] = useState<ProjectSummary[]>([]);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>(() => readPinnedThreadIds());

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

  const handleTogglePinnedThread = useCallback((threadId: string) => {
    setPinnedThreadIds((current) => {
      const next = current.includes(threadId)
        ? current.filter((id) => id !== threadId)
        : [threadId, ...current];
      writePinnedThreadIds(next);
      return next;
    });
  }, []);

  const sortedRecentThreads = useMemo(() => {
    const rank = new Map(pinnedThreadIds.map((id, index) => [id, index]));
    return [...recentThreads].sort((left, right) => {
      const leftRank = rank.get(left.id);
      const rightRank = rank.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [pinnedThreadIds, recentThreads]);

  return {
    handleBatchHardDelete,
    handleBatchMoveToTrash,
    handleRenameThread,
    handleTogglePinnedThread,
    pinnedThreadIds,
    projects,
    recentThreads: sortedRecentThreads,
    refreshProjects,
    refreshProjectSurfaces,
    refreshRecentThreads,
    trashProjects
  };
}

function readPinnedThreadIds() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PINNED_RECENT_THREADS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writePinnedThreadIds(threadIds: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PINNED_RECENT_THREADS_KEY, JSON.stringify(threadIds));
}
