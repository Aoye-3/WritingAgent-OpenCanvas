import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultAgentSettings, getAgentCard } from "../../agentCards.js";
import { buildRunRequest, runAgentBackendAgent } from "./client.js";

test("builds LangGraph-compatible AgentBackend run request", () => {
  const card = getAgentCard("summary");
  const settings = defaultAgentSettings(card);
  const request = buildRunRequest({
    threadId: "thread_1",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: {
      ...settings,
      model: { ...settings.model, model: "deepseek-v4-flash", thinkingMode: "enabled", reasoningEffort: "high" }
    },
    messages: [{ role: "user", content: "Summarise this" }],
    prompt: "Summarise this",
    allowedToolRefs: ["knowledge_base", "canvas_write"],
    toolState: { knowledge_base: true, canvas_write: true },
    selectedCanvasNodeId: "node_123",
    contextValues: { currentDraft: "Draft body" },
    chatInstruction: "Use the draft"
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.assistant_id, "lead_agent");
  assert.equal(request.config.configurable.thread_id, "thread_1");
  assert.equal(request.config.configurable.model_name, "deepseek--configured");
  assert.equal(request.config.configurable.thinking_enabled, true);
  assert.equal(request.config.configurable.reasoning_effort, "high");
  assert.equal(request.context.thinking_enabled, true);
  assert.deepEqual(request.context.facetwrite_allowed_tool_refs, ["knowledge_base", "canvas_write"]);
  assert.deepEqual(request.context.facetwrite_tool_state, { knowledge_base: true, canvas_write: true });
  assert.deepEqual(request.context.facetwrite_context_values, { currentDraft: "Draft body" });
  assert.equal(request.context.facetwrite_selected_canvas_node_id, "node_123");
  assert.equal(request.context.facetwrite_chat_instruction, "Use the draft");
  assert.equal(request.context.facetwrite_memory_enabled, false);
  assert.equal(request.context.facetwrite_memory_scope_id, "thread_1");
  assert.equal(request.context.facetwrite_project_id, "project_1");
  assert.equal(request.context.facetwrite_plan_phase, "chat");
  assert.equal(request.config.configurable.facetwrite_memory_enabled, false);
  assert.equal(request.metadata.agentCardId, "summary");
  assert.equal(request.metadata.subagent.name, "facetwrite-summary");
  assert.deepEqual(request.stream_mode, ["messages-tuple", "custom", "values"]);
  assert.equal(request.multitask_strategy, "interrupt");
});

test("does not pass Agent-owned memory into a project run", () => {
  const card = getAgentCard("summary");
  const settings = defaultAgentSettings(card);
  const request = buildRunRequest({
    threadId: "thread_1",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: {
      ...settings,
      memory: { enabled: true }
    },
    messages: [{ role: "user", content: "Use memory" }],
    prompt: "Use memory",
    facetwriteMemoryContent: "User prefers project-local references."
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.context.facetwrite_memory_enabled, false);
  assert.equal(request.config.configurable.facetwrite_memory_enabled, false);
  assert.equal("facetwrite_memory_content" in request.context, false);
});

test("does not expose AgentBackend reasoning kwargs as assistant stream text", async () => {
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
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

test("reads AgentBackend stream text and task events", async () => {
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
  const tokens: string[] = [];
  const statuses: string[] = [];
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
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
    onToolEvent: (event) => events.push(event),
    onToken: (token) => tokens.push(token),
    onStatus: (status) => statuses.push(status.phase)
  });

  assert.equal(result.text, "Hello world");
  assert.deepEqual(tokens, ["Hello", " world"]);
  assert.equal(result.events[0]?.eventType, "agent_backend_task_started");
  assert.equal(events.length, 1);
  assert.ok(statuses.includes("thinking"));
  assert.ok(statuses.includes("searching"));
  assert.ok(statuses.includes("writing"));
  assert.equal(runHeaders.get("Cookie"), "access_token=session; csrf_token=csrf");
  assert.equal(runHeaders.get("X-CSRF-Token"), "csrf");
});

test("maps AgentBackend tool calls and results into FacetWrite tool events", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_1","name":"web_search","args":{"query":"OpenAI official homepage"}}]}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","name":"web_search","tool_call_id":"call_1","content":"[{\\"title\\":\\"OpenAI\\",\\"url\\":\\"https://openai.com\\"}]"}]\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Search complete"}]\n\n'
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
      assistantId: "lead_agent",
      auth: { email: "admin@example.com", password: "strong-password", autoSetup: false, timeoutMs: 5000 }
    },
    threadId: "thread_1",
    agentCard: getAgentCard("blog-post"),
    messages: [{ role: "user", content: "Search for OpenAI" }],
    prompt: "Search for OpenAI",
    fetchImpl
  });

  assert.deepEqual(result.events.map((event) => event.eventType), [
    "agent_backend_tool_started",
    "agent_backend_tool_completed"
  ]);
  assert.equal(result.events[0]?.payload?.toolName, "web_search");
  assert.equal(result.events[1]?.payload?.toolCallId, "call_1");
  assert.equal(result.text, "Search complete");
});

