# FacetWrite Architecture

## Naming
OpenCanvas is the external product name for the AI canvas workspace and should be the primary visible brand. FacetWrite remains a small technical lineage mark in the brand lockup and the internal architecture/code name, so existing modules, API routes, env vars, local data paths, and runtime boundaries intentionally keep the FacetWrite name.

## Overview
FacetWrite is a Vite/React workspace and control plane with an Express backend and local SQLite persistence. FacetWrite owns the user workspace, configuration surfaces, interaction windows, Human-in-the-loop approval, and product data boundary. Agent Runtime is the internal AI execution subsystem for Lead Agent, subagents, ToolUse, MCP, and intelligent orchestration. The current Agent Runtime implementation is the AgentBackend adapter.

Primary flow:

```text
User input
 -> AgentCard + AgentSettings
 -> PromptBuilder + Skills + Tool policy
 -> Agent Runtime, when AGENT_BACKEND_ENABLED=true
 -> Provider runtime fallback, when Agent Runtime is disabled or returns no user-visible answer
 -> Tool runtime, when local tool_calls are returned by the fallback runtime
 -> SQLite run records and Canvas write requests
 -> Thread state refresh in the UI
```

Runtime ownership is intentionally split into four layers:

```text
Frontend React workspace
 -> Express API/control plane
 -> FacetWrite storage: SQLite + local files
 -> AgentRuntime sidecar only through the backend adapter
```

The frontend owns interaction state and explicit user intent. The Express backend owns policy, orchestration, output normalization, and all product-data writes. SQLite/local files are the source of truth for threads, Canvas, settings, runs, and Knowledge metadata. AgentRuntime is an execution subsystem: it receives sanitized runtime context from FacetWrite and can call back only through the internal ToolUse bridge.

