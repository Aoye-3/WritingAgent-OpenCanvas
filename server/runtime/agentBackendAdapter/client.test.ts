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
    modelSettings: {
      configuredModelApiId: "deepseek--configured",
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "auto",
      maxToolCalls: 20,
      thinkingMode: "enabled",
      reasoningEffort: "high"
    },
    agentCard: card,
    settings,
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
  assert.equal(request.metadata.agentCardId, "chat-agent");
  assert.equal(request.metadata.subagent.name, "facetwrite-chat-agent");
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

test("surfaces AgentBackend heartbeat comments as runtime liveness status", async () => {
  const statuses: string[] = [];
  const signals: string[] = [];
  const result = await runWithBody(": heartbeat\n\n", {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push(signal.type)
  });

  assert.equal(result.events.length, 0);
  assert.deepEqual(signals, ["heartbeat"]);
  assert.ok(statuses.includes("Agent Runtime is still working..."));
});

test("does not let heartbeat overwrite an Agent clarification waiting state", async () => {
  const statuses: string[] = [];
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify","name":"ask_clarification","args":{"question":"Which scope?","options":[{"id":"focused","label":"Focused"},{"id":"broad","label":"Broad"}]}}]}]\n\n',
    ': heartbeat\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label)
  });

  assert.equal(result.events.some((event) => event.eventType === "agent_backend_agent_clarification_requested"), true);
  assert.equal(statuses.includes("Agent Runtime is still working..."), false);
});

test("surfaces Runtime interrupt values as waiting status without tool events", async () => {
  const statuses: string[] = [];
  const signals: string[] = [];
  const body = [
    'event: values\ndata: {"__interrupt__":[{"value":"Need a choice"}]}\n\n',
    ': heartbeat\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push(signal.type)
  });

  assert.equal(result.events.length, 0);
  assert.deepEqual(signals, ["waiting_for_user"]);
  assert.ok(statuses.includes("Waiting for your clarification choice."));
  assert.equal(statuses.includes("Agent Runtime is still working..."), false);
});

test("surfaces llm_retry custom events without creating tool events", async () => {
  const statuses: string[] = [];
  const signals: string[] = [];
  const body = [
    'event: custom\ndata: {"type":"llm_retry","attempt":2,"max_attempts":3,"delay_seconds":600,"status_code":429}\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Recovered"}]\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push(signal.type)
  });

  assert.equal(result.text, "Recovered");
  assert.equal(result.events.length, 0);
  assert.deepEqual(signals, ["llm_retry"]);
  assert.ok(statuses.some((label) => label.includes("Model request retry 2/3")));
  assert.ok(statuses.some((label) => label.includes("600s")));
});

test("surfaces thinking/tool_choice compatibility custom events", async () => {
  const statuses: string[] = [];
  const signals: Array<{ type: string; toolChoice?: unknown }> = [];
  const body = [
    'event: custom\ndata: {"type":"thinking_disabled_for_tool_choice_compatibility","phase":"planning","tool_choice":"plan_clarification_submit","reason":"plan_intake"}\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Ready"}]\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push({ type: signal.type, toolChoice: signal.payload?.tool_choice })
  });

  assert.equal(result.text, "Ready");
  assert.deepEqual(signals, [{ type: "thinking_disabled_for_tool_choice_compatibility", toolChoice: "plan_clarification_submit" }]);
  assert.ok(statuses.includes("Thinking disabled for this forced tool call because the selected model does not support thinking with tool_choice."));
});

test("maps thinking/tool_choice stream errors to actionable messages", async () => {
  const body = 'event: error\ndata: {"message":"LLM request failed: Thinking mode does not support this tool_choice"}\n\n';

  await assert.rejects(
    () => runWithBody(body),
    /Current model does not support thinking with forced tool calls/
  );
});

