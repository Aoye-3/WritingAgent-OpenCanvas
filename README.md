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

## Future Development Roadmap

OpenCanvas 的长期方向是一个本地优先的 FigJam + Agent 画板工作区：画板既是视觉创作空间，也是 Agent 可理解、可建议、可调度工具的工作文件。它应当像 PS/Figma 文件一样保存完整项目状态，包括画板节点、连接关系、资源、工作流信息、Agent 对话、ToolUse 事件和写入审批记录。

功能实现层面先对标 FigJam 画板：稳定的无限画布、主工具栏、对象快捷栏、节点/连线/文本/资源操作、多人协作前的本地文件体验。创新点不在于重新发明画板，而在于 Agent 工具调度与人机协作上下文管理：Agent 能理解当前选区、显式发送的思维链、工作流阶段、Role 节点关系和写入审批状态，并在可审计、可确认的边界内调用画板工具。

### Current Foundation

The project already has the core local foundation:

- Local-first workspace: Vite/React frontend, Express API, SQLite/local file persistence, and Agent Runtime sidecar.
- Canvas V2: React Flow-based pan/zoom/drag canvas with document, note, reference, and role nodes.
- Canvas structure: directed edges, node resize/edit/delete, right-click creation, session undo, workflow stage, Role nodes, and Role suggestions.
- Agent Runtime: AgentBackend adapter, Lead Agent/subagent mapping, ToolUse bridge, Knowledge, Memory controls, runtime dashboard, and provider fallback.
- Human-in-the-loop writes: Agent-originated Canvas changes go through pending write requests and approval before mutation.

### Development Phases

1. **Board File Model**
   - Treat each project/thread as an OpenCanvas board file.
   - Define a durable board snapshot shape that groups Canvas nodes, edges, workflow state, assets, Agent conversations, tool events, write approvals, and version metadata.
   - Keep SQLite as the local source of truth first; add import/export only after the board shape is stable.

2. **FigJam-Style Canvas Toolbar**
   - Benchmark the core board interaction model against FigJam while keeping OpenCanvas local-first and Agent-aware.
   - Add a floating board toolbar for core creation modes: select, hand/pan, text, note/card, shape, table/grid, connector, role node, asset/image, and insert.
   - Reuse existing Canvas node creation and edge APIs instead of inventing parallel creation paths.
   - Make toolbar modes visible UI state only; persisted truth remains Canvas nodes, edges, metadata, and workflow records.

3. **Contextual Quick Bar**
   - Add a selection quick bar that appears near the selected object.
   - For text/document/note/reference nodes, expose local actions such as text style, size, list/link, node kind, workflow stage, and delete.
   - For role nodes, expose role label/prompt editing and suggestion actions.
   - For edges, expose delete and future line style controls.
   - Keep quick-bar actions as direct user edits; Agent-originated edits still use approval-aware paths.

4. **Agent-Callable Board Tools**
   - Treat Agent tool orchestration and human-AI context management as the main product innovation beyond the FigJam-like board surface.
   - Expand the current `canvas_write` idea into board-aware tool intents such as create node, append content, connect nodes, propose layout cleanup, create Role suggestion, and summarize selected chain.
   - Continue routing all tool execution through FacetWrite tool policy and the Agent Runtime bridge.
   - Low-risk additive operations may become confirmable suggestions; destructive replace/delete operations must remain approval-gated.
   - Agent context should stay filtered by explicit selection, sent mind chain, workflow stage, and connected Role nodes.

5. **Local Assets, Versions, And Export**
   - Add board asset records for images and attachments stored under the local `.facetwrite` workspace.
   - Add board snapshots/version history so a user can restore prior board states.
   - Add local export/import for portable OpenCanvas board files after the data model is stable.

6. **Online Collaboration**
   - Add online collaboration only after the local board model and Agent tool boundary are stable.
   - Introduce accounts/workspaces, shared board sync, presence cursors, comments, permissions, and share links.
   - Use a conflict-safe collaboration layer for concurrent Canvas edits while preserving local-first/offline behavior where possible.
   - Keep Agent actions auditable in multiplayer sessions: participants should be able to see what the Agent proposed, who approved it, and what changed.

### Product Principles

- Local-first before cloud sync.
- Reuse existing Canvas APIs, storage, Agent Runtime adapter, and Tool policy before creating new boundaries.
- Agent actions must be inspectable, reversible where practical, and approval-gated when destructive.
- The board UI should prioritize real creation workflows: fast toolbar access, reliable selection, clean quick actions, and no hidden context surprises.
