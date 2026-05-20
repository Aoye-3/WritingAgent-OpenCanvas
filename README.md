# FacetWrite

Local-first AI writing workspace with Agent cards, configurable tools, Canvas writing, project history, and provider settings.

## Run

### Recommended: FacetWrite + AgentBackend Runtime

Use this path for local development and acceptance. FacetWrite runs the frontend/backend, while AgentBackend runs as the primary Agent runtime through Docker Compose. Provider and mock fallback should only be treated as a safety net.

Prerequisites:

- Docker Desktop running
- Node.js 22+
- npm dependencies installed by the launcher if `node_modules/` is missing
- `.env.local` configured with `AGENT_BACKEND_ENABLED=true` and `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`
- `AgentBackend/.env` configured with provider values and `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787`

Use `AGENT_BACKEND_*` only for the active runtime. Older `DEERFLOW_*` keys are historical and will leave AgentBackend disabled until they are migrated and the API process is restarted.

Start everything:

```powershell
.\start-facetwrite.ps1
```

Or through npm:

```bash
npm run dev:full
```

The launcher starts AgentBackend Docker services when `AGENT_BACKEND_ENABLED=true`, waits for `http://127.0.0.1:2026/health`, then starts FacetWrite.

Useful URLs:

- FacetWrite UI: `http://127.0.0.1:5173` by default. If that port is unavailable locally, run Vite on `http://127.0.0.1:3000`.
- FacetWrite API health: `http://127.0.0.1:8787/api/health`
- AgentBackend status through FacetWrite: `http://127.0.0.1:8787/api/agent-backend/status`
- AgentBackend sidecar health: `http://127.0.0.1:2026/health`

Useful commands:

```bash
npm run agent-backend:up
npm run agent-backend:status
npm run agent-backend:down
```

These commands use the `agent-backend-dev` Compose project and `agent-backend-*` container names. The local acceptance compose does not mount the host Docker socket or local CLI credential directories into AgentBackend by default.

Acceptance checks:

- `/api/agent-backend/status` returns `reachable:true`, `authState:"authenticated"`, and `runtimeProvider:"agent-backend"`.
- A Summary or Blog generation returns `provider:"agent-backend"`.
- No `agent_backend_runtime_failed` event appears during the primary runtime check.
- `canvas_write` creates a pending write proposal/request only; Canvas content changes only after explicit user confirmation through the approval path.

See [AgentBackend Runtime Runbook](docs/AGENT_BACKEND_RUNTIME_RUNBOOK.md) for the full Docker Desktop and Linux Docker Compose checklist.

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
- [API](docs/API.md)
- [Database](docs/DATABASE.md)
- [Agent And Tools](docs/AGENT.md)
- [Decisions](docs/DECISIONS.md)
- [Refactor Log](docs/REFACTOR_LOG.md)
- [Security](docs/SECURITY.md)
- [Reference Archive](docs/reference/README.md)
