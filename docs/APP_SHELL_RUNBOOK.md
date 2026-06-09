# OpenCanvas Development App Shell Runbook

## Scope

The current Electron shell is a Windows source-development launcher. It is not an installed or packaged application. Docker Desktop remains required for Agent Runtime.

## Start

Install dependencies once:

```powershell
npm.cmd install
```

Then double-click `start-opencanvas-shell.vbs`, or run:

```powershell
npm.cmd run shell:dev
```

The shortcut starts Electron hidden from a transient terminal. Electron, not that terminal, owns the services.

## Startup Sequence

1. Acquire the Electron single-instance lock and show Splash.
2. Confirm ports `17776` and `17777` are free.
3. Confirm Docker Desktop is ready, starting it when installed but stopped.
4. Reuse a complete compatible Agent Runtime, or start and own it.
5. Wait for Agent Runtime `http://127.0.0.1:2026/health`.
6. Start Express and wait for `http://127.0.0.1:17777/api/health`.
7. Start Vite and wait for `http://127.0.0.1:17776`.
8. Open the main window and close Splash.

Vite remains a development server, so React/CSS source edits use HMR. Electron main-process edits require restarting the shell.

## Ownership And Shutdown

- Vite and Express are always owned by the shell.
- Electron starts the Vite and TSX Node CLIs directly so their process trees remain owned during shutdown and restart.
- Agent Runtime is owned only when no required Compose services were running and this shell started them.
- A complete pre-existing runtime is reused only when its callback is `http://host.docker.internal:17777`.
- A partial or incompatible runtime blocks startup and is never stopped automatically.
- Closing the main window or cancelling Splash attempts to stop every owned service before Electron exits.
- Forced process termination or system failure cannot guarantee asynchronous cleanup.

## Troubleshooting

- Docker not found: install Docker Desktop. A no-Docker local Runtime is deferred.
- Port `17776` or `17777` occupied/reserved: resolve the conflict; the shell will not stop external services.
- Partial Agent Runtime: repair it or run `npm.cmd run agent-runtime:down`, then retry.
- Incompatible reused Runtime callback: stop it and let the shell restart it.
- The existing browser workflow remains available through `npm.cmd run dev`.