## Frontend
- `src/app/App.tsx` is the control-plane composition layer. It owns navigation, active Agent selection, and view wiring, while thread, generation, Canvas, and trash workflows live in focused hooks under `src/app/hooks/`.
- `src/app/hooks/useThreadSession.ts` owns thread creation, thread restore, and last-thread persistence.
- `src/app/hooks/useCanvasState.ts` is the Canvas state composition hook. Canvas API operation orchestration lives in `useCanvasActions.ts`, session undo ownership lives in `useCanvasHistory.ts`, and pure undo helpers live in `shared/canvasHistory.ts`.
- `src/app/hooks/useGenerationRun.ts` owns structured generation, chat generation, streaming token/status/tool-event updates, versions, collaboration messages, and direct Canvas-write intent handoff. For chat streaming it creates a temporary assistant message in the right AI collaboration drawer, fills that assistant bubble through a typewriter queue, then reconciles with persisted thread state after the final response. The main Canvas layout is not a streaming transcript surface. When the user explicitly asks to write to Canvas, it auto-approves only the new pending write requests created by that run.
- `src/app/hooks/useProjectTrash.ts` owns trash, restore, and hard-delete flows.
- `src/features/settings/hooks/useProjectSettings.ts` owns provider settings state, validation/save actions, and Agent Runtime status loading. `ProjectSettingsPanel` only renders the dialog shell and composes the provider form with the read-only runtime panel.
- `src/features/agents/hooks/useAgentRuntimeConfig.ts` owns Agent runtime-config loading and settings save. `AgentSettingsView` owns gallery/filter/tab navigation, while tab UI lives in `src/features/agents/components/AgentSettingsTabs.tsx`.
- `src/features/*` groups product areas: agents, canvas, generation, home, i18n, knowledge, projects, settings, start, tasks, and workspace.
- `src/shared/ui/` is the lightweight FacetWrite UI primitive layer. It provides shared buttons, fields, chips, tabs, panels, drawers, dialogs, badges, and empty states without owning business data or backend/runtime behavior.
- `public/assets/ui/` is the local UI and image asset library. Brand asset URLs are centralized in `src/shared/brandAssets.ts` so components avoid hard-coded public paths. See `docs/UI_ASSETS.md`.
- `src/features/workspace/WorkspaceView.tsx` renders the main writing workspace: structured Agent inputs, document Canvas, collaboration drawer, tool events, version history, and workspace utility surfaces.
- `src/features/workspace/components/AICollaborationDrawer.tsx` owns chat-side Canvas write proposals, temporary streaming assistant status, temporary response annotations, annotation chips, and highlighted assistant-message text. Annotation chips are shown both in the proposal panel and above the composer so the user can see the active write selection before sending "write" instructions. Annotation state is intentionally client-only and is cleared after write/cancel/page refresh.
- `src/features/workspace/components/DocumentCanvas.tsx` renders Canvas V2 through `@xyflow/react`. React Flow owns viewport pan, zoom, selection, and node dragging; FacetWrite owns node rendering, node CRUD calls, resize persistence, and Canvas write approval flows. Shared Canvas submodules under `src/features/workspace/components/canvas/` keep the node frame, node-kind renderers, edge rendering, resize/layout helpers, and node constants separated from the Canvas container.
- Canvas Workflow is layered over Canvas V2 without becoming the spatial engine. `shared/canvasWorkflow.ts` owns stage, Role-node, suggestion, and context-filtering pure helpers; `useCanvasState.ts`/`useCanvasActions.ts` own frontend state and API orchestration; `DocumentCanvas.tsx` and `CanvasNodeFrame.tsx` only render workflow controls, function nodes, badges, and suggestions through passed data/callbacks. Workflow control features that need targeted influence should be nodeized and relationship-driven, not added as more controls on ordinary content nodes.
- `src/features/canvas/CanvasNodeSettingsView.tsx` is the left-navigation Canvas node type catalog. It explains note, document, and reference semantics without reading current project node content or mutating Canvas state.
- Canvas hit testing is intentionally split between React Flow pane interactions and FacetWrite node controls. Inputs/buttons use `nodrag`, resize controls use `nodrag nopan`, and any future overlay must be browser-verified so it does not block pane context menus, pan/zoom, node drag, node resize, or node editing. See `docs/CANVAS.md`.
- Canvas browser coverage lives in Playwright under `tests/e2e/canvas.spec.ts`; stable `data-testid` hooks are allowed for Canvas controls but should not become product behavior.
- `src/shared/MarkdownText.tsx` preserves Markdown block/inline rendering while optionally wrapping annotated text fragments in highlight marks.
- Runtime context is sourced from the left AgentCard structured input drawer plus current draft/Canvas state. The bottom workspace utility bar is reserved for future tools and prompt preview; it must not inject course-note, audience-profile, or other hidden context.
- Canvas node context is kind-aware and workflow-aware: notes are excluded by default, documents contribute previews, references contribute reference content, Role nodes contribute prompts only when connected to selected/filtered content nodes, and Canvas Workflow filters narrow runtime context by selected/specified chain, current stage, and `Role -> content` edges. Explicitly sent mind chains may include notes because they are user-selected context.
- `src/features/ai-dashboard/AiDashboardView.tsx` renders the AI runtime dashboard for Agent Runtime status, Skills/MCP visibility, Agent mapping, and ToolUse bridge progress.
- `src/features/knowledge/KnowledgeSettingsView.tsx` renders the local Knowledge Base management console for creating RAG bases, importing text/URL/sitemap/local-file sources, viewing indexing status, and testing retrieval.
- Agent Settings renders Knowledge runtime controls from the same Knowledge API: users can enable Knowledge, search all bases or selected base ids, and tune retrieval count/threshold without adding new API endpoints.
- `src/shared/apiClient.ts` provides shared frontend API helpers used by feature clients.

## Backend
- `server/index.ts` starts the HTTP server.
- `server/app.ts` wires Express middleware, storage, Agent runtime, generation service, and route modules.
- `server/routes/*` defines API endpoints for health, catalog, agents, threads, projects, Canvas, settings, and generation. Routes should call domain public APIs or compatibility facades; they should not reach into domain-internal stores or fetchers.
- `server/domains/model-config/` owns provider references, configured model API bindings, local API key persistence, and remote provider model listing.
- `server/domains/generation/` is the public domain entry for prompt/run-context building, Agent Runtime runner, provider runner, and run recording. `server/services/generationService.ts` remains a compatibility export.
- `server/domains/knowledge/` is the public domain entry for KnowledgeService creation and model binding resolution for embedding/rerank credentials.
- `server/services/*` now contains compatibility exports plus legacy service facades. New code should prefer `server/domains/*/index.ts` where a domain exists.
- `server/knowledge/*` contains the server-owned Knowledge Base runtime. It wraps the Cherry Studio embedjs/libSQL dependency stack behind FacetWrite APIs and keeps vector data under `.facetwrite/knowledge/`.
- `server/runtime/agentRuntimePort.ts` defines the stable FacetWrite execution-runtime boundary. `server/runtime/agentBackendAdapter/*` contains the current AgentBackend implementation: backend-only auth session handling, SSE parsing, runtime status, read-only config proxy, AgentCard-to-subagent mapping, and token/status forwarding for `/api/generate/stream`. `server/agentBackend/*` remains a short-term compatibility re-export layer.
- `server/providerRuntime.ts` normalizes provider request behavior for supported provider IDs, including Chat Completions streaming behind the provider profile boundary.
- `server/agentRunLoop.ts` runs Chat Completions, executes returned tool calls, records tool events, streams final assistant tokens when available, and stops when final content or `maxToolCalls` is reached.

