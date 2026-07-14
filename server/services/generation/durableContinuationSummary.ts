import type { DurableContinuationSummary } from "../../../shared/durableContinuation.js";
import type { StoredDurableContinuation } from "../../storageTypes.js";

const safeLastErrors = new Map<string, string>([
  ["runtime unavailable", "The runtime is unavailable."],
  ["runtime_unavailable", "The runtime is unavailable."],
  ["durable_continuation_recovered_after_restart", "Continuation was interrupted by a server restart."]
]);
const unknownLastError = "Continuation failed. Retry is available.";

export function durableContinuationSummary(
  continuation: StoredDurableContinuation | undefined
): DurableContinuationSummary | undefined {
  if (!continuation) return undefined;
  const lastError = safeLastError(continuation.lastError);
  return {
    state: continuation.state,
    canContinue: continuation.state === "ready" || continuation.state === "failed",
    attempts: continuation.attempts,
    ...(lastError ? { lastError } : {})
  };
}

function safeLastError(value: string | undefined) {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return safeLastErrors.get(normalized.toLowerCase()) ?? unknownLastError;
}
