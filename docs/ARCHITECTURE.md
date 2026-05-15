# FacetWrite Architecture

## Overview
FacetWrite is a Vite/React frontend with an Express backend and local SQLite persistence. The backend owns Agent definitions, provider calls, Tool execution, settings, and storage. The frontend owns the application shell, workspace experience, Canvas interaction, settings screens, and API clients.

Primary flow:

```text
User input
 -> AgentCard + AgentSettings
 -> PromptBuilder + Skills + Tool policy
 -> DeerFlow runtime, when DEERFLOW_ENABLED=true
 -> Provider runtime fallback, when DeerFlow is disabled
 -> Tool runtime, when local tool_calls are returned by the fallback runtime
 -> SQLite run records and Canvas write requests
 -> Thread state refresh in the UI
```

## Frontend
- `src/app/App.tsx` coordinates app-level state, navigation, active Agent, thread state, generation, Canvas state, and settings panel visibility.
- `src/features/*` groups product areas: agents, canvas, generation, home, i18n, knowledge, projects, settings, start, tasks, and workspace.
- `src/features/workspace/WorkspaceView.tsx` renders the main writing workspace: structured Agent inputs, document Canvas, collaboration drawer, tool events, version history, and context/prompt preview surfaces.
- `src/shared/apiClient.ts` provides shared frontend API helpers used by feature clients.

## Backend
- `server/index.ts` starts the HTTP server.
- `server/app.ts` wires Express middleware, storage, Agent runtime, generation service, and route modules.
- `server/routes/*` defines API endpoints for health, catalog, agents, threads, projects, Canvas, settings, and generation.
- `server/services/*` contains Agent definition/catalog behavior, generation orchestration, and settings persistence/validation.
- `server/deerflow/*` contains the DeerFlow sidecar runtime adapter, backend-only auth session handling, SSE parsing, runtime status, read-only config proxy, and AgentCard-to-subagent mapping.
- `server/providerRuntime.ts` normalizes provider request behavior for supported provider IDs.
- `server/agentRunLoop.ts` runs Chat Completions, executes returned tool calls, records tool events, and stops when final content or `maxToolCalls` is reached.

## Agent And Tool Layers
- `server/agentCards.ts` defines AgentCard types, default cards, default settings, and setting application behavior.
- `server/agentRuntimeAdapter.ts` resolves Agent cards, merged settings, runtime config, tool policies, and available skills/tools.
- `server/tools/catalog.ts` is the Tool metadata source of truth.
- `server/tools/policies.ts` derives whether each tool is enabled, auto-runnable, externally configured, or approval-gated.
- `server/toolRuntime.ts` executes local ToolUse behavior and creates Canvas write requests when `canvas_write` is called.

## DeerFlow Runtime Boundary
- DeerFlow is now an integration foundation for Agent runtime work, not only reference source.
- FacetWrite calls DeerFlow as a Python sidecar over HTTP/SSE when `DEERFLOW_ENABLED=true`.
- The validated local sidecar path is Docker Compose through DeerFlow nginx at `http://127.0.0.1:2026`.
- FacetWrite authenticates to protected DeerFlow APIs with a backend-managed local session cookie and CSRF token; these credentials are never returned to the frontend.
- DeerFlow `lead_agent` is the default main-agent entrypoint.
- FacetWrite Task cards are mapped to DeerFlow subagent metadata with skills, tools, model inheritance, timeout, and max-turn defaults.
- FacetWrite exposes read-only DeerFlow status and config overview endpoints for UI observability.
- FacetWrite remains responsible for product data, SQLite persistence, frontend state, Canvas approval, and local fallback behavior.
- Current validation status: sidecar health, backend auth, config overview, and one Task-card generation are online against the Docker sidecar.

## Storage
- `server/storage.ts` owns SQLite initialization, migrations, repositories, and local thread data directories.
- Runtime database path: `.facetwrite/data/facetwrite.db`.
- Thread file workspace path: `.facetwrite/threads/<threadId>/user-data/`.

## Important Current Constraints
- Canvas writes are never applied directly by the Agent. The Agent can only create a pending write request, and the user approves or rejects it.
- DeerFlow-generated write or side-effect proposals must still be converted into FacetWrite approval flows before data changes.
- Tool definitions, prompt hints, schemas, risk levels, and approval requirements should stay in the Tool catalog/policy layer.
- Provider details should stay behind provider runtime/profile code rather than being inferred in UI components.
