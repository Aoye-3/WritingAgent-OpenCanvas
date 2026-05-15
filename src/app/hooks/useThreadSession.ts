import { useState } from "react";
import { createThread, fetchThreadState } from "../../features/agents/agentClient";
import type { ThreadStateResponse } from "../../features/agents/types";
import type { AppView } from "../App";

const lastThreadStorageKey = "facetwrite:lastThreadId";

type UseThreadSessionOptions = {
  onApplyThreadState: (state: ThreadStateResponse) => void;
  onRefreshProjectSurfaces: () => Promise<void>;
  onNavigate: (view: AppView) => void;
};

export function useThreadSession({ onApplyThreadState, onRefreshProjectSurfaces, onNavigate }: UseThreadSessionOptions) {
  const [threadId, setThreadId] = useState("");

  const persistThreadId = (nextThreadId: string) => {
    setThreadId(nextThreadId);
    window.localStorage.setItem(lastThreadStorageKey, nextThreadId);
  };

  const clearPersistedThreadId = (nextThreadId?: string) => {
    if (!nextThreadId || window.localStorage.getItem(lastThreadStorageKey) === nextThreadId) {
      window.localStorage.removeItem(lastThreadStorageKey);
    }
  };

  const createThreadForAgent = async (agentCardId: string) => {
    const thread = await createThread(agentCardId);
    persistThreadId(thread.threadId);
    await onRefreshProjectSurfaces();
    return thread.threadId;
  };

  const ensureThreadForAgent = async (agentCardId: string) => {
    if (threadId) return threadId;
    return createThreadForAgent(agentCardId);
  };

  const restoreThread = async (nextThreadId: string) => {
    try {
      const state = await fetchThreadState(nextThreadId);
      onApplyThreadState(state);
      onNavigate("workspace");
      persistThreadId(nextThreadId);
      return true;
    } catch {
      clearPersistedThreadId(nextThreadId);
      return false;
    }
  };

  return {
    threadId,
    setThreadId,
    persistThreadId,
    clearPersistedThreadId,
    createThreadForAgent,
    ensureThreadForAgent,
    restoreThread
  };
}
