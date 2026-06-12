# OpenCanvas Development App Shell Runbook

## Scope

The Electron shell is a Windows source-development launcher, not an installer. Default `local` mode requires Node.js and `uv`; Docker Desktop is required only for explicit `docker` mode.

## Start

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

## Ownership And Shutdown

- Vite and Express are shell-owned.
- Local/Docker Runtime is owned only when this shell started it.
- Compatible pre-existing services are reused and never stopped by the shell.
- Occupied ports, partial services, or incompatible project/bridge metadata block startup.
- Startup failure rolls back every process created by that launch attempt.

## Troubleshooting

- Local prerequisites: `npm.cmd run agent-runtime:doctor`.
- Runtime logs: `modules/agent-runtime/logs/gateway-local.err.log`.
- Docker mode: set `AGENT_RUNTIME_MODE=docker` and ensure Docker is already running.
- External mode: set `AGENT_RUNTIME_MODE=external` and an accessible `AGENT_BACKEND_BASE_URL`.
- Ports `17776`/`17777` occupied: resolve the conflict; the shell never terminates unrelated services.
- The workspace Runtime badge polls `/api/agent-runtime/status`; it does not infer current health from historical Mock outputs.
