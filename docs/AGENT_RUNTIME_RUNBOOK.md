# Agent Runtime Runbook

Agent Runtime is the primary AI execution subsystem when `AGENT_BACKEND_ENABLED=true`. The same Gateway, auth, SSE, Lead Agent/subagent, Skills, MCP, Memory, ACP, provider, and FacetWrite ToolUse bridge code runs in all deployment modes.

## Modes

- `local` (default): the project manages `uvicorn app.gateway.app:app` on `127.0.0.1:8001`.
- `docker`: explicit Compose isolation/deployment mode through nginx on `127.0.0.1:2026`.
- `external`: FacetWrite connects to `AGENT_BACKEND_BASE_URL` and does not manage lifecycle.

The default local path does not start the Runtime Next.js frontend or nginx because neither carries core Agent capability.

## Requirements

- Node.js 22+, including `npm` and `npx` for JavaScript Skills, stdio MCP, and ACP adapters.
- `uv`; the launcher installs Python 3.12 into `modules/agent-runtime/backend/.uv-python` and syncs `uv.lock` into `.venv`.
- Docker Desktop/Engine only for `docker` mode.

## Configuration

```env
AGENT_RUNTIME_MODE=local
AGENT_BACKEND_ENABLED=true
AGENT_BACKEND_BASE_URL=http://127.0.0.1:8001
AGENT_BACKEND_ASSISTANT_ID=lead_agent
AGENT_BACKEND_AUTH_EMAIL=admin@example.com
AGENT_BACKEND_AUTH_PASSWORD=<local password>
```

The local launcher reads process environment first, then `modules/agent-runtime/.env`, then root `.env.local`. It sets project, home, config, extensions, Skills, and FacetWrite bridge paths explicitly. Secrets are never printed. Runtime state remains in `modules/agent-runtime/backend/.deer-flow` in both local and Docker modes.

## Lifecycle

```powershell
npm.cmd run agent-runtime:doctor
npm.cmd run agent-runtime:up
npm.cmd run agent-runtime:status
npm.cmd run agent-runtime:down
```

Logs and ownership metadata are written under `modules/agent-runtime/logs/`. A healthy compatible project-owned process is reused. An unmanaged or incompatible process on the configured port blocks startup. Shutdown only terminates the process recorded as project-owned.

Docker remains available explicitly:

```powershell
npm.cmd run agent-runtime:docker:up
npm.cmd run agent-runtime:docker:status
npm.cmd run agent-runtime:docker:down
```

## Security And Capability Boundary

Local mode uses `deerflow.sandbox.local:LocalSandboxProvider` with `allow_host_bash: false`. It preserves Gateway auth/cookies/CSRF, `/api/runs/stream`, Skills and hot reload, stdio/HTTP/SSE MCP, Memory/SQLite/uploads/events, web search, providers, ACP, subagents, and the FacetWrite bridge tools `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write`.

`canvas_write` may only create a pending request; FacetWrite approval remains the only product-data mutation path.

These remain Docker-specific and are not claimed as local equivalents: `AioSandboxProvider`, Kubernetes Provisioner, Docker socket/Docker-out-of-Docker, and Bash Skills that require Linux containers.

## Smoke Checks

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
Invoke-RestMethod http://127.0.0.1:8837/api/agent-runtime/status
```

Expected FacetWrite status includes `reachable:true`, authenticated runtime state, `runtimeProvider:"agent-backend"`, `deploymentMode:"local"`, and the LocalSandbox provider. Acceptance should also execute Python and Node Skills, a temporary stdio MCP, built-in tools, all four bridge tools, repeated no-Mock generations, and verify Canvas approval.

The maintained end-to-end local acceptance is:

```powershell
npm.cmd run acceptance:local-runtime
```

It starts from `start-opencanvas-shell.vbs`, requires Docker and port `2026` to remain absent, and verifies five UI generations with `provider:"agent-backend"` and `usedMock:false`. It then verifies a Skill-driven `read_file` followed by live `web_search`, Agent Runtime `memory.json` persistence, visible tool start/completion events, and a `canvas_write` pending request without a direct Canvas mutation.

## Troubleshooting

- `uv`/Node/npm/npx missing: run `npm.cmd run agent-runtime:doctor` and install the reported prerequisite.
- Port `8001` occupied: stop the external process or configure `external` mode with its URL.
- Gateway startup failure: inspect `modules/agent-runtime/logs/gateway-local.err.log`; the launcher rolls back its owned process.
- Missing model variables: configure `.env.local` or `modules/agent-runtime/.env` without committing secrets.
- Protected endpoints return 401/403: verify Agent Runtime setup/login credentials; do not bypass auth.
- stdio MCP cannot find `npx`: confirm Node is on PATH; the launcher prepends discovered Node/npm/npx directories.
- Docker bridge failure: use `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:<api-port>`.
- Local bridge failure: use `http://127.0.0.1:<api-port>`.
- Generation failures: inspect stable `model_required`, `model_not_ready`, `runtime_unavailable`, or `runtime_auth_failed` diagnostics. Do not enable Mock fallback for acceptance testing.
- Deliberate local Mock demonstration only: set `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; unset it before real Runtime verification.
# Plan Runtime Enforcement

FacetWrite passes `facetwrite_plan_phase` (`chat`, `planning`, or `execution`) in both LangGraph configurable context and runtime context. `PlanToolChoiceMiddleware` forces the first planning call to `plan_update`. During execution it permits research tools, but intercepts a text-only finish before `artifact_stage` and forces the artifact call.

The TypeScript runtime boundary independently requires a Plan state event during planning and an `artifact_committed` event for every successful execution unit. `plan_waiting_for_user` and `plan_failed` are valid no-artifact exits. This prevents models with weak or inconsistent tool calling from bypassing the task board or completing without writing Canvas output.

After changing AgentBackend middleware, restart the local Gateway; `agent:up` reuses a healthy process and does not hot-reload Python modules.