test("surfaces LLM provider lifecycle custom events without creating tool events", async () => {
  const statuses: string[] = [];
  const signals: string[] = [];
  const body = [
    'event: custom\ndata: {"type":"llm_call_start","attempt":1,"max_attempts":3,"phase":"provider_call"}\n\n',
    'event: custom\ndata: {"type":"llm_call_end","attempt":1,"max_attempts":3,"elapsed_ms":1200,"phase":"provider_call"}\n\n',
    'event: custom\ndata: {"type":"synthesis_gate","phase":"budget_synthesis","reason":"model returned tools after budget synthesis notice","second_handler":true}\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Done"}]\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push(signal.type)
  });

  assert.equal(result.text, "Done");
  assert.equal(result.events.length, 0);
  assert.deepEqual(signals, ["llm_call_start", "llm_call_end", "synthesis_gate"]);
  assert.ok(statuses.includes("Waiting for model response..."));
  assert.ok(statuses.includes("Model response received."));
  assert.ok(statuses.includes("Forcing final synthesis..."));
});

test("surfaces stream chunk timeout retry metadata without creating tool events", async () => {
  const statuses: string[] = [];
  const signals: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const body = [
    'event: custom\ndata: {"type":"llm_call_error","attempt":1,"max_attempts":3,"phase":"provider_call","reason":"stream_chunk_timeout","error_type":"StreamChunkTimeoutError","model":"deepseek-v4-flash","provider_class":"PatchedChatDeepSeek","base_url_host":"api.siliconflow.cn","timeout_s":180,"stream_chunk_timeout_s":45,"max_retries":2}\n\n',
    'event: custom\ndata: {"type":"llm_retry","attempt":1,"max_attempts":3,"wait_ms":1000,"reason":"stream_chunk_timeout","model":"deepseek-v4-flash","provider_class":"PatchedChatDeepSeek","base_url_host":"api.siliconflow.cn","timeout_s":180,"stream_chunk_timeout_s":45,"max_retries":2}\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Recovered"}]\n\n'
  ].join("");

  const result = await runWithBody(body, {
    onStatus: (status) => statuses.push(status.label),
    onRuntimeSignal: (signal) => signals.push(signal)
  });

  assert.equal(result.text, "Recovered");
  assert.equal(result.events.length, 0);
  assert.deepEqual(signals.map((signal) => signal.type), ["llm_call_error", "llm_retry"]);
  assert.ok(statuses.includes("Model stream produced no content before timeout."));
  assert.ok(statuses.some((label) => label.includes("Model stream produced no content; retry 1/3.")));
  assert.equal(signals[0].payload?.stream_chunk_timeout_s, 45);
  assert.equal(signals[1].payload?.timeout_s, 180);
});

test("maps AgentBackend tool calls and results into FacetWrite tool events", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_1","name":"web_search","args":{"query":"OpenAI official homepage"}}]}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","name":"web_search","tool_call_id":"call_1","content":"[{\\"title\\":\\"OpenAI\\",\\"url\\":\\"https://openai.com\\",\\"snippet\\":\\"AI research and products\\"}]"}]\n\n',
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
  assert.equal(result.events[0]?.payload?.query, "OpenAI official homepage");
  assert.equal(result.events[1]?.payload?.toolCallId, "call_1");
  assert.deepEqual(result.events[1]?.payload?.sources, [{ title: "OpenAI", url: "https://openai.com", snippet: "AI research and products" }]);
  assert.equal(result.text, "Search complete");
});

test("treats AgentBackend end event as business completion even when stream stays open", async () => {
  let canceled = false;
  const body = [
    'event: values\ndata: {"messages":[{"type":"human","content":"Say hello"},{"type":"ai","content":"Hello from end"}]}\n\n',
    'event: end\ndata: null\n\n',
    ': heartbeat\n\n'
  ].join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
    },
    cancel() {
      canceled = true;
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
    agentCard: getAgentCard("summary"),
    messages: [{ role: "user", content: "Say hello" }],
    prompt: "Say hello",
    fetchImpl
  });

  assert.equal(result.text, "Hello from end");
  assert.equal(canceled, true);
});

