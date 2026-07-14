import type { DurableContinuationSummary } from "../../../shared/durableContinuation.js";
import type { StoredDurableContinuation } from "../../storageTypes.js";

const sensitiveErrorPattern = /authorization|bearer|cookie|password|secret|api.?key|token|claim|descriptor|contextvalues|deliveryid|sourcerunid/i;

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
  if (sensitiveErrorPattern.test(normalized)) return "Continuation failed. Retry is available.";
  return normalized.slice(0, 240);
}
