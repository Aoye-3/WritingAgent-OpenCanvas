# Agent Runtime Runbook

FacetWrite treats Agent Runtime as the primary AI execution subsystem when `AGENT_BACKEND_ENABLED=true`. The current internal implementation is the AgentBackend adapter. Provider runtime and Mock output are fallback paths only; final acceptance for runtime work requires a stable Agent Runtime run with ToolUse visible and policy controlled.

## Supported Paths

- Local acceptance: Docker Desktop plus the internal Agent Runtime Docker Compose module under `modules/agent-runtime/`.
- Windows Electron development shell: Docker Desktop plus shell-managed Compose startup and ownership tracking. See `APP_SHELL_RUNBOOK.md`.
- Production: Linux or cloud host running Docker Compose.
- Windows native local mode is not the main path. If `make` or `nginx` is missing on Windows, use Docker Desktop or WSL/Linux rather than trying to install native nginx as the primary workflow.

## Required Dependencies

- Docker Desktop daemon available locally, or Docker Engine on Linux.
- Docker Compose.
- Node.js 22+ for FacetWrite.
- Corepack `pnpm` for Agent Runtime frontend dependencies.
- `uv` for Agent Runtime backend dependencies and tests.

## Ports And URLs

- FacetWrite app/API: `http://127.0.0.1:8837` for backend service-to-service callbacks.
- FacetWrite Vite UI: `http://127.0.0.1:3000` by default. The backend default avoids Windows' common excluded range around `8787`.
- Electron development shell: Vite `http://127.0.0.1:17776`, API callback `http://host.docker.internal:17777`.
- Agent Runtime nginx sidecar: `http://127.0.0.1:2026`.
- Agent Runtime gateway container service: exposed through nginx for FacetWrite runtime use.

## Environment

FacetWrite local `.env.local`:

```bash
AGENT_BACKEND_ENABLED=true
AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026
AGENT_BACKEND_ASSISTANT_ID=lead_agent
AGENT_BACKEND_AUTH_EMAIL=admin@example.com
AGENT_BACKEND_AUTH_PASSWORD=<local Agent Runtime password>
AGENT_BACKEND_AUTO_SETUP=false
AGENT_BACKEND_AUTH_TIMEOUT_MS=5000
```

`DEERFLOW_*` variables are historical and are not read by FacetWrite after the AgentBackend rename. If `/api/agent-runtime/status` reports `enabled:false` while local config looks present, check for stale `DEERFLOW_*` keys in `.env.local` and migrate them to `AGENT_BACKEND_*`.

Agent Runtime Docker environment for FacetWrite ToolUse bridge:

```bash
FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8837
FACETWRITE_INTERNAL_TOOL_TOKEN=<optional shared token>
```

When `FACETWRITE_INTERNAL_TOOL_TOKEN` is set, Agent Runtime sends it as `x-facetwrite-tool-token`; FacetWrite still also requires an internal source marker and applies normal ToolUse policy.

### Restricted Docker Registry Access

The Agent Runtime Dockerfiles are FacetWrite-owned and support project-local base image overrides. If Docker Hub is unavailable, set these in `modules/agent-runtime/.env` before running `npm run agent-runtime:up`:

```bash
NODE_IMAGE=node:22-alpine
PYTHON_IMAGE=python:3.12-slim-bookworm
DOCKER_CLI_IMAGE=docker:cli
UV_IMAGE=ghcr.io/astral-sh/uv:0.7.20
NPM_REGISTRY=https://registry.npmmirror.com
UV_INDEX_URL=https://pypi.org/simple
```

The image values may point to a local tag, private registry, or mirror. For a fully offline setup, pull the required images on a networked machine, transfer them with `docker save` / `docker load`, then tag them to the values above.

## Start Local Acceptance Runtime

1. Start Docker Desktop and confirm the daemon:

```bash
docker info
docker compose version
```

2. Start FacetWrite through the hard-bound local launcher. It requires `AGENT_BACKEND_ENABLED=true`, starts Agent Runtime Compose, waits for `http://127.0.0.1:2026/health`, then starts the FacetWrite frontend and API:

```bash
npm run dev
```

3. For Runtime-only maintenance, use the npm wrapper, which injects `AGENT_RUNTIME_ROOT` and uses project name `facetwrite-agent-runtime`:

