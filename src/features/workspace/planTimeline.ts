export function buildPlanTimeline<
  TMessage extends { id: string; role: "user" | "assistant"; createdAt?: string },
  TPlan extends { id: string; createdAt: string }
>(messages: TMessage[], plans: TPlan[]) {
  const remaining = [...plans].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const entries: Array<{ kind: "message"; value: TMessage } | { kind: "plan"; value: TPlan }> = [];
  for (const message of messages) {
    entries.push({ kind: "message", value: message });
    if (message.role !== "assistant" || !message.createdAt) continue;
    while (remaining[0] && remaining[0].createdAt <= message.createdAt) {
      entries.push({ kind: "plan", value: remaining.shift()! });
    }
  }
  for (const plan of remaining) entries.push({ kind: "plan", value: plan });
  return entries;
}
