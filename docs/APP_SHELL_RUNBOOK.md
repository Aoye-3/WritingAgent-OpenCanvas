# OpenCanvas Development App Shell Runbook

## Scope

The Electron shell is a Windows source-development launcher, not an installer. Default `local` mode requires Node.js and `uv`; Docker Desktop is required only for explicit `docker` mode.

## Start

Recommended one-click local entry:

```text
start-opencanvas-shell.vbs
```

This entry explicitly sets `AGENT_RUNTIME_MODE=local` for its child process and lets the shell choose an available Runtime port. It never selects or starts Docker, even if the parent machine environment contains stale Docker mode variables.

```powershell
npm.cmd install
npm.cmd run shell:dev
```

The shell uses Vite `17776` and API `17777`.

## Cloudflare Tunnel Remote Test

Use the Tunnel launcher when a remote tester needs to open the local App Shell through a temporary Cloudflare URL:

```powershell
npm.cmd run cloudflare:app-shell
```

For a manual double-click entry, use `OnlineTest.bat` in the repository root. Both entries start `shell:dev` unless `-NoShell` is passed, wait for `http://127.0.0.1:17776` and `http://127.0.0.1:17777/api/health`, then run `cloudflared tunnel --url http://127.0.0.1:17776`. The remote URL points at the Vite frontend; `/api/*` reaches the shell-managed API through the existing Vite proxy.

This path is for remote smoke testing only:

- The public URL is a temporary `trycloudflare.com` address, not a named production tunnel.
- The machine must stay online with App Shell and `cloudflared` running.
- Agent Runtime and all data stores remain local.
- The script exposes the local frontend path, not the Python Agent Runtime port.
- Stop the Tunnel with the `Stop-Process` command printed by the script; close the App Shell window to stop shell-owned local services.

## Startup Sequence

1. Acquire the single-instance lock and show Splash.
2. Validate frontend/API ports.
3. Resolve `AGENT_RUNTIME_MODE` and choose or read the local Runtime URL.
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

The acceptance starts through the same VBS used by double-click, reads the actual Runtime port from ownership metadata, asserts that Docker and port `2026` remain absent, performs five real Agent Runtime generations, verifies Skill/Web Search, Memory, and pending-only Canvas writes, and confirms owned processes are reclaimed. Generated test Projects are deleted automatically; the report is written to `test-results/local-runtime-acceptance-report.json`.

## Ownership And Shutdown

- Vite and Express are shell-owned.
- Local/Docker Runtime is owned only when this shell started it.
- Compatible pre-existing services are reused and never stopped by the shell.
- Occupied ports, partial services, or incompatible project/bridge metadata block startup.
- Startup failure rolls back every process created by that launch attempt.

## Source Git Updates

The development shell can preview and apply first-stage Harness source updates from the current checkout only. The update channel is fixed to allowlisted `origin/main`; the shell does not clone, create worktrees, mirror repositories, or accept arbitrary GitHub URLs.

- Preview runs from Shell IPC and may fetch `origin`, then reports branch, current SHA, target SHA, ahead/behind counts, changed files, dependency changes, and blockers.
- The renderer exposes this flow through the left navigation `App updates` page.
- Apply is Shell-owned. Express never runs Git commands to replace its own source while serving requests, and the renderer only calls the shell bridge.
- Apply requires a non-detached branch with upstream tracking, an allowlisted `origin`, no tracked local modifications, no untracked application files that could be overwritten, and a fast-forward target.
- The shell uses `git merge --ff-only <resolved origin/main SHA>`. It never stashes, rebases, resets, creates merge commits, or resolves conflicts automatically.
- If root dependency files changed, the shell runs `npm.cmd install` after the fast-forward merge and before restart.
- Services are stopped only after merge and dependency installation succeed. The final step is a hard relaunch through Electron.
- Protected local data paths such as `.facetwrite/**`, `.env*`, provider stores, SQLite files, Knowledge, Memory, uploads/outputs, runtime temp roots, and dependency/cache folders are never update targets. A target commit that touches them is blocked in preview/apply.

Browser-only sessions do not expose the source update bridge and should show the update feature as unavailable.

## Troubleshooting

- Local prerequisites: `npm.cmd run agent-runtime:doctor`.
- Runtime logs: `modules/agent-runtime/logs/gateway-local.err.log`.
- Shell/API/frontend logs: `logs/app-shell.log`, `logs/api.err.log`, and `logs/frontend.err.log`.
- Docker mode: set `AGENT_RUNTIME_MODE=docker` and ensure Docker is already running.
- External mode: set `AGENT_RUNTIME_MODE=external` and an accessible `AGENT_BACKEND_BASE_URL`.
- Ports `17776`/`17777` occupied: resolve the conflict; the shell never terminates unrelated services.
- Cloudflare remote URL missing: confirm `.cloudflare-tools/cloudflared.exe` exists or `cloudflared` is available on `PATH`, then rerun `npm.cmd run cloudflare:app-shell`.

Local Runtime ownership metadata includes the actual port, Bridge URL, Runtime source fingerprint, and internal Tool token fingerprint. App Shell reuses a healthy local Runtime only when project, Bridge, source, and token fingerprints match; stale project-owned processes are stopped and cold-started. `agent-runtime:status` reads the actual port and Bridge from ownership metadata, including App Shell's `17777` Bridge.
- The workspace Runtime badge polls `/api/agent-runtime/status`; it does not infer current health from historical Mock outputs.
- Set `AGENT_RUNTIME_PORT=<port>` to pin local Runtime to a known port for debugging. Leave it unset or set `0` for the default private-port development shell behavior.
