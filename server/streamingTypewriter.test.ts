import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueTypewriterToken,
  getTypewriterFinalPatch,
  reconcileCollaborationMessages,
  takeTypewriterText,
  TYPEWRITER_TICK_MS
} from "../src/app/hooks/streamingTypewriter.js";

test("typewriter tokens are queued in character order without dropping or duplicating text", () => {
  let state = enqueueTypewriterToken(null, "editable", "你好");
  state = enqueueTypewriterToken(state, "editable", "，FacetWrite");

  const rendered: string[] = [];
  while (state?.queue.length) {
    const next = takeTypewriterText(state.queue);
    rendered.push(next.text);
    state = { ...state, queue: next.rest };
  }

  assert.equal(rendered.join(""), "你好，FacetWrite");
});

test("typewriter uses a fast visible cadence", () => {
  assert.ok(TYPEWRITER_TICK_MS <= 16);
});

test("typewriter reveals large final chunks over multiple fast ticks instead of one flush", () => {
  const state = enqueueTypewriterToken(null, "message:assistant", "这是一段后端一次返回但前端需要逐字逐行展示的长文本。\n".repeat(20));
  assert.ok(state);

  const first = takeTypewriterText(state.queue);
  assert.ok(first.text.length <= 3);
  assert.ok(first.text.length < state.queue.length);
  assert.ok(first.rest.length > 0);
});

test("typewriter keeps one-shot large text queued across the first few ticks", () => {
  let state = enqueueTypewriterToken(null, "message:assistant", "A large final response should still be rendered through the typewriter queue. ".repeat(25));
  assert.ok(state);

  let rendered = "";
  for (let index = 0; index < 4; index += 1) {
    const next = takeTypewriterText(state.queue);
    rendered += next.text;
    state = { ...state, queue: next.rest };
  }

  assert.ok(rendered.length < 20);
  assert.ok(state.queue.length > 100);
});

test("final text backfill returns a queued suffix instead of bypassing the typewriter", () => {
  const patch = getTypewriterFinalPatch("Partial answer", "Partial answer with final citations.");

  assert.deepEqual(patch, { reset: false, token: " with final citations." });
});

test("final text correction requests a reset plus queued full text", () => {
  const patch = getTypewriterFinalPatch("wrong draft", "correct final answer");

  assert.deepEqual(patch, { reset: true, token: "correct final answer" });
});

test("reconciles matching final thread state without replacing visible streaming messages", () => {
  const current = [
    { id: "tmp_user", role: "user" as const, text: "写一段介绍", usedMock: false },
    {
      id: "tmp_assistant",
      role: "assistant" as const,
      text: "这是逐字流出的内容。",
      usedMock: false,
      isStreaming: true,
      status: "writing" as const,
      statusLabel: "正在生成回复"
    }
  ];
  const reconciled = reconcileCollaborationMessages(current, [
    {
      id: "stored_user",
      threadId: "thread_1",
      role: "user",
      text: "写一段介绍",
      usedMock: false,
      createdAt: "2026-05-18T00:00:00.000Z"
    },
    {
      id: "stored_assistant",
      threadId: "thread_1",
      role: "assistant",
      text: "这是逐字流出的内容。",
      usedMock: false,
      createdAt: "2026-05-18T00:00:01.000Z"
    }
  ]);

  assert.equal(reconciled[1]?.id, "tmp_assistant");
  assert.equal(reconciled[1]?.text, "这是逐字流出的内容。");
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
