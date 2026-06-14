import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueTypewriterToken,
  getTypewriterFinalPatch,
  reconcileCollaborationMessages,
  takeTypewriterText,
  TYPEWRITER_TICK_MS
} from "../src/app/hooks/streamingTypewriter.js";

test("typewriter tokens are queued in order without dropping or duplicating text", () => {
  let state = enqueueTypewriterToken(null, "editable", "Hello");
  state = enqueueTypewriterToken(state, "editable", ", FacetWrite");

  const rendered: string[] = [];
  while (state?.queue.length) {
    const next = takeTypewriterText(state.queue);
    rendered.push(next.text);
    state = { ...state, queue: next.rest };
  }

  assert.equal(rendered.join(""), "Hello, FacetWrite");
});

test("typewriter uses a fast visible cadence", () => {
  assert.ok(TYPEWRITER_TICK_MS <= 16);
});

test("typewriter exposes large available chunks in one UI tick", () => {
  const text = "This final response is already available and should not be artificially slowed down. ".repeat(20);
  const state = enqueueTypewriterToken(null, "message:assistant", text);
  assert.ok(state);

  const first = takeTypewriterText(state.queue);
  assert.equal(first.text, text);
  assert.equal(first.rest.length, 0);
});

test("typewriter does not keep one-shot final text queued across visible ticks", () => {
  let state = enqueueTypewriterToken(null, "message:assistant", "A large final response should render without artificial typing delay. ".repeat(25));
  assert.ok(state);

  const next = takeTypewriterText(state.queue);
  state = { ...state, queue: next.rest };

  assert.ok(next.text.length > 100);
  assert.equal(state.queue.length, 0);
});

test("final text backfill returns an immediate full-text synchronization", () => {
  const patch = getTypewriterFinalPatch("Partial answer", "Partial answer with final citations.");

  assert.deepEqual(patch, { reset: false, text: "Partial answer with final citations.", immediate: true });
});

test("final text correction requests an immediate full-text reset", () => {
  const patch = getTypewriterFinalPatch("wrong draft", "correct final answer");

  assert.deepEqual(patch, { reset: true, text: "correct final answer", immediate: true });
});

test("reconciles matching final thread state without replacing visible streaming messages", () => {
  const current = [
    { id: "tmp_user", role: "user" as const, text: "Write an intro", usedMock: false },
    {
      id: "tmp_assistant",
      role: "assistant" as const,
      text: "This is streamed content.",
      usedMock: false,
      isStreaming: true,
      status: "writing" as const,
      statusLabel: "Writing"
    }
  ];
  const reconciled = reconcileCollaborationMessages(current, [
    {
      id: "stored_user",
      threadId: "thread_1",
      role: "user",
      text: "Write an intro",
      usedMock: false,
      createdAt: "2026-05-18T00:00:00.000Z"
    },
    {
      id: "stored_assistant",
      threadId: "thread_1",
      role: "assistant",
      text: "This is streamed content.",
      usedMock: false,
      createdAt: "2026-05-18T00:00:01.000Z"
    }
  ]);

  assert.equal(reconciled[1]?.id, "tmp_assistant");
  assert.equal(reconciled[1]?.text, "This is streamed content.");
  assert.equal(reconciled[1]?.isStreaming, false);
  assert.equal(reconciled[1]?.status, undefined);
});

test("uses persisted messages when final state differs from temporary streaming text", () => {
  const reconciled = reconcileCollaborationMessages([
    { id: "tmp_assistant", role: "assistant", text: "partial", usedMock: false }
  ], [
    {
      id: "stored_assistant",
      threadId: "thread_1",
      role: "assistant",
      text: "final answer",
      usedMock: false,
      createdAt: "2026-05-18T00:00:01.000Z"
    }
  ]);

  assert.equal(reconciled[0]?.id, "stored_assistant");
  assert.equal(reconciled[0]?.text, "final answer");
});