## Agent And Tool Layers
- `server/agentCards.ts` is a compatibility export for the Agent modules under `server/agents/`.
- `server/agents/types.ts` defines AgentCard and AgentSettings types.
- `server/agents/cards/builtInCards.ts` defines built-in Agent cards and localized field metadata.
- `server/agents/prompts.ts` stores built-in identity prompts.
- `server/agents/defaultSettings.ts` defines default model, prompt, tool, knowledge, memory, and quick-message settings.
- `server/agents/loader.ts` exposes built-in cards and applies saved settings to cards.
- `server/agentRuntimeAdapter.ts` resolves Agent cards, merged settings, runtime config, tool policies, and available skills/tools.
- `server/tools/catalog.ts` is the Tool metadata source of truth.
- `server/tools/policies.ts` derives whether each tool is enabled, auto-runnable, externally configured, or approval-gated.
- `server/tools/toolPolicyGuard.ts` performs runtime checks before a tool call can execute.
- `server/toolRuntime.ts` executes local ToolUse behavior and creates Canvas write requests when `canvas_write` is called. If a model asks for `replace` without an explicit user replace/overwrite instruction, the runtime normalizes the operation to `append` for a selected node or `create` otherwise.
- Canvas directed edges are FacetWrite-owned project data stored in `canvas_edges`. They are used to assemble user-triggered mind chains for the right collaboration composer and are not a model-write bypass.
- Canvas Workflow state is FacetWrite-owned project data stored in `canvas_workflows`, Role nodes in `canvas_nodes`, Role relationships in `canvas_edges`, node stage metadata, and `canvas_workflow_suggestions`. Agent Runtime receives only the filtered context prepared by FacetWrite and can create suggestions or pending write requests only through FacetWrite API/tool paths.

## Agent Output Boundary
- Runtime streams may feed temporary UI-only assistant messages, but they are never treated as persisted truth. AgentBackend/provider output must pass through the Agent output normalizer before it is recorded as an assistant message or output version.
- The normalizer separates user-visible assistant text from tool/internal events. System prompts, AgentCard prompt blocks, ToolUse JSON, search result JSON, reasoning payloads, and AgentBackend replay values are blocked from chat/output surfaces and recorded only as redacted runtime events.
- `/api/generate/stream` uses a server-side progressive text gate before releasing text so obvious internal prompt, ToolUse, search JSON, and reasoning payload leaks are not streamed into the UI. After the initial safety buffer, the gate emits small user-visible UI chunks instead of large paragraph-sized blocks; long flush/final remainders are also split before they reach the browser.
- The frontend treats streamed chunks as input to a UI-only typewriter queue. In chat mode the visible queue target is the assistant bubble in `AICollaborationDrawer`; `final` remains authoritative for persistence, but the UI waits for that typewriter queue to drain and only corrects visible text if the final recorded output differs from the streamed text.
- If AgentBackend returns an empty answer or only internal/runtime output, FacetWrite records a `agent_backend_runtime_failed` event and continues with the Provider runtime. Only if the Provider runtime also fails does the run enter Mock fallback.
- Stored historical messages and output versions are sanitized again at read time so older leaked local records cannot reappear in the workspace UI.

## Knowledge Runtime Boundary
- Knowledge Base is a server-owned capability. The frontend can manage bases and items, but SQLite metadata and vector indexes are owned by the backend.
- FacetWrite uses Cherry Studio's Apache-licensed embedjs package family as the RAG engine: `RAGApplicationBuilder`, `LibSqlDb`, OpenAI/Ollama embeddings, Web loader, Sitemap loader, local path loader, JSON loader, and text loader.
- FacetWrite does not copy Cherry Studio application code into runtime paths. The checked-out Cherry Studio source remains reference material under `reference/sources/cherry-studio/`.
- Knowledge vector stores live under `.facetwrite/knowledge/<baseId>/vectors.db`; FacetWrite's main SQLite DB stores only metadata, item state, source audit, and events.
- During generation, `promptRunBuilder` performs retrieval when Agent knowledge is enabled and the `knowledge_base` tool is active. Results are injected as explicit Knowledge References and recorded as `knowledge_search_completed` tool events. Agent settings can constrain retrieval with `knowledge.baseIds`, `knowledge.documentCount`, and `knowledge.threshold`.
- The local `knowledge_base` tool and AgentBackend internal bridge call the same KnowledgeService search path, including optional selected base ids. If search fails or no results exist, the tool safely falls back to explicit runtime context values.

