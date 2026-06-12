<p align="center">
  <img src="public/assets/ui/brand/opencanvas-icon.png" alt="OpenCanvas icon" width="96" height="96" />
</p>

# OpenCanvas

**Language:** English | [中文](README.zh-CN.md)

OpenCanvas is a local-first AI canvas workspace built on the FacetWrite architecture. It combines a FigJam-like board, editable writing nodes, Agent cards, configurable tools, project history, provider settings, Knowledge, Memory, and an internal Agent Runtime sidecar for richer AI orchestration.

OpenCanvas benchmarks the familiar board experience first: an infinite canvas, nodes, edges, a floating toolbar, contextual object actions, and local board-file behavior. The product innovation is the Agent layer on top: tool orchestration plus human-AI collaboration context management, where the Agent understands selection, explicit mind chains, workflow stages, Role nodes, and approval state before acting.

## Product Shape

- **Local-first canvas:** Vite/React frontend, Express API, SQLite/local file persistence, and local workspace files under `.facetwrite/`.
- **Canvas V2:** React Flow-based board with an active floating toolbar, select/pan modes, multi-selection, document/note/reference/role nodes, semantic directed edges, free arrows, basic shapes, lightweight tables, local asset cards, workflow stages, Role suggestions, and session undo.
- **Agent Runtime:** AgentBackend sidecar for Lead Agent/subagent orchestration, ToolUse bridge, runtime dashboard, Knowledge, Memory controls, and provider fallback.
- **Human-in-the-loop writes:** Agent-originated Canvas changes create pending write requests first. Canvas content changes only after user confirmation or the same-run explicit approval path.
- **Board direction:** OpenCanvas should evolve toward a PS/Figma-like board file that stores nodes, edges, assets, workflow state, Agent conversations, tool events, and write approvals.

## Naming

`OpenCanvas` is the external product name and should appear as the primary UI wordmark. `FacetWrite` is the technical lineage/internal engineering name used by code paths, API boundaries, local data folders, Docker project names, and technical documentation where renaming would create unnecessary migration risk.

## Run

### Windows Development App Shell

For an independent Electron development window with Vite HMR, install dependencies and double-click `start-opencanvas-shell.vbs`, or run:

```powershell
npm.cmd run shell:dev
```

The shell shows startup progress, uses Vite `17776` and API `17777`, starts the selected Agent Runtime mode, and stops Vite/API plus only the Runtime process it created. Docker Desktop is not required for the default local mode. This remains a source-development shell, not an installer. See [App Shell Runbook](docs/APP_SHELL_RUNBOOK.md).

### Recommended: OpenCanvas + Agent Runtime

Use this path for local development. OpenCanvas runs the frontend/backend, while the project-managed Python Gateway runs the Agent Runtime directly. Docker Compose remains an explicit isolation and deployment mode. The Agent Runtime Next.js frontend and nginx are not part of the default application path.

Prerequisites:

- Node.js 22+
- `uv` available; it installs project-local Python 3.12 automatically
- npm dependencies installed by the launcher if `node_modules/` is missing
- `.env.local` configured with `AGENT_RUNTIME_MODE=local`, `AGENT_BACKEND_ENABLED=true`, and `AGENT_BACKEND_BASE_URL=http://127.0.0.1:8001`
- Provider values in `.env.local` or `modules/agent-runtime/.env`

Start everything:

```powershell
.\start-facetwrite.ps1
```

Or through npm:

```bash
npm run dev
```

The launcher starts or reuses a compatible project-owned Gateway at `http://127.0.0.1:8001`, then starts OpenCanvas. It only stops the Runtime process it created. Set `AGENT_RUNTIME_MODE=docker` for Compose or `external` to connect to a user-managed `AGENT_BACKEND_BASE_URL` without lifecycle management.

Useful URLs:

- OpenCanvas UI: `http://127.0.0.1:5173` by default. If that port is unavailable locally, run Vite on `http://127.0.0.1:3000`.
- FacetWrite API health: `http://127.0.0.1:8837/api/health`
- Agent Runtime status through FacetWrite: `http://127.0.0.1:8837/api/agent-runtime/status`
- Agent Runtime Gateway health: `http://127.0.0.1:8001/health`

Useful commands:

```bash
npm run agent-runtime:up
npm run agent-runtime:status
npm run agent-runtime:down
npm run agent-runtime:doctor
```

Explicit Docker mode uses `AGENT_RUNTIME_MODE=docker`, `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`, and these lifecycle commands:

```bash
npm run agent-runtime:docker:up
npm run agent-runtime:docker:status
npm run agent-runtime:docker:down
```

### Low-Level Service Debugging

```bash
npm install
npm run dev:services
```

This starts only the Vite frontend and FacetWrite API and is reserved for narrow frontend/backend debugging. Normal local startup should use `npm run dev` or `.\start-facetwrite.ps1` so Agent Runtime is started and checked first.

## Acceptance Checks

- `/api/agent-runtime/status` returns `reachable:true`, `authState:"authenticated"`, `runtimeProvider:"agent-backend"`, `deploymentMode`, and `sandboxProvider`.
- A Summary or Blog generation returns `provider:"agent-backend"`.
- No `agent_backend_runtime_failed` event appears during the primary runtime check.
- `canvas_write` creates a pending write proposal/request only; Canvas content changes only after explicit user confirmation through the approval path.

## Technical Docs

- [Project Brief](docs/PROJECT_BRIEF.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Canvas](docs/CANVAS.md)
- [UI Assets](docs/UI_ASSETS.md)
- [API](docs/API.md)
- [Database](docs/DATABASE.md)
- [Agent And Tools](docs/AGENT.md)
- [Decisions](docs/DECISIONS.md)
- [Refactor Log](docs/REFACTOR_LOG.md)
- [Maintainability And Concurrency Review Plan](docs/superpowers/plans/2026-06-07-maintainability-concurrency-review.md)
- [Security](docs/SECURITY.md)
- [Development App Shell Runbook](docs/APP_SHELL_RUNBOOK.md)
- [Reference Archive](docs/reference/README.md)

## Roadmap

1. **Board file model:** Treat each project/thread as an OpenCanvas board file that groups nodes, edges, workflow state, assets, Agent conversations, tool events, write approvals, and version metadata.
2. **FigJam-style board tools:** The floating toolbar now covers select, pan, note/text, document, a searchable categorized shape library, tables, free arrows, Role nodes, local assets, and selection-aware Agent actions. Future work can add styling, layers, grouping, rotation, and richer connectors.
3. **Agent-callable board tools:** Extend the current `canvas_write` idea into board-aware tool intents such as creating nodes, appending content, connecting nodes, proposing layout cleanup, creating Role suggestions, and summarizing selected chains.
4. **Local assets and export:** Extend the current local asset records with snapshots/version history and portable `.opencanvas` import/export after the data model is stable.
5. **Online collaboration:** Add accounts/workspaces, sync, presence, comments, permissions, and share links only after the local board model and Agent tool boundary are stable.

## Product Principles

- Local-first before cloud sync.
- Reuse existing Canvas APIs, storage, Agent Runtime adapter, and Tool policy before creating new boundaries.
- Agent actions must be inspectable, reversible where practical, and approval-gated when destructive.
- The board UI should prioritize real creation workflows: fast toolbar access, reliable selection, clean quick actions, and no hidden context surprises.
