# Agent Runtime Runbook

Agent Runtime is the primary AI execution subsystem when `AGENT_BACKEND_ENABLED=true`. The same Gateway, auth, SSE, Lead Agent/subagent, Skills, MCP, Memory, ACP, provider, and FacetWrite ToolUse bridge code runs in all deployment modes.

## Modes

- `local` (default): managed launchers choose an available `127.0.0.1` port and record it in ownership metadata; direct low-level calls can pin a port with `AGENT_RUNTIME_PORT`.
- `docker`: explicit Compose isolation/deployment mode through nginx on `127.0.0.1:2026`.
- `external`: FacetWrite connects to `AGENT_BACKEND_BASE_URL` and does not manage lifecycle.

The default local path does not start the Runtime Next.js frontend or nginx because neither carries core Agent capability.

## Requirements

- Node.js 22+, including `npm` and `npx` for JavaScript Skills, stdio MCP, and ACP adapters.
- `uv`; the launcher installs managed Python 3.12 into `modules/agent-runtime/backend/.uv-python`, syncs `uv.lock` into `.venv`, and launches only `.venv/Scripts/python.exe`. Both the managed interpreter and virtual environment must resolve inside the workspace.
- Docker Desktop/Engine only for `docker` mode.

## Configuration

```env
AGENT_RUNTIME_MODE=local
AGENT_BACKEND_ENABLED=true
AGENT_RUNTIME_PORT=0
AGENT_BACKEND_ASSISTANT_ID=lead_agent
AGENT_BACKEND_AUTH_EMAIL=admin@example.com
AGENT_BACKEND_AUTH_PASSWORD=<local password>
```

The local launcher reads process environment first, then `modules/agent-runtime/.env`, then root `.env.local`. Managed local startup ignores a stale `.env.local` `AGENT_BACKEND_BASE_URL`; use `AGENT_RUNTIME_PORT=<port>` or a process-level `AGENT_BACKEND_BASE_URL` when a fixed local port is required. App Shell and `npm run dev` are managed local dynamic-port flows. If the Express API/server config is run directly without launcher-injected `AGENT_BACKEND_BASE_URL`, it keeps `http://127.0.0.1:8001` only as a low-level debugging fallback. It sets project, home, config, extensions, Skills, and FacetWrite bridge paths explicitly. Secrets are never printed. Runtime state remains in `modules/agent-runtime/backend/.deer-flow` in both local and Docker modes.

## Lifecycle

```powershell
npm.cmd run agent-runtime:doctor
npm.cmd run agent-runtime:up
npm.cmd run agent-runtime:status
npm.cmd run agent-runtime:down
```

Logs and ownership metadata are written under `modules/agent-runtime/logs/`. The metadata includes the actual local port, PID, Bridge URL, source fingerprint, and token fingerprint. A healthy compatible project-owned process is reused only while its source fingerprint still matches; changed Python/config sources trigger a managed restart. An unmanaged or incompatible process on the configured port blocks startup. Shutdown only terminates the process recorded as project-owned. `status` and `down` read the actual port from ownership metadata.

Docker remains available explicitly:

```powershell
npm.cmd run agent-runtime:docker:up
npm.cmd run agent-runtime:docker:status
npm.cmd run agent-runtime:docker:down
```

## Security And Capability Boundary

Local mode uses `deerflow.sandbox.local:LocalSandboxProvider` with `allow_host_bash: false`. It preserves Gateway auth/cookies/CSRF, `/api/runs/stream`, Skills and hot reload, stdio/HTTP/SSE MCP, Memory/SQLite/uploads/events, web search, providers, ACP, subagents, and the FacetWrite bridge tools `knowledge_base`, `clear_context`, and `canvas_write`.

`canvas_write` directly commits low-risk create and append operations with stable IDs. Replace, range replacement, delete, and other destructive operations remain approval-gated.

