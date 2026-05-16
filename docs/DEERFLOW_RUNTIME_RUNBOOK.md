# DeerFlow Runtime Runbook

FacetWrite treats DeerFlow as the primary Agent runtime when `DEERFLOW_ENABLED=true`. The Provider runtime and Mock output are fallback paths only; final acceptance for DeerFlow work requires a stable DeerFlow run with ToolUse visible and policy controlled.

## Supported Paths

- Local acceptance: Docker Desktop plus DeerFlow Docker Compose.
- Production: Linux or cloud host running Docker Compose.
- Windows native local mode is not the main path. If `make` or `nginx` is missing on Windows, use Docker Desktop or WSL/Linux rather than trying to install native nginx as the primary workflow.

## Required Dependencies

- Docker Desktop daemon available locally, or Docker Engine on Linux.
- Docker Compose.
- Node.js 22+ for FacetWrite.
- Corepack `pnpm` for DeerFlow frontend dependencies.
- `uv` for DeerFlow backend dependencies and tests.

## Ports And URLs

- FacetWrite app/API: `http://127.0.0.1:8787` for backend service-to-service callbacks.
- FacetWrite Vite UI: `http://127.0.0.1:5173`.
- DeerFlow nginx sidecar: `http://127.0.0.1:2026`.
- DeerFlow gateway container service: exposed through nginx for FacetWrite runtime use.

## Environment

FacetWrite local `.env.local`:

```bash
DEERFLOW_ENABLED=true
DEERFLOW_BASE_URL=http://127.0.0.1:2026
DEERFLOW_ASSISTANT_ID=lead_agent
DEERFLOW_AUTH_EMAIL=admin@example.com
DEERFLOW_AUTH_PASSWORD=<local DeerFlow password>
DEERFLOW_AUTO_SETUP=false
DEERFLOW_AUTH_TIMEOUT_MS=5000
```

DeerFlow Docker environment for FacetWrite ToolUse bridge:

```bash
FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787
FACETWRITE_INTERNAL_TOOL_TOKEN=<optional shared token>
```

When `FACETWRITE_INTERNAL_TOOL_TOKEN` is set, DeerFlow sends it as `x-facetwrite-tool-token`; FacetWrite still also requires an internal source marker and applies normal ToolUse policy.

## Start Local Acceptance Runtime

1. Start Docker Desktop and confirm the daemon:

```bash
docker info
docker compose version
```

2. Start FacetWrite with `DEERFLOW_ENABLED=true` and backend reachable on `127.0.0.1:8787`.

3. Start DeerFlow Compose from `Deerflow/docker` with project name `deer-flow-dev`.

4. Confirm the required DeerFlow containers are healthy/running:

- `deer-flow-nginx`
- `deer-flow-frontend`
- `deer-flow-gateway`

## Smoke Checks

DeerFlow sidecar:

```bash
curl http://127.0.0.1:2026/health
```

FacetWrite status:

```bash
curl http://127.0.0.1:8787/api/deerflow/status
curl http://127.0.0.1:8787/api/deerflow/dashboard
```

Expected status includes:

- `reachable:true`
- `authState:"authenticated"`
- `runtimeProvider:"deerflow"`

Runtime acceptance:

- Run one Summary or Blog generation through FacetWrite.
- Response provider must be `deerflow`.
- Tool events must not include `deerflow_runtime_failed`.
- Run five short generations in a row and confirm none fall back to Provider or Mock.

Fallback verification:

- Stop DeerFlow.
- Run one generation.
- Confirm `deerflow_runtime_failed` is emitted and Provider fallback still works.
- This proves fallback exists, but it is not the passing condition for DeerFlow runtime acceptance.

## ToolUse Acceptance

DeerFlow built-in tools:

- Trigger `web_search` or file read style behavior.
- Confirm DeerFlow stream/tool timeline includes `deerflow_*` events.
- Treat `web_search` as DeerFlow built-in, not as a FacetWrite local bridge tool.

FacetWrite bridge tools:

- `knowledge_base` calls back into `/api/internal/deerflow/tool-call` and reads explicit runtime context.
- `quick_messages` calls back into FacetWrite and normalizes the current instruction.
- `clear_context` calls back into FacetWrite and confirms prior context should be ignored.
- `canvas_write` calls back into FacetWrite and creates a pending Canvas write proposal/request only.

Canvas acceptance:

- Before user confirmation and backend approval, Canvas content must remain unchanged.
- The pending request must appear in thread state.
- Only the FacetWrite approve endpoint may apply the pending write; the frontend may call it automatically after explicit user confirmation.

## Common Failures

- Docker daemon unavailable: start Docker Desktop or Docker Engine and rerun `docker info`.
- Windows native `make` or `nginx` missing: use Docker Desktop or WSL/Linux; do not make Windows native mode the acceptance path.
- DeerFlow `/api/skills`, `/api/mcp/config`, or `/api/runs/stream` returns 401/403: check `DEERFLOW_AUTH_EMAIL`, `DEERFLOW_AUTH_PASSWORD`, `DEERFLOW_AUTO_SETUP`, and setup/login status.
- FacetWrite status is reachable but auth is not authenticated: wait for setup-status rate limits to cool down, then retry backend auth.
- Bridge calls fail from Docker: confirm `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787`, FacetWrite backend is listening, and any configured token matches.
- DeepSeek tool calls fail with `reasoning_content` errors: use DeerFlow `deerflow.models.patched_deepseek:PatchedChatDeepSeek` for the current DeepSeek-compatible model so reasoning metadata is preserved across tool-call turns.
- `canvas_write` appears applied before user confirmation/approval: this is a blocker; DeerFlow bridge must only create a pending request.