test("maps web fetch and read file tool results into sanitized progress payloads", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"fetch_1","name":"web_fetch","args":{"url":"https://example.com/paper"}},{"id":"read_1","name":"read_file","args":{"path":"/mnt/user-data/workspace/report.md","start_line":10,"end_line":20}}]}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","name":"web_fetch","tool_call_id":"fetch_1","content":"Fetched article summary with API_KEY=secret-token and useful agent findings."}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","name":"read_file","tool_call_id":"read_1","content":"# AgentCard\\nInternal prompt\\nVisible file finding about agent workflows."}]\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"Done"}]\n\n'
  ].join("");

  const result = await runWithBody(body);
  const fetchEvent = result.events.find((event) => event.payload?.toolName === "web_fetch" && event.eventType === "agent_backend_tool_completed");
  const readEvent = result.events.find((event) => event.payload?.toolName === "read_file" && event.eventType === "agent_backend_tool_completed");

  assert.equal(fetchEvent?.payload?.url, "https://example.com/paper");
  assert.match(String(fetchEvent?.payload?.snippet), /Fetched article summary/);
  assert.equal(String(fetchEvent?.payload?.snippet).includes("secret-token"), false);
  assert.equal(readEvent?.payload?.path, "/mnt/user-data/workspace/report.md");
  assert.equal(readEvent?.payload?.startLine, 10);
  assert.equal(readEvent?.payload?.endLine, 20);
  assert.match(String(readEvent?.payload?.snippet), /Visible file finding/);
  assert.equal(String(readEvent?.payload?.snippet).includes("# AgentCard"), false);
});

test("surfaces AgentBackend stream error events as runtime failures", async () => {
  const body = [
    'event: error\ndata: {"message":"Recursion limit of 100 reached without hitting a stop condition.","type":"budget_exhausted","recursion_limit":100,"estimated_steps_used":99}\n\n'
  ].join("");

  await assert.rejects(
    () => runWithBody(body),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Recursion limit of 100 reached without hitting a stop condition/);
      assert.deepEqual((error as Error & { facetwriteBudgetStatus?: unknown }).facetwriteBudgetStatus, {
        status: "budget_exhausted",
        canResume: true,
        recursionLimit: 100,
        estimatedStepsUsed: 99
      });
      return true;
    }
  );
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

test("ignores final values ask_clarification tool message as visible text", async () => {
  const body = [
    'event: values\ndata: {"messages":[{"type":"human","content":"Review papers"},{"type":"tool","name":"ask_clarification","tool_call_id":"call_clarify","content":"需要确认综述的时间范围吗？"}]}\n\n',
    'event: end\ndata: null\n\n'
  ].join("");

  const result = await runWithBody(body);

  assert.equal(result.text, "");
});

test("ignores streamed ask_clarification tool message as visible text", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"tool","name":"ask_clarification","tool_call_id":"call_clarify","content":"请选择时间范围：\\n  1. 2024-2026\\n  2. 2025-2026"}]\n\n'
  ].join("");

  const result = await runWithBody(body);

  assert.equal(result.text, "");
  assert.equal(result.events.some((event) => event.eventType === "agent_backend_tool_completed" && event.payload.toolName === "ask_clarification"), false);
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

  const toolState = request.context.facetwrite_tool_state as Record<string, boolean>;
  assert.equal(toolState.canvas_write, true);
  assert.ok(request.context.facetwrite_allowed_tool_refs.includes("canvas_write"));
  assert.equal((request.context.facetwrite_canvas_action as { operation: string }).operation, "create");
});

test("sends Canvas delivery contract as top-level AgentBackend context", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_canvas_delivery",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "summarize this to canvas" }],
    prompt: "summarize this to canvas",
    contextValues: {
      canvasDeliveryContract: {
        id: "facetwrite_canvas_delivery_v1",
        format: "facetwrite_canvas_delivery",
        locale: "en"
      }
    },
    chatInstruction: "summarize this to canvas"
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.deepEqual(request.context.facetwrite_canvas_delivery_contract, {
    id: "facetwrite_canvas_delivery_v1",
    format: "facetwrite_canvas_delivery",
    locale: "en"
  });
  assert.equal(JSON.stringify(request.context.facetwrite_canvas_delivery_contract).includes("reasoning"), false);
});

