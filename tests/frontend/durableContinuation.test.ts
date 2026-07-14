import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CollaborationMessage } from "../../src/features/generation/types";

test("live continue completion preserves process text and remains unfinished", async () => {
  const module = await import("../../src/app/hooks/useGenerationRun");
  const attach = (module as Record<string, unknown>).attachRunStateToLatestAssistant;
  const isCompleted = (module as Record<string, unknown>).isAssistantRunCompleted;
  assert.equal(typeof attach, "function");
  assert.equal(typeof isCompleted, "function");

  const messages = (attach as Function)([{
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
  }) as CollaborationMessage[];

  assert.equal(messages[0]?.text, "I collected the evidence and will continue the delivery.");
  assert.equal(messages[0]?.completion?.status, "continue");
  assert.equal(messages[0]?.durableContinuation?.state, "ready");
  assert.equal((isCompleted as Function)(messages[0]), false);
});

test("continuation presentation renders recoverable states and hides terminal states", async () => {
  const module = await import("../../src/features/workspace/components/AICollaborationDrawer");
  const present = (module as Record<string, unknown>).durableContinuationPresentation;
  assert.equal(typeof present, "function");

  assert.deepEqual((present as Function)({ state: "ready", canContinue: true, attempts: 0 }, "zh"), {
    label: "任务尚未完成，可发送“继续”恢复执行。"
  });
  assert.deepEqual((present as Function)({ state: "claimed", canContinue: false, attempts: 1 }, "en"), {
    label: "Restoring the original task…"
  });
  assert.deepEqual((present as Function)({ state: "failed", canContinue: true, attempts: 2, lastError: "runtime unavailable" }, "zh"), {
    label: "答案和任务上下文已保存，可发送“继续”重试恢复。",
    lastError: "runtime unavailable"
  });
  assert.equal((present as Function)({ state: "completed", canContinue: false, attempts: 1 }, "en"), undefined);
  assert.equal((present as Function)({ state: "superseded", canContinue: false, attempts: 0 }, "en"), undefined);
});

test("stream failure refreshes persisted thread state before local error fallback", () => {
  const source = readFileSync("src/app/hooks/useGenerationRun.ts", "utf8");
  const catchStart = source.indexOf("} catch (error) {", source.indexOf("const handleChatSend"));
  const catchEnd = source.indexOf("} finally {", catchStart);
  const catchBody = source.slice(catchStart, catchEnd);

  assert.ok(catchBody.indexOf("await options.onFetchAndApplyThreadState(threadId)") >= 0);
  assert.ok(catchBody.indexOf("await options.onFetchAndApplyThreadState(threadId)") < catchBody.indexOf("Request failed:"));
  assert.match(catchBody, /durableContinuation/);
});
