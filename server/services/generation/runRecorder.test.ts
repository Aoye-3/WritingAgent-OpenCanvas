import test from "node:test";
import assert from "node:assert/strict";
import type { SQLiteStorageRepository } from "../../storage.js";
import { recordGenerationRun } from "./runRecorder.js";
import { durableContinuationSummary } from "./durableContinuationSummary.js";
import type { StoredDurableContinuation } from "../../storageTypes.js";

test("recorded generation returns only the persisted durable continuation summary", () => {
  let recorded = false;
  const storage = {
    recordRun: () => {
      recorded = true;
      return { runId: "run_1", promptVersionId: "prompt_1", outputVersionId: "output_1" };
    },
    readDurableContinuation: () => {
      assert.equal(recorded, true);
      return {
        threadId: "thread_1",
        sourceRunId: "run_source",
        state: "failed" as const,
        descriptor: {
          version: 1 as const,
          resolvedInstruction: "secret instruction",
          agentCardId: "blog-post",
          projectId: "project_1",
          transientSkillRefs: ["secret-skill"],
          runtimeBudgetProfile: "high" as const,
          deliveryId: "secret-delivery",
          workflowMode: "batch_delivery" as const
        },
        attempts: 2,
        claimToken: "secret-claim-token",
        claimedAt: "2026-07-14T12:00:00.000Z",
        lastError: "runtime unavailable",
        createdAt: "2026-07-14T11:00:00.000Z",
        updatedAt: "2026-07-14T12:00:00.000Z"
      };
    }
  } as unknown as SQLiteStorageRepository;

  const response = recordGenerationRun({
    storage,
    payload: { mode: "chat", locale: "en", threadId: "thread_1", chatInstruction: "Continue" },
    threadId: "thread_1",
    agentCardId: "blog-post",
    agentTitle: "Blog post",
    mode: "chat",
    prompt: "prompt",
    text: "Process reply preserved",
    provider: "agent-backend",
    usedMock: false,
    toolState: {},
    completion: {
      status: "continue",
      reasons: ["Final answer exists but required delivery is incomplete."],
      missingRequirements: ["Complete the delivery."],
      evaluatedAt: "2026-07-14T12:00:00.000Z"
    }
  });

  assert.deepEqual(response.durableContinuation, {
    state: "failed",
    canContinue: true,
    attempts: 2,
    lastError: "The runtime is unavailable."
  });
  assert.deepEqual(Object.keys(response.durableContinuation ?? {}).sort(), ["attempts", "canContinue", "lastError", "state"]);
  assert.doesNotMatch(JSON.stringify(response), /secret instruction|secret-skill|secret-delivery|secret-claim-token|run_source/);
});

test("durable continuation summary derives continuation ability for every persisted state", () => {
  const states = ["ready", "claimed", "completed", "failed", "superseded"] as const;
  const summaries = states.map((state) => durableContinuationSummary(storedContinuation(state)));

  assert.deepEqual(summaries.map((summary) => summary?.canContinue), [true, false, false, true, false]);
  assert.ok(summaries.every((summary) => summary && Object.keys(summary).every((key) => ["state", "canContinue", "attempts"].includes(key))));
});

test("durable continuation summary replaces a sensitive persisted error", () => {
  const summary = durableContinuationSummary({
    ...storedContinuation("failed"),
    lastError: "Bearer secret-token in contextValues.deliveryId"
  });

  assert.equal(summary?.lastError, "Continuation failed. Retry is available.");
  assert.doesNotMatch(JSON.stringify(summary), /secret-token|contextValues|deliveryId/);
});

test("durable continuation summary never exposes unknown credential or internal error text", () => {
  const unsafeErrors = [
    "Provider rejected credential sk-live-123456789",
    "Fetch failed for https://runtime-user:runtime-pass@internal.example/private",
    "credential=private-value",
    "facetwrite_internal_continuation orchestrationPolicy.serverReadinessGate"
  ];

  for (const lastError of unsafeErrors) {
    const summary = durableContinuationSummary({ ...storedContinuation("failed"), lastError });
    assert.equal(summary?.lastError, "Continuation failed. Retry is available.");
    assert.equal(JSON.stringify(summary).includes(lastError), false);
  }
});

test("durable continuation summary maps an explicitly allowed stable error code to safe copy", () => {
  const summary = durableContinuationSummary({
    ...storedContinuation("failed"),
    lastError: "durable_continuation_recovered_after_restart"
  });

  assert.equal(summary?.lastError, "Continuation was interrupted by a server restart.");
});

function storedContinuation(state: StoredDurableContinuation["state"]): StoredDurableContinuation {
  return {
    threadId: "thread_1",
    state,
    descriptor: {
      version: 1,
      resolvedInstruction: "private instruction",
      agentCardId: "blog-post",
      projectId: "project_1",
      deliveryId: "delivery_1",
      workflowMode: "batch_delivery"
    },
    attempts: 1,
    createdAt: "2026-07-14T11:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z"
  };
}