test("sends a research tool limit for direct Canvas delivery runs", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_research_canvas",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Research LLM agents and save each search round to Canvas nodes." }],
    prompt: "Research LLM agents and save each search round to Canvas nodes.",
    chatInstruction: "Research LLM agents and save each search round to Canvas nodes.",
    toolState: { web_search: true }
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.equal(request.context.facetwrite_research_tool_limit, 8);
  assert.equal(request.config.configurable.facetwrite_research_tool_limit, 8);
});

test("sends progressive Canvas evidence controls for skill long tasks", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_skill_long_task",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Review recent agent literature" }],
    prompt: "Review recent agent literature",
    chatInstruction: "Review recent agent literature",
    allowedToolRefs: [...card.toolRefs, "ask_clarification"],
    contextValues: {
      progressiveCanvasDelivery: {
        enabled: true,
        runtimeBudgetProfile: "medium",
        recursionLimit: 110,
        modelCallLimit: 24,
        evidenceToolLimit: 12,
        bodyDraftWriteLimit: 3,
        synthesisReserveSteps: 22,
        forceSynthesisAfterEvidence: true,
        evidenceTools: ["web_search", "web_fetch", "read_file", "bash"]
      }
    },
    toolState: { web_search: true }
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.equal(request.context.facetwrite_progressive_canvas_delivery_enabled, true);
  assert.equal(request.config.configurable.facetwrite_progressive_canvas_delivery_enabled, true);
  assert.equal(request.config.recursion_limit, 110);
  assert.equal(request.context.facetwrite_runtime_budget_profile, "medium");
  assert.equal(request.context.facetwrite_recursion_limit, 110);
  assert.equal(request.context.facetwrite_model_call_limit, 24);
  assert.equal(request.context.facetwrite_evidence_tool_limit, 12);
  assert.equal(request.context.facetwrite_body_draft_write_limit, 3);
  assert.equal(request.context.facetwrite_synthesis_reserve_steps, 22);
  assert.equal(request.context.facetwrite_force_synthesis_after_evidence, true);
  assert.equal((request.context as Record<string, unknown>).facetwrite_force_synthesis_after_body_drafts, undefined);
  assert.equal(request.context.facetwrite_markdown_file_delivery_required, true);
  assert.ok(request.context.facetwrite_allowed_tool_refs.includes("write_file"));
  assert.ok(request.context.facetwrite_allowed_tool_refs.includes("present_files"));
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("ask_clarification"), true);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("canvas_write"), true);
  assert.equal((request.context.facetwrite_tool_state as Record<string, unknown>).canvas_write, true);
  assert.equal(request.context.facetwrite_canvas_write_scope, "short_progress_nodes");
  assert.equal((request.context.facetwrite_canvas_write_policy as { maxContentChars?: number }).maxContentChars, 2400);
  assert.equal((request.context.facetwrite_context_values as Record<string, unknown>).facetwrite_canvas_write_scope, "short_progress_nodes");
  assert.match(String(request.context.facetwrite_markdown_file_delivery_policy), /Use canvas_write only for short progressive nodes/);
  assert.match(String(request.context.facetwrite_task_completion_policy), /exactly one structured multiple-choice clarification/);
  assert.match(String(request.context.facetwrite_clarification_policy), /ask_clarification/);
  assert.deepEqual(request.context.facetwrite_evidence_tools, ["web_search", "web_fetch", "read_file", "bash"]);
});