## Provider Adapter Boundary
- Provider-specific wire fields stay behind `server/providerRuntime.ts` and the provider profile capability model.
- Provider metadata, docs links, base URL defaults, static model references, and model capability flags live in the FacetWrite-owned model registry under `shared/model/`. The registry copies and adapts reference data into this project; runtime code must not import from `reference/sources/cherry-studio`.
- Provider API credentials are separate from raw provider/model references. Local credentials live in `.facetwrite/provider-apis.json` as configured model API bindings: one callable row per `providerId + modelId + apiKey/baseURL`.
- The Model Config page is a first-level workspace view. It shows the complete provider model catalog separately from the local API model list. The catalog is for discovery; the local list is the set of bindings that Agents and Knowledge Bases may call.
- Dynamic model listing is backend-owned under `server/domains/model-config/model-list/`: `service.ts` handles fallback flow, `fetchers.ts` holds provider-specific remote strategies, and `utils.ts` owns response parsing and redaction helpers. `server/services/modelListService.ts` is only a compatibility export.
- Dynamic model listing remains a provider catalog operation: request draft key/base URL first, saved binding for that provider second, registry defaults for non-secret fields last. It must not borrow a key from another provider.
- The TypeScript provider runner resolves the active Agent's `configuredModelApiId` at request time. Legacy `providerId + model` settings are still accepted as fallback, but Agent settings must not store API keys or copied base URLs.
- Knowledge Bases resolve `embeddingConfigId` and `rerankConfigId` through the same configured model API store, so embedding/rerank credentials are not read from unrelated Agent provider settings.
- DeepSeek `reasoning_content` is runtime-only state. It may be preserved across thinking-mode tool-call turns so DeepSeek can continue a valid conversation, but it is never part of FacetWrite's public message, output version, or Canvas schemas.
- Provider-private fields are stripped for providers that do not explicitly support them, including OpenAI-compatible defaults.
- Per-run model overrides from the workspace composer are limited to safe runtime controls such as DeepSeek Think mode and reasoning effort. They do not mutate Agent settings.

## Agent Runtime Boundary
- Agent Runtime is now a FacetWrite internal subsystem, not reference source. Its source lives under `modules/agent-runtime/`.
- FacetWrite calls the current AgentBackend adapter as an independent Python sidecar over HTTP/SSE when `AGENT_BACKEND_ENABLED=true`.
- The validated local sidecar path is Docker Compose through Agent Runtime nginx at `http://127.0.0.1:2026`.
- Runtime enablement is controlled only by `AGENT_BACKEND_*` variables. Historical `DEERFLOW_*` variables are migration artifacts and must not be used for active FacetWrite configuration.
- The local dev compose project is `facetwrite-agent-runtime` and container names use `facetwrite-agent-runtime-*`. The FacetWrite acceptance compose keeps host Docker socket and local CLI credential directories out of the gateway container by default; those mounts should only be reintroduced for isolated sandbox/CLI-auth experiments.
- FacetWrite authenticates to protected AgentBackend APIs with a backend-managed local session cookie and CSRF token; these credentials are never returned to the frontend.
- AgentBackend `lead_agent` is the default main-agent entrypoint.
- FacetWrite Task cards are mapped to AgentBackend subagent metadata with skills, tools, model inheritance, timeout, and max-turn defaults.
- FacetWrite exposes Agent Runtime status, config overview, dashboard, and FacetWrite-managed Memory endpoints at `/api/agent-runtime/*`, with `/api/agent-backend/*` kept as compatibility aliases where applicable.
- FacetWrite exposes an AI Dashboard that summarizes Agent Runtime health, auth, Skills/MCP, AgentCard-to-subagent mapping, ToolUse bridge status, and editable FacetWrite-managed Memory.
- FacetWrite exposes `/api/internal/agent-runtime/tool-call` as the service-to-service ToolUse bridge, with `/api/internal/agent-backend/tool-call` kept as a compatibility alias. Deprecated `/api/internal/deerflow/tool-call` exists only for old sidecars. The bridge accepts only trusted local/container calls, reuses `executeToolCall`, applies the Tool catalog policy guard, and keeps Canvas writes as pending requests.
- AgentBackend loads `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write` through `AgentBackend.tools.facetwrite_bridge`. The Docker default callback URL is `http://host.docker.internal:8837`.
- AgentBackend `web_search` remains a AgentBackend built-in tool and is not counted as a FacetWrite local bridge tool.
- AgentBackend global memory is not injected or updated for FacetWrite runs by default. Per-run context carries `facetwrite_memory_enabled`; when enabled, only FacetWrite-managed Memory content is injected.
- FacetWrite remains responsible for product data, SQLite persistence, frontend state, Canvas approval, and local fallback behavior.
- AgentBackend runtime failures that are recoverable by the Provider runtime are visible in the Tool event timeline as `agent_backend_runtime_failed` with a safe fallback summary.
- Current validation target: sidecar health, backend auth, config overview, one Task-card generation, five repeated AgentBackend generations, and both AgentBackend built-in ToolUse plus FacetWrite bridge ToolUse against the Docker sidecar. The latest 2026-05-20 smoke test confirmed `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"`.

