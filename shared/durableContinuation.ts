export type DurableContinuationState = "ready" | "claimed" | "completed" | "failed" | "superseded";

export type DurableContinuationSummary = {
  state: DurableContinuationState;
  canContinue: boolean;
  attempts: number;
  lastError?: string;
};