test("preserves progressive Canvas budget after an answered skill clarification", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_skill_long_task_answered",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Review recent agent literature\n\nSelected clarification: Recent review" }],
    prompt: "Review recent agent literature\n\nSelected clarification: Recent review",
    chatInstruction: "Review recent agent literature\n\nSelected clarification: Recent review",
    allowedToolRefs: [...card.toolRefs, "ask_clarification"],
    contextValues: {
      agentClarification: {
        clarificationId: "skill_clarification_1",
        selectedOptionId: "recent",
        answer: "Recent review"
      },
      progressiveCanvasDelivery: {
        enabled: true,
        runtimeBudgetProfile: "medium",
        recursionLimit: 110,
        modelCallLimit: 24,
        evidenceToolLimit: 12,
        bodyDraftWriteLimit: 3,
        synthesisReserveSteps: 22,
        forceSynthesisAfterEvidence: true,
        evidenceTools: ["web_search", "web_fetch", "read_file", "bash"]
      }
    },
    toolState: { web_search: true }
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.equal(request.config.recursion_limit, 110);
  assert.equal(request.context.facetwrite_progressive_canvas_delivery_enabled, true);
  assert.equal(request.context.facetwrite_runtime_budget_profile, "medium");
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("web_search"), true);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("write_file"), true);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("canvas_write"), true);
  assert.equal((request.context.facetwrite_tool_state as Record<string, unknown>).canvas_write, true);
  assert.equal(request.context.facetwrite_canvas_write_scope, "short_progress_nodes");
});

test("skill clarification guard exposes only ask_clarification even with progressive Canvas context", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_skill_guard",
    projectId: "project_canvas",
    configuredModelApiId: "deepseek--configured",
    modelSettings: {
      configuredModelApiId: "deepseek--configured",
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "auto",
      maxToolCalls: 20,
      thinkingMode: "enabled",
      reasoningEffort: "high"
    },
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Review recent agent literature" }],
    prompt: "Review recent agent literature",
    chatInstruction: "Review recent agent literature",
    allowedToolRefs: ["ask_clarification", "web_search", "canvas_write", "write_file", "present_files"],
    contextValues: {
      facetwrite_clarification_policy: { mode: "skill_scope_guard", instruction: "Call ask_clarification." },
      canvasAction: { id: "canvas_action_create", operation: "create", risk: "low", requiresTool: true },
      progressiveCanvasDelivery: {
        enabled: true,
        runtimeBudgetProfile: "high",
        recursionLimit: 140,
        modelCallLimit: 32,
        evidenceToolLimit: 16,
        bodyDraftWriteLimit: 4,
        synthesisReserveSteps: 28,
        forceSynthesisAfterEvidence: true,
        evidenceTools: ["web_search", "web_fetch", "read_file", "bash"]
      }
    },
    toolState: { web_search: true, knowledge_base: true, canvas_write: true }
  }, { enabled: true, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" });

  assert.deepEqual(request.context.facetwrite_allowed_tool_refs, ["ask_clarification"]);
  assert.deepEqual(request.context.facetwrite_tool_state, { ask_clarification: true });
  assert.equal(request.context.facetwrite_canvas_action, undefined);
  assert.equal(request.context.facetwrite_markdown_file_delivery_required, undefined);
  assert.equal(request.context.facetwrite_progressive_canvas_delivery_enabled, undefined);
  assert.equal(request.context.facetwrite_evidence_tools, undefined);
  assert.equal(request.context.facetwrite_canvas_write_scope, undefined);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("web_search"), false);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("canvas_write"), false);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("write_file"), false);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("present_files"), false);
  assert.equal(request.config.configurable.thinking_enabled, false);
  assert.equal(request.context.thinking_enabled, false);
  assert.equal(request.config.configurable.reasoning_effort, undefined);
  assert.equal(request.context.reasoning_effort, undefined);
  assert.equal(request.config.configurable.facetwrite_clarification_phase, "clarification_guard");
  assert.equal(request.context.facetwrite_clarification_phase, "clarification_guard");
  assert.deepEqual(request.config.configurable.facetwrite_clarification_policy, {
    mode: "skill_scope_guard",
    instruction: "Call ask_clarification."
  });
  assert.deepEqual(request.context.facetwrite_clarification_policy, {
    mode: "skill_scope_guard",
    instruction: "Call ask_clarification."
  });
  assert.deepEqual((request.context.facetwrite_context_values as Record<string, unknown>).facetwrite_clarification_policy, {
    mode: "skill_scope_guard",
    instruction: "Call ask_clarification."
  });
});