The local sandbox tool surface also exposes file tools used by long-form deliverables: `read_file`, `list_directory`, `write_file`, and `present_files`. Keep argument aliases compatible with model/tool-call variants: `file_path` maps to `path`, and `file_paths` maps to `filepaths`.

These remain Docker-specific and are not claimed as local equivalents: `AioSandboxProvider`, Kubernetes Provisioner, Docker socket/Docker-out-of-Docker, and Bash Skills that require Linux containers.

## Smoke Checks

```powershell
Invoke-RestMethod http://127.0.0.1:<metadata-port>/health
Invoke-RestMethod http://127.0.0.1:8837/api/agent-runtime/status
```

Expected FacetWrite status includes `reachable:true`, authenticated runtime state, `runtimeProvider:"agent-backend"`, `deploymentMode:"local"`, and the LocalSandbox provider. Acceptance should also execute Python and Node Skills, a temporary stdio MCP, built-in tools, all four bridge tools, repeated no-Mock generations, and verify Canvas approval.

The maintained end-to-end local acceptance is:

```powershell
npm.cmd run acceptance:local-runtime
```

It starts from `start-opencanvas-shell.vbs`, requires Docker and port `2026` to remain absent, and verifies five UI generations with `provider:"agent-backend"` and `usedMock:false`. It then verifies a Skill-driven `read_file` followed by live `web_search`, Agent Runtime `memory.json` persistence, visible tool start/completion events, low-risk Canvas commits, and destructive Canvas approval.

## Troubleshooting

