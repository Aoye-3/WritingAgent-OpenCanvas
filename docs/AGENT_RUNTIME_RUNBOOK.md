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

Local mode uses `deerflow.sandbox.local:LocalSandboxProvider` with `allow_host_bash: false`. It preserves Gateway auth/cookies/CSRF, `/api/runs/stream`, Skills and hot reload, stdio/HTTP/SSE MCP, Memory/SQLite/uploads/events, web search, providers, ACP, subagents, and the FacetWrite bridge tools `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write`.

`canvas_write` directly commits low-risk create and append operations with stable IDs. Replace, range replacement, delete, and other destructive operations remain approval-gated.

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
- Generation failures: inspect stable `model_required`, `model_not_ready`, `runtime_unavailable`, or `runtime_auth_failed` diagnostics. Do not enable Mock fallback for acceptance testing.
- Deliberate local Mock demonstration only: set `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; unset it before real Runtime verification.
# Plan Runtime Enforcement

FacetWrite passes a stable Plan phase attempt in both LangGraph configurable context and runtime context. The Gateway forwards only the documented FacetWrite context fields, including top-level Plan identifiers, tool refs, tool state, and structured context values. `PlanToolChoiceMiddleware` filters model-visible tools on every call and permits at most one forced stage submission per attempt: intake exposes only `plan_clarification_submit`, revision exposes only `plan_revision_submit`, and approved execution uses the request policy for research tools plus `artifact_stage`.

The TypeScript `PlanOrchestrator` owns lifecycle state and the persistent `PlanExecutor` owns sequential execution. Repository state is the authoritative phase postcondition: intake must persist a pending clarification in `awaiting_user`, revision must persist an approval-ready Plan with steps, and execution must persist a committed current-step Artifact or a waiting/failed/paused interruption. SSE lifecycle events remain realtime UI and audit signals; a missing event does not invalidate a correct database transition, and an event cannot substitute for a missing transition. Tool failures are emitted as `agent_backend_tool_failed`; Plan contract failures also emit `agent_backend_plan_submission_failed` with a safe reason. The legacy broad `plan_update` model path is not part of the maintained Plan protocol.

A structured `plan_submission_failed` ToolMessage terminates the current AgentBackend run before another model or tool call. The Gateway records the run as an error rather than success; the user starts a new phase attempt by revising or retrying the request.

Canvas feedback is part of the maintained Plan contract. Intake remains conversation-only until the user answers the structured clarification. Revision creates or refreshes one `kind:"plan"` Canvas projection node, and later lifecycle transitions keep that same node synchronized with checklist progress, current step, committed artifact count, and failure or pause messages. The projection is derived state: deleting it must not delete or cancel the Plan, and the next refresh may recreate it.

Approved execution writes Canvas content only through `artifact_stage`. Runtime prompts should ask for `payload.sections` or `payload.items` when a text artifact contains multiple user-visible points; each section maps to one Canvas node, with pagination only for an overlong section. The artifact committer links each artifact node from the Plan projection node and commits explicit artifact links once both endpoints exist. Ordinary chat `CanvasWriteSuggestion` prompts remain for non-Plan replies only; approved Plan execution must not ask the user again before creating artifact nodes.

Clarification feedback is anchored in the composer. Intake may emit a short assistant acknowledgement, but the pending options must come from the persisted Plan clarification in thread state. After every Plan intake/revision generation and every explicit thread refresh, the frontend applies returned `plans` and `planActivities`; an `awaiting_user` Plan with a pending clarification replaces the normal textarea with a selection form. Option clicks submit through the Plan answer endpoint and the revise request includes `contextValues.awaitingPlan` with the selected option label, description, and recommendation flag. Custom answers use `customAnswer` and resume revision without a fabricated option id.

Running generations are user-stoppable from the chat composer. The frontend aborts the streaming fetch, marks the active assistant message as `stopped`, and lets AgentBackend receive the disconnect with `on_disconnect:"cancel"`. A stopped stream is not treated as a successful Plan phase and does not mutate Plan lifecycle state by itself; use the persisted Plan status and activities to decide whether the user should retry, answer a pending clarification, approve a Plan, or resume execution.

After changing AgentBackend middleware, run `agent-runtime:up`; source fingerprint comparison restarts a stale healthy Gateway because Python modules are not hot-reloaded.