test("maps ask_clarification tool calls into structured Agent clarification events", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify","name":"ask_clarification","args":{"question":"Which scope should I use?","options":[{"id":"focused","label":"Focused","detail":"Use the existing core papers.","recommended":true},{"id":"broad","label":"Broad","detail":"Run an extra search round.","recommended":false}]}}]}]\n\n'
  ].join("");

  const result = await runWithBody(body);
  const clarification = result.events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(clarification);
  assert.equal(clarification.payload.toolCallId, "call_clarify");
  assert.equal(clarification.payload.question, "Which scope should I use?");
  assert.equal(Array.isArray(clarification.payload.options), true);
  assert.equal(result.text, "");
});

test("does not keep clarification_required after runtime continues with tools", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify","name":"ask_clarification","args":{"question":"Which citation format?","options":[{"id":"apa","label":"APA","detail":"APA 7th","recommended":true},{"id":"ieee","label":"IEEE","detail":"IEEE style"}]}}]}]\n\n',
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_search","name":"web_search","args":{"query":"recent AI agent survey"}}]}]\n\n',
    'event: messages-tuple\ndata: [{"type":"tool","name":"web_search","tool_call_id":"call_search","content":"[]"}]\n\n',
    'event: end\ndata: null\n\n'
  ].join("");

  const result = await runWithBody(body);

  assert.equal(result.finishReason, "agent_backend_completed");
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_agent_clarification_requested"));
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_tool_completed" && event.payload.toolName === "web_search"));
});

test("maps ask_clarification tool calls with JSON string args", async () => {
  const args = JSON.stringify({
    question: "Which scope should I use?",
    options: [
      { id: "focused", label: "Focused", detail: "Use the existing core papers.", recommended: true },
      { id: "broad", label: "Broad", detail: "Run an extra search round.", recommended: false }
    ]
  });
  const body = `event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify_json_args","name":"ask_clarification","args":${JSON.stringify(args)}}]}]\n\n`;

  const result = await runWithBody(body);
  const clarification = result.events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(clarification);
  assert.equal(clarification.payload.toolCallId, "call_clarify_json_args");
  assert.equal(clarification.payload.question, "Which scope should I use?");
  assert.equal(result.events.some((event) => event.eventType === "agent_backend_agent_clarification_invalid"), false);
  assert.equal(result.text, "");
});

test("maps structured ask_clarification ToolMessage artifacts and ignores partial chunks", async () => {
  const artifact = {
    type: "agent_clarification_requested",
    question: "Which research scope should I use?",
    options: [
      { id: "recent", label: "Recent", detail: "Focus on recent papers.", recommended: true },
      { id: "broad", label: "Broad", detail: "Scan the wider literature." }
    ]
  };
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify_partial","name":"ask_clarification","args":""}]}]\n\n',
    `event: messages-tuple\ndata: [{"type":"tool","name":"ask_clarification","tool_call_id":"call_clarify_partial","content":"Which research scope should I use?","artifact":${JSON.stringify(artifact)}}]\n\n`
  ].join("");

  const result = await runWithBody(body);
  const clarification = result.events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(clarification);
  assert.equal(clarification.payload.source, "runtime_tool_message_artifact");
  assert.equal(clarification.payload.toolCallId, "call_clarify_partial");
  assert.equal(clarification.payload.question, "Which research scope should I use?");
  assert.equal(result.events.some((event) => event.eventType === "agent_backend_agent_clarification_invalid"), false);
  assert.equal(result.text, "");
});

