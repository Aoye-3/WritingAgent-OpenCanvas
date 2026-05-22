# OpenCanvas

<sub>FacetWrite architecture</sub>

OpenCanvas is a local-first AI canvas workspace built on the FacetWrite architecture. It combines Agent cards, configurable tools, editable Canvas nodes, project history, provider settings, and an internal Agent Runtime Docker sidecar for richer AI orchestration.

## Naming

`OpenCanvas` is the external product name and should appear as the large primary wordmark in the UI. `FacetWrite` appears only as a small technical lineage mark in the brand lockup and remains the internal engineering name used by code paths, API boundaries, local data folders, Docker project names, and technical documentation where changing names would create unnecessary migration risk.

## Run

### Recommended: FacetWrite + Agent Runtime

Use this path for local development and acceptance. FacetWrite runs the frontend/backend, while the internal Agent Runtime module runs as the primary AI execution subsystem through Docker Compose. The current internal runtime implementation is AgentBackend. Provider and mock fallback should only be treated as a safety net.

Prerequisites:

- Docker Desktop running
- Node.js 22+
- npm dependencies installed by the launcher if `node_modules/` is missing
- `.env.local` configured with `AGENT_BACKEND_ENABLED=true` and `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`
- `modules/agent-runtime/.env` configured with provider values and `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787`

Use `AGENT_BACKEND_*` for the current AgentBackend adapter. Older `DEERFLOW_*` keys are historical and will leave Agent Runtime disabled until they are migrated and the API process is restarted.

Start everything:

```powershell
.\start-facetwrite.ps1
```

Or through npm:

```bash
npm run dev:full
```

The launcher starts Agent Runtime Docker services when `AGENT_BACKEND_ENABLED=true`, waits for `http://127.0.0.1:2026/health`, then starts FacetWrite.

Useful URLs:

- OpenCanvas UI: `http://127.0.0.1:5173` by default. If that port is unavailable locally, run Vite on `http://127.0.0.1:3000`.
- FacetWrite API health: `http://127.0.0.1:8787/api/health`
- Agent Runtime status through FacetWrite: `http://127.0.0.1:8787/api/agent-runtime/status`
- Agent Runtime sidecar health: `http://127.0.0.1:2026/health`

Useful commands:

```bash
npm run agent-runtime:up
npm run agent-runtime:status
npm run agent-runtime:down
```

The legacy `agent-backend:*` commands remain as aliases. The new commands use the `facetwrite-agent-runtime` Compose project and `facetwrite-agent-runtime-*` container names. The local acceptance compose does not mount the host Docker socket or local CLI credential directories into Agent Runtime by default.

If Docker Hub is unavailable, configure FacetWrite-owned runtime image overrides in `modules/agent-runtime/.env`:

```bash
NODE_IMAGE=<reachable node:22-alpine mirror or local tag>
PYTHON_IMAGE=<reachable python:3.12-slim-bookworm mirror or local tag>
DOCKER_CLI_IMAGE=<reachable docker:cli mirror or local tag>
UV_IMAGE=<reachable ghcr.io/astral-sh/uv:0.7.20 mirror or local tag>
```

Acceptance checks:

- `/api/agent-runtime/status` returns `reachable:true`, `authState:"authenticated"`, and `runtimeProvider:"agent-backend"`.
- A Summary or Blog generation returns `provider:"agent-backend"`.
- No `agent_backend_runtime_failed` event appears during the primary runtime check.
- `canvas_write` creates a pending write proposal/request only; Canvas content changes only after explicit user confirmation through the approval path.

See [Agent Runtime Runbook](docs/AGENT_RUNTIME_RUNBOOK.md) for the full Docker Desktop and Linux Docker Compose checklist.

### FacetWrite Only

```bash
npm install
npm run dev
```

This starts only the Vite frontend and FacetWrite API. If `AGENT_BACKEND_ENABLED=true` but the sidecar is not running, generation will fall back to the provider runtime.

Client: `http://127.0.0.1:5173`

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
- [Security](docs/SECURITY.md)
- [Reference Archive](docs/reference/README.md)