test("ignores AgentBackend values events that replay prompt messages", async () => {
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
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

test("uses final values AI message when AgentBackend does not emit assistant message chunks", async () => {
  const body = [
    'event: values\ndata: {"messages":[{"type":"human","content":"Say hello"},{"type":"ai","content":"Hello from AgentBackend"}]}\n\n',
    'event: end\ndata: null\n\n'
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
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
    messages: [{ role: "user", content: "Say hello" }],
    prompt: "Say hello",
    fetchImpl
  });

  assert.equal(result.text, "Hello from AgentBackend");
});

test("only accepts assistant text from AgentBackend message tuples", async () => {
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

  const result = await runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
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

test("explicit Canvas creation forces canvas_write and sends a structured action", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_canvas",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "帮我在画布里创建一个节点" }],
    prompt: "帮我在画布里创建一个节点",
    chatInstruction: "帮我在画布里创建一个节点",
    allowedToolRefs: [],
    toolState: {}
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.equal(request.context.facetwrite_tool_state.canvas_write, true);
  assert.ok(request.context.facetwrite_allowed_tool_refs.includes("canvas_write"));
  assert.equal((request.context.facetwrite_canvas_action as { operation: string }).operation, "create");
});

test("maps structured Canvas envelopes from bridged tool results", async () => {
  const envelope = JSON.stringify({ content: "Committed.", event: { tool: "canvas_write", eventType: "canvas_mutation_committed", nodeId: "node_1", projectId: "project_1", status: "committed" } });
  const body = `event: messages\ndata: [{"type":"tool","name":"canvas_write","tool_call_id":"call_canvas","content":${JSON.stringify(`Committed.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_canvas_mutation_committed" && event.payload.nodeId === "node_1"));
});

test("marks slash Plan requests as the AgentBackend planning phase", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_plan",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "/plan Compare two laptops" }],
    prompt: "/plan Compare two laptops",
    chatInstruction: "/plan Compare two laptops",
    toolState: { plan_clarification_submit: true }
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.context.facetwrite_plan_phase, "planning");
  assert.equal(request.context.facetwrite_plan_stage, "intake");
  assert.equal(request.config.configurable.facetwrite_plan_phase, "planning");
  assert.equal(request.config.configurable.facetwrite_plan_stage, "intake");
});

test("marks an answered Plan as the revision planning stage", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_plan",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Best value" }],
    prompt: "Best value",
    chatInstruction: "Best value",
    contextValues: { awaitingPlan: { id: "plan_1" } },
    toolState: { plan_revision_submit: true }
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.context.facetwrite_plan_stage, "revise");
});

test("returns only the last visible AI message across a tool loop", async () => {
  const body = readFileSync(new URL("./fixtures/plan-tool-loop.sse", import.meta.url), "utf8");
  const result = await runWithBody(body);
  assert.equal(result.text, "Which market and budget should I use?");
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_plan_waiting_for_user"));
});

test("maps structured Plan envelopes from bridged tool results", async () => {
  const envelope = JSON.stringify({ content: "Plan is ready.", event: { tool: "plan_update", eventType: "plan_created", planId: "plan_1" } });
  const body = `event: messages\ndata: [{"type":"tool","name":"plan_update","tool_call_id":"call_plan","content":${JSON.stringify(`Plan is ready.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_plan_created" && event.payload.planId === "plan_1"));
});

test("sends Plan identifiers as top-level AgentBackend runtime context", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_plan",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "/plan Compare two laptops" }],
    prompt: "/plan Compare two laptops",
    chatInstruction: "/plan Compare two laptops",
    contextValues: { planGeneration: { phase: "intake", planId: "plan_1", stepId: "step_1", phaseAttemptId: "attempt_1" } },
    toolState: { plan_clarification_submit: true }
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.context.facetwrite_plan_id, "plan_1");
  assert.equal(request.context.facetwrite_plan_step_id, "step_1");
  assert.equal(request.context.facetwrite_plan_phase_attempt_id, "attempt_1");
});

test("maps rejected Plan submissions as failures instead of completions", async () => {
  const envelope = JSON.stringify({ content: "Invalid clarification.", event: {
    tool: "plan_clarification_submit",
    eventType: "plan_submission_failed",
    reason: "invalid_clarification",
    planId: "plan_1",
    summary: "Exactly one recommendation is required."
  } });
  const body = `event: messages\ndata: [{"type":"tool","name":"plan_clarification_submit","tool_call_id":"call_plan","content":${JSON.stringify(`Error: Invalid clarification.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);

  assert.ok(result.events.some((event) => event.eventType === "agent_backend_tool_failed" && event.payload.reason === "invalid_clarification"));
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_plan_submission_failed"));
  assert.equal(result.events.some((event) => event.eventType === "agent_backend_tool_completed"), false);
});

test("maps committed artifacts as a separate structured event", async () => {
  const envelope = JSON.stringify({ content: "2 artifacts staged.", event: { tool: "artifact_stage", eventType: "artifact_staged", planId: "plan_1", artifacts: [{ id: "a", status: "committed" }] } });
  const body = `event: messages\ndata: [{"type":"tool","name":"artifact_stage","tool_call_id":"call_artifact","content":${JSON.stringify(`2 artifacts staged.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_artifact_staged"));
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_artifact_committed"));
});

async function runWithBody(body: string) {
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
    return new Response(stream, { status: 200 });
  };
  return runAgentBackendAgent({
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    config: {
      enabled: true,
      baseUrl: "http://AgentBackend.local",
      assistantId: "lead_agent",
      auth: { email: "admin@example.com", password: "strong-password", autoSetup: false, timeoutMs: 5000 }
    },
    threadId: "thread_1",
    agentCard: getAgentCard("summary"),
    messages: [{ role: "user", content: "Plan research" }],
    prompt: "Plan research",
    fetchImpl
  });
}