test("maps values-only structured ask_clarification ToolMessage artifacts", async () => {
  const artifact = {
    type: "agent_clarification_requested",
    question: "Which delivery should I prepare?",
    options: [
      { id: "summary", label: "Summary", detail: "Prepare a concise summary.", recommended: true },
      { id: "report", label: "Report", detail: "Prepare a full report." }
    ]
  };
  const body = `event: values\ndata: {"messages":[{"type":"tool","name":"ask_clarification","tool_call_id":"call_values_clarify","content":"ignored formatted text","additional_kwargs":{"facetwrite_clarification":${JSON.stringify(artifact)}}}]}\n\n`;

  const result = await runWithBody(body);
  const clarification = result.events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(clarification);
  assert.equal(clarification.payload.source, "runtime_tool_message_artifact");
  assert.equal(clarification.payload.toolCallId, "call_values_clarify");
  assert.equal(clarification.payload.question, "Which delivery should I prepare?");
  assert.equal(result.text, "");
});

test("maps native ask_clarification string options into structured Agent clarification events", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_clarify_strings","name":"ask_clarification","args":{"question":"Which scope should I use?","clarification_type":"approach_choice","options":["Focused review","Broad review","Fast scan"]}}]}]\n\n'
  ].join("");

  const result = await runWithBody(body);
  const clarification = result.events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(clarification);
  assert.equal(clarification.payload.toolCallId, "call_clarify_strings");
  assert.deepEqual(clarification.payload.options, [
    { id: "option_1", label: "Focused review", detail: "", recommended: true },
    { id: "option_2", label: "Broad review", detail: "", recommended: false },
    { id: "option_3", label: "Fast scan", detail: "", recommended: false }
  ]);
  assert.equal(result.text, "");
});

