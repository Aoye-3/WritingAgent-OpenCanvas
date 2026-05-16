import test from "node:test";
import assert from "node:assert/strict";
import { defaultAgentSettings, getAgentCard } from "../agentCards.js";
import { buildRunRequest, runDeerFlowAgent } from "./client.js";

test("builds LangGraph-compatible DeerFlow run request", () => {
  const card = getAgentCard("summary");
  const settings = defaultAgentSettings(card);
  const request = buildRunRequest({
    threadId: "thread_1",
    agentCard: card,
    settings: {
      ...settings,
      model: { ...settings.model, model: "deepseek-v4-flash", thinkingMode: "enabled", reasoningEffort: "high" }
    },
    messages: [{ role: "user", content: "Summarise this" }],
    prompt: "Summarise this"
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.assistant_id, "lead_agent");
  assert.equal(request.config.configurable.thread_id, "thread_1");
  assert.equal(request.config.configurable.model_name, "deepseek-v4-flash");
  assert.equal(request.config.configurable.thinking_enabled, true);
  assert.equal(request.config.configurable.reasoning_effort, "high");
  assert.equal(request.context.thinking_enabled, true);
  assert.equal(request.metadata.agentCardId, "summary");
  assert.equal(request.metadata.subagent.name, "facetwrite-summary");
  assert.deepEqual(request.stream_mode, ["messages-tuple", "custom", "values"]);
});

test("does not expose DeerFlow reasoning kwargs as assistant stream text", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"role":"assistant","content":"","additional_kwargs":{"reasoning_content":"private thinking"}}]\n\n',
    'event: messages-tuple\ndata: [{"role":"assistant","content":"Visible answer"}]\n\n'
  ].join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const fetchImpl = async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/api/v1/auth/setup-status")) return Response.json({ needs_setup: false });
    if (textUrl.endsWith("/api/v1/auth/login/local")) {
      const headers = new Headers();
      headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf_token=csrf; Path=/");
      return Response.json({ ok: true }, { headers });
    }
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
    fetchImpl
  });

  assert.equal(result.text, "Visible answer");
  assert.equal(result.text.includes("private thinking"), false);
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

test("ignores DeerFlow values events that replay prompt messages", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"content":"Visible answer"}]\n\n',
    'event: values\ndata: {"messages":[{"role":"user","content":"# AgentCard\\nInternal prompt"}]}\n\n'
  ].join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const fetchImpl = async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/api/v1/auth/setup-status")) {
      return Response.json({ needs_setup: false });
    }
    if (textUrl.endsWith("/api/v1/auth/login/local")) {
      const headers = new Headers();
      headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf_token=csrf; Path=/");
      return Response.json({ ok: true }, { headers });
    }
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
    fetchImpl
  });

  assert.equal(result.text, "Visible answer");
  assert.equal(result.text.includes("# AgentCard"), false);
});

test("only accepts assistant text from DeerFlow message tuples", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"role":"system","content":"You are FacetWrite system prompt"}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","content":"{\\"query\\":\\"news\\",\\"results\\":[{\\"title\\":\\"raw\\"}]}"}]\n\n',
    'event: messages-tuple\ndata: [{"role":"assistant","content":"Final answer"}]\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":" with detail"}]\n\n'
  ].join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const fetchImpl = async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/api/v1/auth/setup-status")) return Response.json({ needs_setup: false });
    if (textUrl.endsWith("/api/v1/auth/login/local")) {
      const headers = new Headers();
      headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf_token=csrf; Path=/");
      return Response.json({ ok: true }, { headers });
    }
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
    fetchImpl
  });

  assert.equal(result.text, "Final answer with detail");
  assert.equal(result.text.includes("FacetWrite system"), false);
  assert.equal(result.text.includes('"results"'), false);
});
