# FacetWrite Architecture

## Overview
FacetWrite is a Vite/React frontend with an Express backend and local SQLite persistence. The backend owns Agent definitions, provider calls, Tool execution, settings, and storage. The frontend owns the application shell, workspace experience, Canvas interaction, settings screens, and API clients.

Primary flow:

```text
User input
 -> AgentCard + AgentSettings
 -> PromptBuilder + Skills + Tool policy
 -> Provider runtime
 -> Tool runtime, when tool_calls are returned
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
- `server/providerRuntime.ts` normalizes provider request behavior for supported provider IDs.
- `server/agentRunLoop.ts` runs Chat Completions, executes returned tool calls, records tool events, and stops when final content or `maxToolCalls` is reached.

## Agent And Tool Layers
- `server/agentCards.ts` defines AgentCard types, default cards, default settings, and setting application behavior.
- `server/agentRuntimeAdapter.ts` resolves Agent cards, merged settings, runtime config, tool policies, and available skills/tools.
- `server/tools/catalog.ts` is the Tool metadata source of truth.
- `server/tools/policies.ts` derives whether each tool is enabled, auto-runnable, externally configured, or approval-gated.
- `server/toolRuntime.ts` executes local ToolUse behavior and creates Canvas write requests when `canvas_write` is called.

## Storage
- `server/storage.ts` owns SQLite initialization, migrations, repositories, and local thread data directories.
- Runtime database path: `.facetwrite/data/facetwrite.db`.
- Thread file workspace path: `.facetwrite/threads/<threadId>/user-data/`.

## Important Current Constraints
- Canvas writes are never applied directly by the Agent. The Agent can only create a pending write request, and the user approves or rejects it.
- Tool definitions, prompt hints, schemas, risk levels, and approval requirements should stay in the Tool catalog/policy layer.
- Provider details should stay behind provider runtime/profile code rather than being inferred in UI components.