test("maps structured assistant clarification JSON and suppresses raw assistant text", async () => {
  const clarification = {
    type: "agent_clarification_requested",
    question: "Which Agent scope should I review?",
    options: [
      { id: "llm_agents", label: "LLM agents", detail: "Focus on recent LLM agent systems.", recommended: true },
      { id: "multi_agent", label: "Multi-agent", detail: "Focus on coordination and collaboration." }
    ]
  };
  const body = `event: messages-tuple\ndata: [{"type":"ai","content":${JSON.stringify(JSON.stringify(clarification))}}]\n\n`;

  const result = await runWithBody(body);
  const event = result.events.find((item) => item.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(event);
  assert.equal(event.payload.source, "assistant_structured_object");
  assert.equal(event.payload.question, "Which Agent scope should I review?");
  assert.equal(result.text, "");
});

test("maps values-only structured assistant clarification JSON into an event", async () => {
  const clarification = {
    type: "agent_clarification_requested",
    question: "Which Agent scope should I review?",
    options: [
      { id: "recent", label: "Recent", detail: "Focus on recent papers.", recommended: true },
      { id: "broad", label: "Broad", detail: "Scan broadly." }
    ]
  };
  const body = `event: values\ndata: {"messages":[{"type":"ai","content":${JSON.stringify(JSON.stringify(clarification))}}]}\n\n`;

  const result = await runWithBody(body);
  const event = result.events.find((item) => item.eventType === "agent_backend_agent_clarification_requested");

  assert.ok(event);
  assert.equal(event.payload.source, "assistant_structured_object");
  assert.equal(event.payload.question, "Which Agent scope should I review?");
  assert.equal(result.text, "");
});

test("emits invalid clarification diagnostics for malformed ask_clarification payloads", async () => {
  const body = [
    'event: messages-tuple\ndata: [{"type":"ai","content":"","tool_calls":[{"id":"call_bad_clarify","name":"ask_clarification","args":{"question":"Which scope?","options":[{"id":"only","label":"Only one"}]}}]}]\n\n'
  ].join("");

  const result = await runWithBody(body);
  const event = result.events.find((item) => item.eventType === "agent_backend_agent_clarification_invalid");

  assert.ok(event);
  assert.equal(event.payload.toolCallId, "call_bad_clarify");
  assert.equal(event.payload.reason, "insufficient_options");
  assert.equal(event.payload.hasQuestion, true);
  assert.equal(event.payload.optionCount, 1);
  assert.deepEqual(event.payload.optionShape, ["object:id,label"]);
  assert.equal(result.text, "");
});

test("maps structured Canvas envelopes from bridged tool results", async () => {
  const envelope = JSON.stringify({ content: "Committed.", event: { tool: "canvas_write", eventType: "canvas_mutation_committed", nodeId: "node_1", projectId: "project_1", status: "committed" } });
  const body = `event: messages\ndata: [{"type":"tool","name":"canvas_write","tool_call_id":"call_canvas","content":${JSON.stringify(`Committed.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_canvas_mutation_committed" && event.payload.nodeId === "node_1"));
});

test("maps canvas_write tool_failed envelopes as Canvas mutation failures", async () => {
  const envelope = JSON.stringify({
    content: "Canvas write request failed: Missing target.",
    event: {
      tool: "canvas_write",
      eventType: "tool_failed",
      reason: "request_failed",
      summary: "Canvas write request failed: Missing target."
    }
  });
  const body = `event: messages\ndata: [{"type":"tool","name":"canvas_write","tool_call_id":"call_canvas","content":${JSON.stringify(`Error: Canvas write request failed: Missing target.\n__FACETWRITE_EVENT__${envelope}`)}}]\n\n`;
  const result = await runWithBody(body);

  assert.ok(result.events.some((event) => event.eventType === "agent_backend_tool_failed" && event.payload.reason === "request_failed" && event.payload.summary === "Canvas write request failed: Missing target."));
  assert.ok(result.events.some((event) => event.eventType === "agent_backend_canvas_mutation_failed" && event.payload.reason === "request_failed"));
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

test("marks auto preflight Plan requests as planning with Plan-only tools", () => {
  const card = getAgentCard("summary");
  const request = buildRunRequest({
    threadId: "thread_plan",
    projectId: "project_1",
    configuredModelApiId: "deepseek--configured",
    agentCard: card,
    settings: defaultAgentSettings(card),
    messages: [{ role: "user", content: "Research agent planning systems and write a report" }],
    prompt: "Research agent planning systems and write a report",
    chatInstruction: "Research agent planning systems and write a report",
    planPhase: "preflight",
    planId: "plan_1",
    allowedToolRefs: ["plan_clarification_submit", "plan_revision_submit", "web_search", "canvas_write"],
    toolState: {
      plan_clarification_submit: true,
      plan_revision_submit: true,
      web_search: false,
      canvas_write: false
    }
  }, {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    assistantId: "lead_agent"
  });

  assert.equal(request.context.facetwrite_plan_phase, "planning");
  assert.equal(request.context.facetwrite_plan_stage, "preflight");
  assert.equal(request.context.facetwrite_plan_id, "plan_1");
  assert.ok(Array.isArray(request.context.facetwrite_allowed_tool_refs));
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("plan_clarification_submit"), true);
  assert.equal(request.context.facetwrite_allowed_tool_refs.includes("plan_revision_submit"), true);
  assert.deepEqual(request.context.facetwrite_tool_state, {
    plan_clarification_submit: true,
    plan_revision_submit: true,
    web_search: false,
    canvas_write: false
  });
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

type RunWithBodyCallbacks = {
  onReasoningToken?: Parameters<typeof runAgentBackendAgent>[0]["onReasoningToken"];
  onRuntimeSignal?: Parameters<typeof runAgentBackendAgent>[0]["onRuntimeSignal"];
  onStatus?: Parameters<typeof runAgentBackendAgent>[0]["onStatus"];
  onToken?: Parameters<typeof runAgentBackendAgent>[0]["onToken"];
  onToolEvent?: Parameters<typeof runAgentBackendAgent>[0]["onToolEvent"];
};

async function runWithBody(body: string, callbacks: RunWithBodyCallbacks = {}) {
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
    fetchImpl,
    ...callbacks
  });
}
