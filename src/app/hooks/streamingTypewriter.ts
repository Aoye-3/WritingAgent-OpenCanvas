export type TypewriterState<TTarget extends string> = {
  target: TTarget;
  queue: string[];
  timer: number | null;
};

export const TYPEWRITER_TICK_MS = 12;

type CollaborationMessageLike = {
  id: string;
  role: "user" | "assistant";
  text: string;
  [key: string]: unknown;
  usedMock?: boolean;
  isStreaming?: boolean;
  status?: "thinking" | "searching" | "writing" | "finalizing" | "error" | "stopped";
  statusLabel?: string;
  createdAt?: string;
};

type StoredMessageLike = {
  id: string;
  role: "user" | "assistant";
  text: string;
  usedMock: boolean;
  [key: string]: unknown;
};

export function enqueueTypewriterToken<TTarget extends string>(
  current: TypewriterState<TTarget> | null,
  target: TTarget,
  token: string
): TypewriterState<TTarget> | null {
  if (!token) return current;
  if (current?.target === target) {
    return {
      ...current,
      queue: [...current.queue, token]
    };
  }
  return { target, queue: [token], timer: null };
}

export function takeTypewriterText(queue: string[]) {
  return {
    text: queue.join(""),
    rest: []
  };
}

export function getTypewriterFinalPatch(visibleText: string, finalText: string) {
  if (visibleText === finalText) return null;
  return { reset: !finalText.startsWith(visibleText), text: finalText, immediate: true };
}

export function sameVisibleMessages(left: CollaborationMessageLike[], right: CollaborationMessageLike[]) {
  return left.length === right.length && left.every((message, index) => {
    const next = right[index];
    return Boolean(next) &&
      message.role === next.role &&
      message.text === next.text &&
      Boolean(message.usedMock) === Boolean(next.usedMock);
  });
}

export function storedMessagesToCollaborationMessages(messages: StoredMessageLike[]): CollaborationMessageLike[] {
  return messages.map((message) => ({
    ...message,
    id: message.id,
    role: message.role,
    text: message.text,
    usedMock: message.usedMock,
    createdAt: typeof message.createdAt === "string" ? message.createdAt : undefined
  }));
}

export function reconcileCollaborationMessages(
  current: CollaborationMessageLike[],
  persistedMessages: StoredMessageLike[]
): CollaborationMessageLike[] {
  const persisted = storedMessagesToCollaborationMessages(persistedMessages);
  if (!sameVisibleMessages(current, persisted)) return persisted;
  return current.map((message, index) => ({
    ...message,
    ...persisted[index],
    id: message.id,
    isStreaming: false,
    status: undefined,
    statusLabel: undefined
  }));
}
