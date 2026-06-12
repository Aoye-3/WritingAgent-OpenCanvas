import { hardDeleteProject, moveProjectToTrash, moveThreadToTrash, restoreProjectFromTrash } from "../../features/agents/agentClient";
import type { StoredThread } from "../../features/agents/types";

type UseProjectTrashOptions = {
  onClearPersistedThreadId: (threadId: string) => void;
  onRefreshProjectSurfaces: () => Promise<void>;
};

export function useProjectTrash({ onClearPersistedThreadId, onRefreshProjectSurfaces }: UseProjectTrashOptions) {
  const handleMoveToTrash = async (thread: StoredThread | string) => {
    const id = typeof thread === "string" ? thread : thread.id;
    if (typeof thread === "string") await moveProjectToTrash(id);
    else await moveThreadToTrash(id);
    onClearPersistedThreadId(id);
    await onRefreshProjectSurfaces();
  };

  const handleRestoreThread = async (threadId: string) => {
    await restoreProjectFromTrash(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleHardDeleteThread = async (threadId: string) => {
    await hardDeleteProject(threadId);
    onClearPersistedThreadId(threadId);
    await onRefreshProjectSurfaces();
  };

  return { handleMoveToTrash, handleRestoreThread, handleHardDeleteThread };
}
