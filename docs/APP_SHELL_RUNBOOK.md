# OpenCanvas Development App Shell Runbook

## Scope

The Electron shell is a Windows source-development launcher, not an installer. Default `local` mode requires Node.js and `uv`; Docker Desktop is required only for explicit `docker` mode.

## Start

Recommended one-click local entry:

```text
start-opencanvas-shell.vbs
```

This entry explicitly sets `AGENT_RUNTIME_MODE=local` and `AGENT_BACKEND_BASE_URL=http://127.0.0.1:8001` for its child process. It never selects or starts Docker, even if the parent machine environment contains stale Docker mode variables.

```powershell
npm.cmd install
npm.cmd run shell:dev
```

The shell uses Vite `17776` and API `17777`.

## Startup Sequence

1. Acquire the single-instance lock and show Splash.
2. Validate frontend/API ports.
3. Resolve `AGENT_RUNTIME_MODE` and `AGENT_BACKEND_BASE_URL`.
4. Run `runtime-check`; reuse only a compatible healthy Runtime.
5. Run `runtime-bootstrap` for managed local or Docker mode.
6. Wait for `runtime-ready`, then start Express and Vite.
7. Open the main window.

`external` mode performs readiness checks but never starts or stops the Runtime. Docker mode checks the daemon but does not launch Docker Desktop automatically.

## Logs

- App Shell stages and startup errors: `logs/app-shell.log`.
- Express stdout/stderr: `logs/api.out.log` and `logs/api.err.log`.
- Vite stdout/stderr: `logs/frontend.out.log` and `logs/frontend.err.log`.
- Local Gateway stdout/stderr: `modules/agent-runtime/logs/gateway-local.out.log` and `gateway-local.err.log`.

The App Shell records `runtime-check`, `runtime-bootstrap`, `runtime-ready`, `api`, `frontend`, `ready`, and `stopping` stages. Child stderr is retained instead of being discarded.

## Real Acceptance

With Docker stopped and the shell closed:

```powershell
npm.cmd run acceptance:local-runtime
```

The acceptance starts through the same VBS used by double-click, asserts that Docker and port `2026` remain absent, performs five real Agent Runtime generations, verifies Skill/Web Search, Memory, and pending-only Canvas writes, and confirms owned processes are reclaimed. Generated test Projects are deleted automatically; the report is written to `test-results/local-runtime-acceptance-report.json`.

## Ownership And Shutdown

- Vite and Express are shell-owned.
- Local/Docker Runtime is owned only when this shell started it.
- Compatible pre-existing services are reused and never stopped by the shell.
- Occupied ports, partial services, or incompatible project/bridge metadata block startup.
- Startup failure rolls back every process created by that launch attempt.

## Troubleshooting

- Local prerequisites: `npm.cmd run agent-runtime:doctor`.
- Runtime logs: `modules/agent-runtime/logs/gateway-local.err.log`.
- Shell/API/frontend logs: `logs/app-shell.log`, `logs/api.err.log`, and `logs/frontend.err.log`.
- Docker mode: set `AGENT_RUNTIME_MODE=docker` and ensure Docker is already running.
- External mode: set `AGENT_RUNTIME_MODE=external` and an accessible `AGENT_BACKEND_BASE_URL`.
- Ports `17776`/`17777` occupied: resolve the conflict; the shell never terminates unrelated services.

Local Runtime ownership metadata includes the actual port, Bridge URL, Runtime source fingerprint, and internal Tool token fingerprint. App Shell reuses a healthy local Runtime only when project, Bridge, source, and token fingerprints match; stale project-owned processes are stopped and cold-started. `agent-runtime:status` reads the actual port and Bridge from ownership metadata, including App Shell's `17777` Bridge.
- The workspace Runtime badge polls `/api/agent-runtime/status`; it does not infer current health from historical Mock outputs.
