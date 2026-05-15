import { hardDeleteThread, moveThreadToTrash, restoreThreadFromTrash } from "../../features/agents/agentClient";
import type { StoredThread } from "../../features/agents/types";

type UseProjectTrashOptions = {
  onClearPersistedThreadId: (threadId: string) => void;
  onRefreshProjectSurfaces: () => Promise<void>;
};

export function useProjectTrash({ onClearPersistedThreadId, onRefreshProjectSurfaces }: UseProjectTrashOptions) {
  const handleMoveToTrash = async (thread: StoredThread | string) => {
    const threadId = typeof thread === "string" ? thread : thread.id;
    await moveThreadToTrash(threadId);
    onClearPersistedThreadId(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleRestoreThread = async (threadId: string) => {
    await restoreThreadFromTrash(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleHardDeleteThread = async (threadId: string) => {
    await hardDeleteThread(threadId);
    onClearPersistedThreadId(threadId);
    await onRefreshProjectSurfaces();
  };

  return { handleMoveToTrash, handleRestoreThread, handleHardDeleteThread };
}
