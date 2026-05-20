# AgentBackend Runtime Runbook

FacetWrite treats AgentBackend as the primary Agent runtime when `AGENT_BACKEND_ENABLED=true`. The Provider runtime and Mock output are fallback paths only; final acceptance for AgentBackend work requires a stable AgentBackend run with ToolUse visible and policy controlled.

## Supported Paths

- Local acceptance: Docker Desktop plus AgentBackend Docker Compose.
- Production: Linux or cloud host running Docker Compose.
- Windows native local mode is not the main path. If `make` or `nginx` is missing on Windows, use Docker Desktop or WSL/Linux rather than trying to install native nginx as the primary workflow.

## Required Dependencies

- Docker Desktop daemon available locally, or Docker Engine on Linux.
- Docker Compose.
- Node.js 22+ for FacetWrite.
- Corepack `pnpm` for AgentBackend frontend dependencies.
- `uv` for AgentBackend backend dependencies and tests.

## Ports And URLs

- FacetWrite app/API: `http://127.0.0.1:8787` for backend service-to-service callbacks.
- FacetWrite Vite UI: `http://127.0.0.1:5173` by default. If Windows refuses the 5173 bind during local testing, run Vite on `http://127.0.0.1:3000` and keep the backend on `8787`.
- AgentBackend nginx sidecar: `http://127.0.0.1:2026`.
- AgentBackend gateway container service: exposed through nginx for FacetWrite runtime use.

## Environment

FacetWrite local `.env.local`:

```bash
AGENT_BACKEND_ENABLED=true
AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026
AGENT_BACKEND_ASSISTANT_ID=lead_agent
AGENT_BACKEND_AUTH_EMAIL=admin@example.com
AGENT_BACKEND_AUTH_PASSWORD=<local AgentBackend password>
AGENT_BACKEND_AUTO_SETUP=false
AGENT_BACKEND_AUTH_TIMEOUT_MS=5000
```

`DEERFLOW_*` variables are historical and are not read by FacetWrite after the AgentBackend rename. If `/api/agent-backend/status` reports `enabled:false` while local config looks present, check for stale `DEERFLOW_*` keys in `.env.local` and migrate them to `AGENT_BACKEND_*`.

AgentBackend Docker environment for FacetWrite ToolUse bridge:

```bash
FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787
FACETWRITE_INTERNAL_TOOL_TOKEN=<optional shared token>
```

When `FACETWRITE_INTERNAL_TOOL_TOKEN` is set, AgentBackend sends it as `x-facetwrite-tool-token`; FacetWrite still also requires an internal source marker and applies normal ToolUse policy.

## Start Local Acceptance Runtime

1. Start Docker Desktop and confirm the daemon:

```bash
docker info
docker compose version
```

2. Start FacetWrite with `AGENT_BACKEND_ENABLED=true` and backend reachable on `127.0.0.1:8787`.

3. Start AgentBackend Compose through the npm wrapper, which injects `AGENT_BACKEND_ROOT` and uses project name `agent-backend-dev`:

```bash
npm run agent-backend:up
npm run agent-backend:status
```

4. Confirm the required AgentBackend containers are healthy/running:

- `agent-backend-nginx`
- `agent-backend-frontend`
- `agent-backend-gateway`

## Smoke Checks

AgentBackend sidecar:

```bash
curl http://127.0.0.1:2026/health
```

FacetWrite status:

```bash
curl http://127.0.0.1:8787/api/agent-backend/status
curl http://127.0.0.1:8787/api/agent-backend/dashboard
```

Expected status includes:

- `reachable:true`
- `authState:"authenticated"`
- `runtimeProvider:"agent-backend"`

Runtime acceptance:

- Run one Summary or Blog generation through FacetWrite.
- Response provider must be `agent-backend` and `usedMock:false`.
- In the right-side AI conversation drawer, a streaming run must show the assistant avatar/status immediately and then receive visible text before the final `GenerateResponse` completes.
- Tool events must not include `agent_backend_runtime_failed`.
- Run five short generations in a row and confirm none fall back to Provider or Mock.

Fallback verification:

- Stop AgentBackend.
- Run one generation.
- Confirm `agent_backend_runtime_failed` is emitted and Provider fallback still works.
- This proves fallback exists, but it is not the passing condition for AgentBackend runtime acceptance.

## ToolUse Acceptance

AgentBackend built-in tools:

- Trigger `web_search` or file read style behavior.
- Confirm AgentBackend stream/tool timeline includes `AgentBackend_*` events.
- Treat `web_search` as AgentBackend built-in, not as a FacetWrite local bridge tool.

FacetWrite bridge tools:

- `knowledge_base` calls back into `/api/internal/agent-backend/tool-call` and reads explicit runtime context.
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
- AgentBackend status says `enabled:false`: migrate stale `DEERFLOW_*` entries in `.env.local` to `AGENT_BACKEND_*`, then restart the FacetWrite API so dotenv is reloaded.
- `npm run agent-backend:up` fails with a network pool overlap: the dev compose should not pin a fixed subnet. Let Docker allocate `agent-backend-dev_agent-backend-dev`.
- `agent-backend-nginx` starts but `2026` is not reachable: check for old `deer-flow-*` containers occupying the port, stop them, and recreate the AgentBackend nginx container through `npm run agent-backend:up`.
- AgentBackend `/api/skills`, `/api/mcp/config`, or `/api/runs/stream` returns 401/403: check `AGENT_BACKEND_AUTH_EMAIL`, `AGENT_BACKEND_AUTH_PASSWORD`, `AGENT_BACKEND_AUTO_SETUP`, and setup/login status.
- FacetWrite status is reachable but auth is not authenticated: wait for setup-status rate limits to cool down, then retry backend auth.
- Bridge calls fail from Docker: confirm `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787`, FacetWrite backend is listening, and any configured token matches.
- DeepSeek tool calls fail with `reasoning_content` errors: use AgentBackend `AgentBackend.models.patched_deepseek:PatchedChatDeepSeek` for the current DeepSeek-compatible model so reasoning metadata is preserved across tool-call turns.
- `canvas_write` appears applied before user confirmation/approval: this is a blocker; AgentBackend bridge must only create a pending request.

## 2026-05-20 Local Validation Snapshot

- `npm run agent-backend:up` starts `agent-backend-nginx`, `agent-backend-gateway`, and `agent-backend-frontend`.
- `http://127.0.0.1:2026/health` returns HTTP 200.
- `http://127.0.0.1:8787/api/agent-backend/status` returns `enabled:true`, `reachable:true`, `runtimeProvider:"agent-backend"`, and `authState:"authenticated"`.
- A direct `/api/generate` smoke test returned `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"`.
- Verification passed with `npm run typecheck` and `npm run test` after the env/script/compose corrections.
