# OpenCanvas Electron Development Shell Plan

## Goal

Provide a Windows source-development application shell that starts OpenCanvas in an independent Electron window while preserving Vite HMR.

## Delivered Scope

- Electron single-instance main process and local Splash page.
- Shell-owned Vite on `17776` and Express API on `17777`. The original `3100` target was replaced after Windows dynamically reserved `3007-3106`.
- Docker Desktop readiness check and Agent Runtime Compose startup.
- Runtime ownership detection: reuse a complete compatible runtime, or own and stop a runtime started by this shell.
- Ordered health checks for Docker, Agent Runtime, API, and frontend.
- Idempotent shutdown that attempts all owned cleanup steps.
- Hidden double-click launcher: `start-opencanvas-shell.vbs`.
- Unit, static contract, and real lifecycle smoke validation.

## Acceptance

- Double-click launcher returns immediately and opens an independent window.
- Splash reports startup stages and errors.
- Frontend source edits use Vite HMR.
- Closing the shell stops Vite/API and any shell-owned Agent Runtime.
- A reused Agent Runtime is not stopped.
- A second launch activates the existing shell.
- Docker, partial runtime, incompatible callback, and port errors stop startup without taking ownership of external services.

## Deferred

- Windows installer, packaged executable, signing, and automatic updates.
- Native/local Agent Runtime replacement for machines without Docker.
- Crash-proof cleanup after forced termination or operating-system failure.
