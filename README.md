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

The shell shows startup progress, uses Vite `17776` and API `17777`, starts Docker Desktop/Agent Runtime when needed, and stops Vite/API plus only the Agent Runtime it started when the window closes. Docker Desktop is still required; this is a source-development shell, not an installer. See [App Shell Runbook](docs/APP_SHELL_RUNBOOK.md).

### Recommended: OpenCanvas + Agent Runtime

Use this path for local development and acceptance. OpenCanvas runs the frontend/backend, while the internal Agent Runtime module runs as the primary AI execution subsystem through Docker Compose. The current internal runtime implementation is AgentBackend. Provider and mock fallback should only be treated as runtime safety nets.

Prerequisites:

- Docker Desktop running
- Node.js 22+
- npm dependencies installed by the launcher if `node_modules/` is missing
- `.env.local` configured with `AGENT_BACKEND_ENABLED=true` and `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`
- `modules/agent-runtime/.env` configured with provider values and `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8837`

Start everything:

```powershell
.\start-facetwrite.ps1
```

Or through npm:

```bash
npm run dev
```

The launcher requires `AGENT_BACKEND_ENABLED=true`, starts Agent Runtime Docker services, waits for `http://127.0.0.1:2026/health`, then starts OpenCanvas. Local startup is intentionally hard-bound to Agent Runtime; provider/mock fallback is only for runtime failure handling inside the app, not for skipping the sidecar during normal launcher flow.

Useful URLs:

- OpenCanvas UI: `http://127.0.0.1:5173` by default. If that port is unavailable locally, run Vite on `http://127.0.0.1:3000`.
- FacetWrite API health: `http://127.0.0.1:8837/api/health`
- Agent Runtime status through FacetWrite: `http://127.0.0.1:8837/api/agent-runtime/status`
- Agent Runtime sidecar health: `http://127.0.0.1:2026/health`

Useful commands:

```bash
npm run agent-runtime:up
npm run agent-runtime:status
npm run agent-runtime:down
```

If Docker Hub is unavailable, configure FacetWrite-owned runtime image overrides in `modules/agent-runtime/.env`:

```bash
NODE_IMAGE=<reachable node:22-alpine mirror or local tag>
PYTHON_IMAGE=<reachable python:3.12-slim-bookworm mirror or local tag>
DOCKER_CLI_IMAGE=<reachable docker:cli mirror or local tag>
UV_IMAGE=<reachable ghcr.io/astral-sh/uv:0.7.20 mirror or local tag>
```

### Low-Level Service Debugging

```bash
npm install
npm run dev:services
```

This starts only the Vite frontend and FacetWrite API and is reserved for narrow frontend/backend debugging. Normal local startup should use `npm run dev` or `.\start-facetwrite.ps1` so Agent Runtime is started and checked first.

## Acceptance Checks

- `/api/agent-runtime/status` returns `reachable:true`, `authState:"authenticated"`, and `runtimeProvider:"agent-backend"`.
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