- `uv`/Node/npm/npx missing: run `npm.cmd run agent-runtime:doctor` and install the reported prerequisite.
- Need a stable local Runtime port: set `AGENT_RUNTIME_PORT=<port>` before starting, or use process-level `AGENT_BACKEND_BASE_URL=http://127.0.0.1:<port>`.
- Gateway startup failure: inspect `modules/agent-runtime/logs/gateway-local.err.log`; the launcher rolls back its owned process.
- Missing model variables: configure `.env.local` or `modules/agent-runtime/.env` without committing secrets.
- Protected endpoints return 401/403: verify Agent Runtime setup/login credentials; do not bypass auth.
- stdio MCP cannot find `npx`: confirm Node is on PATH; the launcher prepends discovered Node/npm/npx directories.
- Docker bridge failure: use `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:<api-port>`.
- Local bridge failure: use `http://127.0.0.1:<api-port>`.
- If the Agent asks a blocking clarification but the right composer shows Markdown text instead of buttons, verify that the stream contains `agent_backend_agent_clarification_requested` and that the run timeline mirrors it with `status:"waiting"`. The expected path is Runtime `ask_clarification` -> structured ToolMessage artifact or complete tool-call args -> FacetWrite structured Agent clarification event -> waiting run timeline event -> composer choice card. Plain assistant prose with numbered options is not upgraded into buttons, and structured Agent clarification must not create a Canvas node.
- If a research-scope Skill clarification fails with `AgentBackend skill scope guard requires a structured ask_clarification response`, inspect `modules/agent-runtime/logs/gateway-local.err.log` before debugging the frontend. If the provider error is `Thinking mode does not support this tool_choice`, the phase-one guard did not disable provider thinking/reasoning before forcing `tool_choice="ask_clarification"`. If the Runtime log instead shows `HTTP/1.1 200 OK`, `ClarificationMiddleware - Intercepted clarification request`, and the UI reports `Agent clarification payload was invalid: missing_question`, the provider call succeeded and the failure is the Runtime-to-Node protocol bridge: check whether the adapter ignored partial streamed `AIMessageChunk.tool_calls`, parsed JSON-string `args`, and consumed the `ask_clarification` ToolMessage `artifact` or `additional_kwargs.facetwrite_clarification`. Keep the strict protocol intact; do not parse formatted ToolMessage content, Markdown option lists, or ordinary prose into buttons.
- The Skill scope guard is a two-phase run. Phase one must expose only `ask_clarification`, set `facetwrite_clarification_phase:"clarification_guard"`, disable thinking/reasoning controls for provider compatibility, and remove Canvas/progressive/file/evidence delivery context. Phase two starts only after `requestContext.agentClarification` is present and restores normal Skills, provider thinking settings, runtime budget, and long-task progressive delivery eligibility.
- Long runs that call `write_file` or `present_files` for `/mnt/user-data/outputs/*.md` must produce a `file_document` Canvas node. If Runtime does not call file tools but the run is a medium/long progressive Canvas delivery, Node finalization writes a fallback Markdown file under `.facetwrite/threads/<threadId>/user-data/outputs/` and creates the same document node. If the timeline shows completed file tools but no document node, inspect the safe tool args in the AgentBackend adapter, the `canvas_delivery_file_document_committed` event, and `metadata.fileDocument.path`. The node should contain only a short file summary; the full Markdown is loaded through `/api/threads/:threadId/canvas/document-preview`.
- If `List Directory` fails, confirm the Agent Runtime config exposes `list_directory` and that the Python tool delegates to the existing `ls` implementation. The UI label is only a timeline label; the compatibility contract is the tool name plus safe `path` argument.
- Long batch-delivery runs that end with `GraphRecursionError` or `Recursion limit of 100 reached` are usually tool-loop or budget-planning failures, not missing UI rendering. Inspect `modules/agent-runtime/logs/gateway-local.err.log` for the original runtime error, then confirm the stream emitted `agent_backend_tool_completed`, `canvas_delivery_research_committed`, `canvas_delivery_body_checkpoint_committed`, and on failure `canvas_delivery_failed_summary_committed` events. Progressive `研究摘录 N` / `Research note N` or `进度摘录 N` / `Progress note N` nodes and the latest `正文草稿` / `Body draft` checkpoint should remain as recoverable work. Checkpoint events carry only live hints such as `nodeId`, `contentPreview`, and `contentHash`; refresh Thread state for full draft content. The final `正文` / `Body` node is updated only after final synthesis succeeds. The run must still fail if no final assistant text or final structured lifecycle outcome exists.
- If a short answer, Plan clarification, or process acknowledgement appears as a Canvas node, inspect `contextValues.taskHandlingPolicy` before checking model output. `simple_chat` and `plan_intake` must be conversation-only; only `long_task`, `plan_execution`, and `explicit_canvas` may enable progressive or direct Canvas delivery. Finalization also blocks process clarification text and internal Runtime protocol text, so DSML/tool-call leakage should produce a runtime failure with preserved safe progress rather than a final Canvas body.
- Generation failures: inspect stable `model_required`, `model_not_ready`, `runtime_unavailable`, or `runtime_auth_failed` diagnostics. Do not enable Mock fallback for acceptance testing.
- Deliberate local Mock demonstration only: set `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; unset it before real Runtime verification.

### Skill Clarification Budget Continuation

The Skill scope guard is still a strict two-phase protocol. Phase one exposes only `ask_clarification` and removes Canvas/progressive/file/evidence delivery context from the Runtime request, but the structured clarification event must carry enough `resumeContext` for phase two: original instruction, transient Skills, disabled Skills, effective `runtimeBudgetProfile`, and the original Canvas workflow. If Runtime returns only a partial `resumeContext`, the Node generation service fills missing fields from the server guard policy.

When a run resumed from Skill clarification hits `GraphRecursionError` or `Recursion limit of 100 reached`, inspect the continuation chain before raising global limits. Confirm `resumeContext.runtimeBudgetProfile` is `low`, `medium`, or `high`; `resumeContext.canvas.workflow.mode` remains `batch_delivery`; the answered request rebuilds `contextValues.progressiveCanvasDelivery`; and the AgentBackend request includes a top-level `config.recursion_limit` matching the resolved budget instead of falling back to 100. Runtime middleware reads `facetwrite_recursion_limit`, but LangGraph enforces top-level `recursion_limit`, so the Gateway mirrors the context value when the top-level value is still the default.

The composer may show a budget-continuation prompt after a recursion-limit failure. It only drafts a user-visible continue instruction so the user can edit and resubmit; it does not convert the failed run into success, and the next request must still preserve the previous clarification answer, Skills, Canvas workflow, and budget semantics.

# Plan Runtime Enforcement

FacetWrite passes a stable Plan phase attempt in both LangGraph configurable context and runtime context. The Gateway forwards only the documented FacetWrite context fields, including top-level Plan identifiers, tool refs, tool state, and structured context values. `PlanToolChoiceMiddleware` filters model-visible tools on every call and permits at most one forced stage submission per attempt: intake exposes only `plan_clarification_submit`, revision exposes only `plan_revision_submit`, and approved execution uses the request policy for research tools plus `artifact_stage`.

The TypeScript `PlanOrchestrator` owns lifecycle state and the persistent `PlanExecutor` owns sequential execution. Repository state is the authoritative phase postcondition: intake must persist a pending clarification in `awaiting_user`, revision must persist an approval-ready Plan with steps, and execution must persist a committed current-step Artifact or a waiting/failed/paused interruption. SSE lifecycle events remain realtime UI and audit signals; a missing event does not invalidate a correct database transition, and an event cannot substitute for a missing transition. Tool failures are emitted as `agent_backend_tool_failed`; Plan contract failures also emit `agent_backend_plan_submission_failed` with a safe reason. The legacy broad `plan_update` model path is not part of the maintained Plan protocol.

A structured `plan_submission_failed` ToolMessage terminates the current AgentBackend run before another model or tool call. The Gateway records the run as an error rather than success; the user starts a new phase attempt by revising or retrying the request.

Canvas feedback is part of the maintained Plan contract. Intake remains conversation-only until the user answers the structured clarification. Revision creates or refreshes one `kind:"plan"` Canvas projection node, and later lifecycle transitions keep that same node synchronized with checklist progress, current step, committed artifact count, and failure or pause messages. The projection is derived state: deleting it must not delete or cancel the Plan, and the next refresh may recreate it.

Approved execution writes Canvas content only through `artifact_stage`. Runtime prompts should ask for `payload.sections` or `payload.items` when a text artifact contains multiple user-visible points; each section maps to one Canvas node, with pagination only for an overlong section. The artifact committer links each artifact node from the Plan projection node and commits explicit artifact links once both endpoints exist. Ordinary chat `CanvasWriteSuggestion` prompts remain for non-Plan replies only; approved Plan execution must not ask the user again before creating artifact nodes.

Clarification feedback is anchored in the composer. Intake may emit a short assistant acknowledgement, but the pending options must come from the persisted Plan clarification in thread state. After every Plan intake/revision generation and every explicit thread refresh, the frontend applies returned `plans` and `planActivities`; an `awaiting_user` Plan with a pending clarification replaces the normal textarea with a selection form. Option clicks submit through the Plan answer endpoint and the revise request includes `contextValues.awaitingPlan` with the selected option label, description, and recommendation flag. Custom answers use `customAnswer` and resume revision without a fabricated option id.

Running generations are user-stoppable from the chat composer. The frontend aborts the streaming fetch, marks the active assistant message as `stopped`, and lets AgentBackend receive the disconnect with `on_disconnect:"cancel"`. A stopped stream is not treated as a successful Plan phase and does not mutate Plan lifecycle state by itself; use the persisted Plan status and activities to decide whether the user should retry, answer a pending clarification, approve a Plan, or resume execution.

After changing AgentBackend middleware, including evidence-tool budget filtering or synthesis-reserve logic, run `agent-runtime:up`; source fingerprint comparison restarts a stale healthy Gateway because Python modules are not hot-reloaded.
