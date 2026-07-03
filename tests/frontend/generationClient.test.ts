import test from "node:test";
import assert from "node:assert/strict";
import { fetchRuntimeRunEvents, generateTextStream } from "../../src/features/generation/generationClient";

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

test("streaming generation client forwards progress events outside final text", async () => {
  const body = [
    'event: progress_event\ndata: {"id":"progress_1","threadId":"thread_1","status":"running","summary":"正在收集证据","createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
  ].join("");
  const progressEvents: unknown[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { status: 200 });
  try {
    const result = await generateTextStream({ mode: "chat", locale: "zh", chatInstruction: "Hi" }, {
      onProgressEvent: (event) => progressEvents.push(event)
    });

    assert.equal(result.text, "Done");
    assert.equal(progressEvents.length, 1);
    assert.equal((progressEvents[0] as { summary?: string }).summary, "正在收集证据");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("streaming generation client forwards public progress evidence", async () => {
  const body = [
    'event: progress_event\ndata: {"id":"progress_public","threadId":"thread_1","status":"running","visibility":"public","source":"agent_public_update","summary":"Collecting evidence.","next":"Next I will review it.","evidence":[{"kind":"subagent","label":"frontend explorer","ref":"agent:trace"}],"createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
  ].join("");
  const progressEvents: unknown[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { status: 200 });
  try {
    await generateTextStream({ mode: "chat", locale: "en", chatInstruction: "Hi" }, {
      onProgressEvent: (event) => progressEvents.push(event)
    });

    assert.equal(progressEvents.length, 1);
    assert.equal((progressEvents[0] as { summary?: string }).summary, "Collecting evidence.");
    assert.equal((progressEvents[0] as { visibility?: string }).visibility, "public");
    assert.deepEqual((progressEvents[0] as { evidence?: unknown }).evidence, [
      { kind: "subagent", label: "frontend explorer", ref: "agent:trace" }
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("streaming generation client parses multiline progress event data", async () => {
  const body = [
    'event: progress_event\n',
    'data: {"id":"progress_1","threadId":"thread_1",\n',
    'data: "summary":"I checked the runtime stream.",\n',
    'data: "createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
  ].join("");
  const progressEvents: unknown[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { status: 200 });
  try {
    await generateTextStream({ mode: "chat", locale: "en", chatInstruction: "Hi" }, {
      onProgressEvent: (event) => progressEvents.push(event)
    });

    assert.equal(progressEvents.length, 1);
    assert.equal((progressEvents[0] as { summary?: string }).summary, "I checked the runtime stream.");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("streaming generation client drops invalid or sensitive progress events", async () => {
  const body = [
    'event: progress_event\ndata: {"id":"progress_sensitive","threadId":"thread_1","summary":"raw tool arguments include prompt","createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: progress_event\ndata: {"id":"progress_missing","threadId":"thread_1","createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: progress_event\ndata: {"id":"progress_safe","threadId":"thread_1","summary":"I verified the public update path.","evidence":[{"kind":"tool","label":"tool arguments hidden"},{"kind":"file","label":"types.ts"}],"createdAt":"2026-06-14T00:00:00.000Z"}\n\n',
    'event: final\ndata: {"text":"Done","prompt":"","provider":"agent-backend","usedMock":false,"threadId":"thread_1"}\n\n'
  ].join("");
  const progressEvents: unknown[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { status: 200 });
  try {
    await generateTextStream({ mode: "chat", locale: "en", chatInstruction: "Hi" }, {
      onProgressEvent: (event) => progressEvents.push(event)
    });

    assert.equal(progressEvents.length, 1);
    assert.equal((progressEvents[0] as { id?: string }).id, "progress_safe");
    assert.deepEqual((progressEvents[0] as { evidence?: unknown }).evidence, [{ kind: "file", label: "types.ts" }]);
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

test("generation client fetches runtime run events", async () => {
  let observedUrl = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    observedUrl = String(input);
    return Response.json({
      events: [{
        eventType: "llm.tool.result",
        category: "message",
        content: "done",
        sequence: 1
      }]
    });
  };
  try {
    const events = await fetchRuntimeRunEvents({ threadId: "thread_1", runId: "run_1", limit: 25 });

    assert.equal(observedUrl, "/api/generate/runs/run_1/events?threadId=thread_1&limit=25");
    assert.deepEqual(events, [{
      eventType: "llm.tool.result",
      category: "message",
      content: "done",
      sequence: 1
    }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
