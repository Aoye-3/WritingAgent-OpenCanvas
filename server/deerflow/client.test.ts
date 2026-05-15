import test from "node:test";
import assert from "node:assert/strict";
import { getAgentCard } from "../agentCards.js";
import { buildRunRequest, runDeerFlowAgent } from "./client.js";

test("builds LangGraph-compatible DeerFlow run request", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_1",
    agentCard: card,
    messages: [{ role: "user", content: "Summarise this" }],
    prompt: "Summarise this"
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.assistant_id, "lead_agent");
  assert.equal(request.config.configurable.thread_id, "thread_1");
  assert.equal(request.metadata.agentCardId, "summary");
  assert.equal(request.metadata.subagent.name, "facetwrite-summary");
  assert.deepEqual(request.stream_mode, ["messages-tuple", "custom", "values"]);
});

test("reads DeerFlow stream text and task events", async () => {
  const body = [
    'event: custom\ndata: {"type":"task_started","name":"facetwrite-summary"}\n\n',
    'event: messages-tuple\ndata: [{"content":"Hello"}]\n\n',
    'event: messages-tuple\ndata: [{"content":" world"}]\n\n'
  ].join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const events: unknown[] = [];
  let runHeaders = new Headers();
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/api/v1/auth/setup-status")) {
      return Response.json({ needs_setup: false });
    }
    if (textUrl.endsWith("/api/v1/auth/login/local")) {
      const headers = new Headers();
      headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf_token=csrf; Path=/");
      return Response.json({ ok: true }, {
        headers
      });
    }
    runHeaders = new Headers(init?.headers);
    return new Response(stream, { status: 200 }) as Response;
  };

  const result = await runDeerFlowAgent({
    config: {
      enabled: true,
      baseUrl: "http://deerflow.local",
      assistantId: "lead_agent",
      auth: {
        email: "admin@example.com",
        password: "strong-password",
        autoSetup: false,
        timeoutMs: 5000
      }
    },
    threadId: "thread_1",
    agentCard: getAgentCard("summary"),
    messages: [{ role: "user", content: "Summarise this" }],
    prompt: "Summarise this",
    fetchImpl,
    onToolEvent: (event) => events.push(event)
  });

  assert.equal(result.text, "Hello world");
  assert.equal(result.events[0]?.eventType, "deerflow_task_started");
  assert.equal(events.length, 1);
  assert.equal(runHeaders.get("Cookie"), "access_token=session; csrf_token=csrf");
  assert.equal(runHeaders.get("X-CSRF-Token"), "csrf");
});