```bash
npm run agent-runtime:up
npm run agent-runtime:status
```

4. Confirm the required Agent Runtime containers are healthy/running:

- `facetwrite-agent-runtime-nginx`
- `facetwrite-agent-runtime-frontend`
- `facetwrite-agent-runtime-gateway`

For the Electron development shell, double-click `start-opencanvas-shell.vbs`. The shell reuses a complete compatible runtime without owning it; otherwise it starts Compose and runs `down` when the application window closes.

## Smoke Checks

Agent Runtime sidecar:

```bash
curl http://127.0.0.1:2026/health
```

FacetWrite status:

```bash
curl http://127.0.0.1:8837/api/agent-runtime/status
curl http://127.0.0.1:8837/api/agent-runtime/dashboard
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

- Stop Agent Runtime.
- Run one generation.
- Confirm `agent_backend_runtime_failed` is emitted and Provider fallback still works.
- This proves fallback exists, but it is not the passing condition for Agent Runtime acceptance.

## ToolUse Acceptance

Agent Runtime built-in tools:

- Trigger `web_search` or file read style behavior.
- Confirm runtime stream/tool timeline includes `AgentBackend_*` events from the current adapter.
- Treat `web_search` as runtime built-in, not as a FacetWrite local bridge tool.

FacetWrite bridge tools:

- `knowledge_base` calls back into `/api/internal/agent-runtime/tool-call` and reads explicit runtime context. The historical `/api/internal/agent-backend/tool-call` endpoint remains a compatibility alias.
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
- Agent Runtime status says `enabled:false`: migrate stale `DEERFLOW_*` entries in `.env.local` to `AGENT_BACKEND_*`, then restart the FacetWrite API so dotenv is reloaded.
- `npm run agent-runtime:up` fails while loading metadata for `node`, `python`, `docker:cli`, or `uv`: Docker cannot reach the configured image registry. Set `NODE_IMAGE`, `PYTHON_IMAGE`, `DOCKER_CLI_IMAGE`, and `UV_IMAGE` in `modules/agent-runtime/.env` to reachable mirror/private/local image tags.
- `npm run agent-runtime:up` fails with a network pool overlap: the dev compose should not pin a fixed subnet. Let Docker allocate the runtime network.
- `facetwrite-agent-runtime-nginx` starts but `2026` is not reachable: check for old runtime containers occupying the port, stop them, and recreate the Agent Runtime nginx container through `npm run agent-runtime:up`.
- `http://127.0.0.1:2026/health` returns 502 and gateway logs mention `/app/config.yaml` is a directory: an earlier compose run created a missing bind-mounted file path as an empty directory. The launcher now repairs empty `modules/agent-runtime/config.yaml` and `modules/agent-runtime/extensions_config.json` directories by migrating the legacy files or examples, then recreates the gateway container.
- Agent Runtime `/api/skills`, `/api/mcp/config`, or `/api/runs/stream` returns 401/403: check `AGENT_BACKEND_AUTH_EMAIL`, `AGENT_BACKEND_AUTH_PASSWORD`, `AGENT_BACKEND_AUTO_SETUP`, and setup/login status.
- FacetWrite status is reachable but auth is not authenticated: wait for setup-status rate limits to cool down, then retry backend auth.
- Bridge calls fail from Docker: confirm `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8837`, FacetWrite backend is listening, and any configured token matches.
- DeepSeek tool calls fail with `reasoning_content` errors: use AgentBackend `AgentBackend.models.patched_deepseek:PatchedChatDeepSeek` for the current DeepSeek-compatible model so reasoning metadata is preserved across tool-call turns.
- `canvas_write` appears applied before user confirmation/approval: this is a blocker; the runtime bridge must only create a pending request.

## 2026-05-20 Local Validation Snapshot

- `npm run agent-runtime:up` starts `facetwrite-agent-runtime-nginx`, `facetwrite-agent-runtime-gateway`, and `facetwrite-agent-runtime-frontend`.
- `http://127.0.0.1:2026/health` returns HTTP 200.
- `http://127.0.0.1:8837/api/agent-runtime/status` returns `enabled:true`, `reachable:true`, `runtimeProvider:"agent-backend"`, and `authState:"authenticated"`.
- A direct `/api/generate` smoke test returned `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"`.
- Verification passed with `npm run typecheck` and `npm run test` after the env/script/compose corrections.