## Storage
- `server/storage.ts` is the compatibility facade for local persistence. It preserves the public storage API used by routes and services.
- `server/db/sqlite.ts` initializes SQLite, enables WAL and foreign keys, and calls schema migration.
- `server/db/schema.ts` owns schema creation and idempotent migration checks.
- `server/repositories/*` contains focused repository boundaries introduced behind the facade. Thread listing/trash, Agent settings, and Canvas persistence delegate through repository classes; `server/storage.ts` remains the compatibility facade used by routes and services.
- Runtime database path: `.facetwrite/data/facetwrite.db`.
- Knowledge vector path: `.facetwrite/knowledge/<baseId>/vectors.db`.
- Thread file workspace path: `.facetwrite/threads/<threadId>/user-data/`.
- Thread rows are the current project identity boundary. Project rename updates `threads.title`; AgentCard names remain type metadata and are displayed as secondary information.
- Canvas undo depth is stored in the generic `settings` table under the `canvas` key. The undo stack itself is browser-session state and is not persisted.
- Canvas Workflow stores one project-level stage and Role library per thread in `canvas_workflows`. Individual node stage remains in `canvas_nodes.metadata.workflow.stage`. Role behavior lives in `role` Canvas nodes plus directed `Role -> content` edges; legacy `metadata.workflow.roles` is migrated away. Role suggestions live in `canvas_workflow_suggestions` with both `roleNodeId` and `targetNodeId`.

## Domain Dependency Rules
- `routes -> domains -> repositories/shared/config/security/utils`.
- `Agent` and `Knowledge` may use `model-config` public resolvers; `model-config` must not depend on Agent, Knowledge, Generation, or UI modules.
- Frontend feature clients own their feature API calls. `src/features/model-config/modelConfigClient.ts` owns provider catalog and configured model API requests; `src/features/settings/settingsClient.ts` owns settings status and validation/save compatibility; runtime status/config calls use `/api/agent-runtime/*`.
- Compatibility files are allowed only to preserve old imports during branch convergence. New code should import from domain public `index.ts` files or feature-local clients.

## Test Boundaries
- Server and shared pure helpers are covered by `node --import tsx --test server/**/*.test.ts`, exposed through `npm.cmd test`.
- Agent Knowledge readiness is covered by deterministic server tests: generation facade tests prove unique Knowledge facts reach provider messages as `Knowledge References`, and Tool Runtime tests prove the `knowledge_base` bridge prefers RAG results and forwards selected base ids.
- Frontend Canvas interaction coverage is Playwright-based. `npm.cmd run test:e2e:canvas` runs `tests/e2e/canvas.spec.ts` against the local Vite/Express dev server and verifies node type creation, session undo, blur persistence, kind conversion preservation, directed edge creation/deletion, and explicit mind-chain drafting.
- Playwright tests may use stable `data-testid` hooks for interaction targets, but those hooks are test infrastructure only and must not carry product state or business rules.

## Important Current Constraints
- Canvas background drag, context-menu creation, and node resize depend on pointer events reaching the correct React Flow pane or FacetWrite node control. Any future decorative grid, empty state, alignment guide, selection marquee, or overlay should be verified with browser hit testing so it does not become an invisible interaction blocker.
- Canvas writes are never applied directly by the Agent. The Agent can only create a pending write proposal/request. The UI may ask the user to write all content or only annotated snippets, then convert that explicit confirmation into the backend approve/apply flow. Direct user commands such as "鍐欏叆" or "save to canvas" are treated as explicit confirmation for the new request from that same run, not as permission to apply older pending proposals.
- Agent Runtime-generated write or side-effect proposals must still be converted into FacetWrite confirmation and approval flows before data changes. AgentRuntime does not read or write Canvas storage directly; it receives frontend-filtered context through the backend generation request and can affect Canvas only through the internal ToolUse bridge.
- Tool definitions, prompt hints, schemas, risk levels, and approval requirements should stay in the Tool catalog/policy layer.
- Provider details should stay behind provider runtime/profile code rather than being inferred in UI components.
