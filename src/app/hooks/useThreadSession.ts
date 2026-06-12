import { useRef, useState } from "react";
import { createThread, fetchProjectThreads, fetchThreadState } from "../../features/agents/agentClient";
import type { StoredThread, ThreadStateResponse } from "../../features/agents/types";
import type { AppView } from "../App";
import { selectProjectThread } from "../projectWorkspace";

const lastThreadStorageKey = "facetwrite:lastThreadId";

type UseThreadSessionOptions = {
  onApplyThreadState: (state: ThreadStateResponse) => void;
  onRefreshProjectSurfaces: () => Promise<void>;
  onNavigate: (view: AppView) => void;
};

export function useThreadSession({ onApplyThreadState, onRefreshProjectSurfaces, onNavigate }: UseThreadSessionOptions) {
  const [threadId, setThreadId] = useState("");
  const [projectThreads, setProjectThreads] = useState<StoredThread[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const operationIdRef = useRef(0);

  const persistThreadId = (nextThreadId: string) => {
    setThreadId(nextThreadId);
    window.localStorage.setItem(lastThreadStorageKey, nextThreadId);
  };

  const clearPersistedThreadId = (nextThreadId?: string) => {
    if (!nextThreadId || window.localStorage.getItem(lastThreadStorageKey) === nextThreadId) {
      window.localStorage.removeItem(lastThreadStorageKey);
    }
  };

  const createThreadForProject = async (projectId: string, title = "New conversation") => {
    const operationId = ++operationIdRef.current;
    const response = await createThread(projectId, title);
    if (operationId !== operationIdRef.current) return response.threadId;
    persistThreadId(response.threadId);
    setProjectThreads((current) => [response.thread, ...current.filter((thread) => thread.id !== response.thread.id)]);
    await onRefreshProjectSurfaces();
    return response.threadId;
  };

  const ensureThreadForProject = async (projectId: string) => {
    if (threadId) return threadId;
    return createThreadForProject(projectId);
  };

  const restoreThread = async (nextThreadId: string) => {
    const operationId = ++operationIdRef.current;
    setSessionBusy(true);
    setSessionError("");
    try {
      const state = await fetchThreadState(nextThreadId);
      if (operationId !== operationIdRef.current) return false;
      const threads = await fetchProjectThreads(state.thread.projectId);
      if (operationId !== operationIdRef.current) return false;
      setProjectThreads(threads);
      onApplyThreadState(state);
      onNavigate("workspace");
      persistThreadId(nextThreadId);
      return true;
    } catch (error) {
      clearPersistedThreadId(nextThreadId);
      if (operationId === operationIdRef.current) {
        setSessionError(error instanceof Error ? error.message : "Unable to open this conversation.");
      }
      return false;
    } finally {
      if (operationId === operationIdRef.current) setSessionBusy(false);
    }
  };

  const openProject = async (projectId: string) => {
    const operationId = ++operationIdRef.current;
    setSessionBusy(true);
    setSessionError("");
    try {
      const threads = await fetchProjectThreads(projectId);
      if (operationId !== operationIdRef.current) return false;
      setProjectThreads(threads);
      const existing = selectProjectThread(threads);
      const nextThread = existing ?? (await createThread(projectId)).thread;
      if (operationId !== operationIdRef.current) return false;
      if (!existing) setProjectThreads([nextThread]);
      const state = await fetchThreadState(nextThread.id);
      if (operationId !== operationIdRef.current) return false;
      onApplyThreadState(state);
      persistThreadId(nextThread.id);
      onNavigate("workspace");
      await onRefreshProjectSurfaces();
      return true;
    } catch (error) {
      if (operationId === operationIdRef.current) {
        setSessionError(error instanceof Error ? error.message : "Unable to open this project.");
      }
      return false;
    } finally {
      if (operationId === operationIdRef.current) setSessionBusy(false);
    }
  };

  const createConversation = async (projectId: string) => {
    const operationId = ++operationIdRef.current;
    setSessionBusy(true);
    setSessionError("");
    try {
      const response = await createThread(projectId);
      if (operationId !== operationIdRef.current) return false;
      const state = await fetchThreadState(response.thread.id);
      if (operationId !== operationIdRef.current) return false;
      setProjectThreads((current) => [response.thread, ...current.filter((thread) => thread.id !== response.thread.id)]);
      onApplyThreadState(state);
      persistThreadId(response.thread.id);
      onNavigate("workspace");
      await onRefreshProjectSurfaces();
      return true;
    } catch (error) {
      if (operationId === operationIdRef.current) {
        setSessionError(error instanceof Error ? error.message : "Unable to create a conversation.");
      }
      return false;
    } finally {
      if (operationId === operationIdRef.current) setSessionBusy(false);
    }
  };

  return {
    threadId,
    projectThreads,
    sessionBusy,
    sessionError,
    clearSessionError: () => setSessionError(""),
    setThreadId,
    persistThreadId,
    clearPersistedThreadId,
    createThreadForProject,
    ensureThreadForProject,
    restoreThread,
    openProject,
    createConversation
  };
}
