import { useCallback, useState } from "react";
import { fetchProjects, fetchRecentThreads } from "../../agents/agentClient";
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

  return {
    projects,
    recentThreads,
    refreshProjects,
    refreshProjectSurfaces,
    refreshRecentThreads,
    trashProjects
  };
}
