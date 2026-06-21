import test from "node:test";
import assert from "node:assert/strict";
import { generateTextStream } from "../../src/features/generation/generationClient";

test("streaming generation client forwards timeline events", async () => {
  const body = [
    'event: timeline_event\ndata: {"id":"timeline_1","sequence":1,"eventType":"phase_started","status":"running","title":"Thinking","summary":"Preparing the run","createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: reasoning_token\ndata: {"text":"Thinking..."}\n\n',
    'event: token\ndata: {"text":"Done"}\n\n',
    'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
  ].join("");
  const timelineEvents: unknown[] = [];
  const reasoningTokens: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { status: 200 });
  try {
    const result = await generateTextStream({ mode: "chat", locale: "zh", chatInstruction: "Hi" }, {
      onReasoningToken: (token) => reasoningTokens.push(token),
      onTimelineEvent: (event) => timelineEvents.push(event)
    });

    assert.equal(result.text, "Done");
    assert.deepEqual(reasoningTokens, ["Thinking..."]);
    assert.equal(timelineEvents.length, 1);
    assert.equal((timelineEvents[0] as { eventType?: string }).eventType, "phase_started");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("streaming generation client sends transient skill refs in the request payload", async () => {
  let observedBody = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    observedBody = String(init?.body ?? "");
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
        ));
        controller.close();
      }
    }), { status: 200 });
  };
  try {
    await generateTextStream({
      mode: "chat",
      locale: "en",
      chatInstruction: "Hi",
      transientSkillRefs: ["summary"]
    });

    assert.deepEqual(JSON.parse(observedBody).transientSkillRefs, ["summary"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("streaming generation client sends disabled skill refs in the request payload", async () => {
  let observedBody = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    observedBody = String(init?.body ?? "");
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
        ));
        controller.close();
      }
    }), { status: 200 });
  };
  try {
    await generateTextStream({
      mode: "chat",
      locale: "en",
      chatInstruction: "Hi",
      disabledSkillRefs: ["summary"]
    });

    assert.deepEqual(JSON.parse(observedBody).disabledSkillRefs, ["summary"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
