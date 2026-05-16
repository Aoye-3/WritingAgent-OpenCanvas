# FacetWrite

Local-first AI writing workspace with Agent cards, configurable tools, Canvas writing, project history, and provider settings.

## Run

### Recommended: FacetWrite + DeerFlowRuntime

Use this path for local development and acceptance. FacetWrite runs the frontend/backend, while DeerFlow runs as the primary Agent runtime through Docker Compose. Provider and mock fallback should only be treated as a safety net.

Prerequisites:

- Docker Desktop running
- Node.js 22+
- npm dependencies installed by the launcher if `node_modules/` is missing
- `.env.local` configured with `DEERFLOW_ENABLED=true` and `DEERFLOW_BASE_URL=http://127.0.0.1:2026`
- `Deerflow/.env` configured with provider values and `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787`

Start everything:

```powershell
.\start-facetwrite.ps1
```

Or through npm:

```bash
npm run dev:full
```

The launcher starts DeerFlow Docker services when `DEERFLOW_ENABLED=true`, waits for `http://127.0.0.1:2026/health`, then starts FacetWrite.

Useful URLs:

- FacetWrite UI: `http://127.0.0.1:5173`
- FacetWrite API health: `http://127.0.0.1:8787/api/health`
- DeerFlow status through FacetWrite: `http://127.0.0.1:8787/api/deerflow/status`
- DeerFlow sidecar health: `http://127.0.0.1:2026/health`

Useful commands:

```bash
npm run deerflow:up
npm run deerflow:status
npm run deerflow:down
```

Acceptance checks:

- `/api/deerflow/status` returns `reachable:true`, `authState:"authenticated"`, and `runtimeProvider:"deerflow"`.
- A Summary or Blog generation returns `provider:"deerflow"`.
- No `deerflow_runtime_failed` event appears during the primary runtime check.
- `canvas_write` creates a pending write request only; Canvas content changes only after user approval.

See [DeerFlow Runtime Runbook](docs/DEERFLOW_RUNTIME_RUNBOOK.md) for the full Docker Desktop and Linux Docker Compose checklist.

### FacetWrite Only

```bash
npm install
npm run dev
```

This starts only the Vite frontend and FacetWrite API. If `DEERFLOW_ENABLED=true` but the sidecar is not running, generation will fall back to the provider runtime.

Client: `http://127.0.0.1:5173`

## Technical Docs

- [Project Brief](docs/PROJECT_BRIEF.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Database](docs/DATABASE.md)
- [Agent And Tools](docs/AGENT.md)
- [Decisions](docs/DECISIONS.md)
- [Refactor Log](docs/REFACTOR_LOG.md)
- [Security](docs/SECURITY.md)
- [Reference Archive](docs/reference/README.md)
