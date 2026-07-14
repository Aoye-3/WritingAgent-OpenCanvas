import test from "node:test";
import assert from "node:assert/strict";
import {
  attachRunStateToLatestAssistant,
  isAssistantRunCompleted
} from "../../src/app/hooks/useGenerationRun";
import { reconcileCollaborationMessages } from "../../src/app/hooks/streamingTypewriter";
import { durableContinuationPresentation } from "../../src/features/workspace/components/AICollaborationDrawer";
import type { CollaborationMessage } from "../../src/features/generation/types";

test("live continue completion preserves process text and remains unfinished", () => {
  const messages = attachRunStateToLatestAssistant([{
    id: "assistant_1",
    role: "assistant",
    text: "I collected the evidence and will continue the delivery."
  }], [], {
    status: "continue",
    reasons: ["Final answer exists."],
    missingRequirements: ["Canvas delivery remains."],
    evaluatedAt: "2026-07-14T12:00:00.000Z"
  }, {
    state: "ready",
    canContinue: true,
    attempts: 0
  });

  assert.equal(messages[0]?.text, "I collected the evidence and will continue the delivery.");
  assert.equal(messages[0]?.completion?.status, "continue");
  assert.equal(messages[0]?.durableContinuation?.state, "ready");
  assert.equal(isAssistantRunCompleted(messages[0] as CollaborationMessage), false);
});

test("assistant completion honors every explicit verdict and only falls back for legacy messages", () => {
  const message = (status?: NonNullable<CollaborationMessage["completion"]>["status"], overrides: Partial<CollaborationMessage> = {}): CollaborationMessage => ({
      id: `assistant_${status ?? "legacy"}`,
      role: "assistant",
      text: "Visible answer",
      isStreaming: false,
      ...(status ? {
        completion: {
          status,
          reasons: [],
          missingRequirements: [],
          evaluatedAt: "2026-07-14T12:00:00.000Z"
        }
      } : {}),
      ...overrides
    });

  for (const status of ["continue", "partial", "waiting", "failed", "finalizing"] as const) {
    assert.equal(isAssistantRunCompleted(message(status)), false, status);
  }
  assert.equal(isAssistantRunCompleted(message("completed")), true);
  assert.equal(isAssistantRunCompleted(message()), true);
  assert.equal(isAssistantRunCompleted(message(undefined, { isStreaming: true })), false);
  assert.equal(isAssistantRunCompleted(message(undefined, { text: "" })), false);
  assert.equal(isAssistantRunCompleted(message("completed", {
    durableContinuation: { state: "ready", canContinue: true, attempts: 1 }
  })), false);
});

test("continuation presentation renders recoverable states and hides terminal states", () => {
  assert.deepEqual(durableContinuationPresentation({ state: "ready", canContinue: true, attempts: 0 }, "zh"), {
    label: "任务尚未完成，可发送“继续”恢复执行。"
  });
  assert.deepEqual(durableContinuationPresentation({ state: "claimed", canContinue: false, attempts: 1 }, "en"), {
    label: "Restoring the original task…"
  });
  assert.deepEqual(durableContinuationPresentation({ state: "failed", canContinue: true, attempts: 2, lastError: "The runtime is unavailable." }, "zh"), {
    label: "答案和任务上下文已保存，可发送“继续”重试恢复。",
    lastError: "The runtime is unavailable."
  });
  assert.equal(durableContinuationPresentation({ state: "completed", canContinue: false, attempts: 1 }, "en"), undefined);
  assert.equal(durableContinuationPresentation({ state: "superseded", canContinue: false, attempts: 0 }, "en"), undefined);
});

test("matching persisted text replaces live run metadata for every recoverable continuation state", () => {
  for (const state of ["ready", "failed", "claimed"] as const) {
    const timeline = [{
      id: `timeline_${state}`,
      sequence: 1,
      eventType: "decision" as const,
      status: "waiting" as const,
      title: "Run incomplete",
      summary: "Continue from persisted state.",
      createdAt: "2026-07-14T12:00:00.000Z"
    }];
    const persisted = attachRunStateToLatestAssistant([{
      id: `stored_${state}`,
      role: "assistant" as const,
      text: "Process reply preserved",
      usedMock: false,
      createdAt: "2026-07-14T12:00:00.000Z"
    }], timeline, {
      status: "continue",
      reasons: ["Task remains incomplete."],
      missingRequirements: ["Continue delivery."],
      evaluatedAt: "2026-07-14T12:00:00.000Z"
    }, {
      state,
      canContinue: state !== "claimed",
      attempts: 1,
      ...(state === "failed" ? { lastError: "The runtime is unavailable." } : {})
    });
    const current: CollaborationMessage[] = [{
      id: `live_${state}`,
      role: "assistant",
      text: "Process reply preserved",
      usedMock: false,
      isStreaming: true,
      status: "writing",
      completion: {
        status: "completed",
        reasons: ["Stale live completion."],
        missingRequirements: [],
        evaluatedAt: "2026-07-14T11:59:59.000Z"
      }
    }];

    const reconciled = reconcileCollaborationMessages(current, persisted) as CollaborationMessage[];

    assert.equal(reconciled[0]?.id, `live_${state}`);
    assert.equal(reconciled[0]?.completion?.status, "continue");
    assert.equal(reconciled[0]?.durableContinuation?.state, state);
    assert.deepEqual(reconciled[0]?.timeline, timeline);
    assert.equal(reconciled[0]?.isStreaming, false);
    assert.equal(isAssistantRunCompleted(reconciled[0] as CollaborationMessage), false);
    assert.ok(durableContinuationPresentation(reconciled[0]?.durableContinuation, "en"));
  }
});
