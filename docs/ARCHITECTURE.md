# FacetWrite Architecture

## Overview
FacetWrite is a Vite/React workspace and control plane with an Express backend and local SQLite persistence. FacetWrite owns the user workspace, configuration surfaces, interaction windows, Human-in-the-loop approval, and product data boundary. DeerFlow is the AI execution/runtime plane for Lead Agent, subagents, ToolUse, MCP, and intelligent orchestration.

Primary flow:

```text
User input
 -> AgentCard + AgentSettings
 -> PromptBuilder + Skills + Tool policy
 -> DeerFlow runtime, when DEERFLOW_ENABLED=true
 -> Provider runtime fallback, when DeerFlow is disabled or returns no user-visible answer
 -> Tool runtime, when local tool_calls are returned by the fallback runtime
 -> SQLite run records and Canvas write requests
 -> Thread state refresh in the UI
```

## Frontend
- `src/app/App.tsx` is the control-plane composition layer. It owns navigation, active Agent selection, and view wiring, while thread, generation, Canvas, and trash workflows live in focused hooks under `src/app/hooks/`.
- `src/app/hooks/useThreadSession.ts` owns thread creation, thread restore, and last-thread persistence.
- `src/app/hooks/useCanvasState.ts` owns Canvas nodes, pending write requests, selected node state, and approve/reject handlers.
- `src/app/hooks/useGenerationRun.ts` owns structured generation, chat generation, streaming token/status/tool-event updates, versions, collaboration messages, and direct Canvas-write intent handoff. For chat streaming it creates a temporary assistant message in the right AI collaboration drawer, fills that assistant bubble through a typewriter queue, then reconciles with persisted thread state after the final response. The main Canvas layout is not a streaming transcript surface. When the user explicitly asks to write to Canvas, it auto-approves only the new pending write requests created by that run.
- `src/app/hooks/useProjectTrash.ts` owns trash, restore, and hard-delete flows.
- `src/features/settings/hooks/useProjectSettings.ts` owns provider settings state, validation/save actions, and DeerFlow status loading. `ProjectSettingsPanel` only renders the dialog shell and composes the provider form with the read-only DeerFlow runtime panel.
- `src/features/agents/hooks/useAgentRuntimeConfig.ts` owns Agent runtime-config loading and settings save. `AgentSettingsView` owns gallery/filter/tab navigation, while tab UI lives in `src/features/agents/components/AgentSettingsTabs.tsx`.
- `src/features/*` groups product areas: agents, canvas, generation, home, i18n, knowledge, projects, settings, start, tasks, and workspace.
- `src/shared/ui/` is the lightweight FacetWrite UI primitive layer. It provides shared buttons, fields, chips, tabs, panels, drawers, dialogs, badges, and empty states without owning business data or backend/runtime behavior.
- `src/features/workspace/WorkspaceView.tsx` renders the main writing workspace: structured Agent inputs, document Canvas, collaboration drawer, tool events, version history, and workspace utility surfaces.
- `src/features/workspace/components/AICollaborationDrawer.tsx` owns chat-side Canvas write proposals, temporary streaming assistant status, temporary response annotations, annotation chips, and highlighted assistant-message text. Annotation chips are shown both in the proposal panel and above the composer so the user can see the active write selection before sending "write" instructions. Annotation state is intentionally client-only and is cleared after write/cancel/page refresh.
- `src/features/workspace/components/DocumentCanvas.tsx` renders Canvas V2 through `@xyflow/react`. React Flow owns viewport pan, zoom, selection, and node dragging; FacetWrite owns node rendering, node CRUD calls, resize persistence, and Canvas write approval flows.
- Canvas hit testing is intentionally split between React Flow pane interactions and FacetWrite node controls. Inputs/buttons use `nodrag`, resize controls use `nodrag nopan`, and any future overlay must be browser-verified so it does not block pane context menus, pan/zoom, node drag, node resize, or node editing. See `docs/CANVAS.md`.
- `src/shared/MarkdownText.tsx` preserves Markdown block/inline rendering while optionally wrapping annotated text fragments in highlight marks.
- Runtime context is sourced from the left AgentCard structured input drawer plus current draft/Canvas state. The bottom workspace utility bar is reserved for future tools and prompt preview; it must not inject course-note, audience-profile, or other hidden context.
- `src/features/ai-dashboard/AiDashboardView.tsx` renders the AI runtime dashboard for DeerFlow status, Skills/MCP visibility, Agent mapping, and ToolUse bridge progress.
- `src/features/knowledge/KnowledgeSettingsView.tsx` renders the local Knowledge Base management console for creating RAG bases, importing text/URL/sitemap/local-file sources, viewing indexing status, and testing retrieval.
- `src/shared/apiClient.ts` provides shared frontend API helpers used by feature clients.

## Backend
- `server/index.ts` starts the HTTP server.
- `server/app.ts` wires Express middleware, storage, Agent runtime, generation service, and route modules.
- `server/routes/*` defines API endpoints for health, catalog, agents, threads, projects, Canvas, settings, and generation.
- `server/services/*` contains Agent definition/catalog behavior, generation orchestration, and settings persistence/validation.
- `server/knowledge/*` contains the server-owned Knowledge Base runtime. It wraps the Cherry Studio embedjs/libSQL dependency stack behind FacetWrite APIs and keeps vector data under `.facetwrite/knowledge/`.
- `server/deerflow/*` contains the DeerFlow sidecar runtime adapter, backend-only auth session handling, SSE parsing, runtime status, read-only config proxy, AgentCard-to-subagent mapping, and token/status forwarding for `/api/generate/stream`.
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

## Agent Output Boundary
- Runtime streams may feed temporary UI-only assistant messages, but they are never treated as persisted truth. DeerFlow/provider output must pass through the Agent output normalizer before it is recorded as an assistant message or output version.
- The normalizer separates user-visible assistant text from tool/internal events. System prompts, AgentCard prompt blocks, ToolUse JSON, search result JSON, reasoning payloads, and DeerFlow replay values are blocked from chat/output surfaces and recorded only as redacted runtime events.
- `/api/generate/stream` uses a server-side progressive text gate before releasing text so obvious internal prompt, ToolUse, search JSON, and reasoning payload leaks are not streamed into the UI. After the initial safety buffer, the gate emits small user-visible UI chunks instead of large paragraph-sized blocks; long flush/final remainders are also split before they reach the browser.
- The frontend treats streamed chunks as input to a UI-only typewriter queue. In chat mode the visible queue target is the assistant bubble in `AICollaborationDrawer`; `final` remains authoritative for persistence, but the UI waits for that typewriter queue to drain and only corrects visible text if the final recorded output differs from the streamed text.
- If DeerFlow returns an empty answer or only internal/runtime output, FacetWrite records a `deerflow_runtime_failed` event and continues with the Provider runtime. Only if the Provider runtime also fails does the run enter Mock fallback.
- Stored historical messages and output versions are sanitized again at read time so older leaked local records cannot reappear in the workspace UI.

## Knowledge Runtime Boundary
- Knowledge Base is a server-owned capability. The frontend can manage bases and items, but SQLite metadata and vector indexes are owned by the backend.
- FacetWrite uses Cherry Studio's Apache-licensed embedjs package family as the RAG engine: `RAGApplicationBuilder`, `LibSqlDb`, OpenAI/Ollama embeddings, Web loader, Sitemap loader, local path loader, JSON loader, and text loader.
- FacetWrite does not copy Cherry Studio application code into runtime paths. The checked-out Cherry Studio source remains reference material under `reference/sources/cherry-studio/`.
- Knowledge vector stores live under `.facetwrite/knowledge/<baseId>/vectors.db`; FacetWrite's main SQLite DB stores only metadata, item state, source audit, and events.
- During generation, `promptRunBuilder` performs retrieval when Agent knowledge is enabled and the `knowledge_base` tool is active. Results are injected as explicit Knowledge References and recorded as `knowledge_search_completed` tool events.
- The local `knowledge_base` tool and DeerFlow internal bridge call the same KnowledgeService search path. If search fails or no bases exist, the tool safely falls back to explicit runtime context values.

## Provider Adapter Boundary
- Provider-specific wire fields stay behind `server/providerRuntime.ts` and the provider profile capability model.
- The current provider layer is intentionally being evolved toward a Cherry Studio-style provider registry for faster MVP closure: provider metadata, docs links, base URL defaults, and model capability flags should live in one registry and feed chat, embedding, rerank, tool-use, and future multimodal settings.
- DeepSeek `reasoning_content` is runtime-only state. It may be preserved across thinking-mode tool-call turns so DeepSeek can continue a valid conversation, but it is never part of FacetWrite's public message, output version, or Canvas schemas.
- Provider-private fields are stripped for providers that do not explicitly support them, including OpenAI-compatible defaults.
- Per-run model overrides from the workspace composer are limited to safe runtime controls such as DeepSeek Think mode and reasoning effort. They do not mutate Agent settings.

## DeerFlow Runtime Boundary
- DeerFlow is now an integration foundation for Agent runtime work, not only reference source.
- FacetWrite calls DeerFlow as a Python sidecar over HTTP/SSE when `DEERFLOW_ENABLED=true`.
- The validated local sidecar path is Docker Compose through DeerFlow nginx at `http://127.0.0.1:2026`.
- FacetWrite authenticates to protected DeerFlow APIs with a backend-managed local session cookie and CSRF token; these credentials are never returned to the frontend.
- DeerFlow `lead_agent` is the default main-agent entrypoint.
- FacetWrite Task cards are mapped to DeerFlow subagent metadata with skills, tools, model inheritance, timeout, and max-turn defaults.
- FacetWrite exposes read-only DeerFlow status and config overview endpoints for UI observability.
- FacetWrite exposes an AI Dashboard that summarizes DeerFlow runtime health, auth, Skills/MCP, AgentCard-to-subagent mapping, and ToolUse bridge status.
- FacetWrite exposes `/api/internal/deerflow/tool-call` as a service-to-service ToolUse bridge for DeerFlow. The bridge accepts only trusted local/container calls, reuses `executeToolCall`, applies the Tool catalog policy guard, and keeps Canvas writes as pending requests.
- DeerFlow loads `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write` through `deerflow.tools.facetwrite_bridge`. The Docker default callback URL is `http://host.docker.internal:8787`.
- DeerFlow `web_search` remains a DeerFlow built-in tool and is not counted as a FacetWrite local bridge tool.
- FacetWrite remains responsible for product data, SQLite persistence, frontend state, Canvas approval, and local fallback behavior.
- DeerFlow runtime failures that are recoverable by the Provider runtime are visible in the Tool event timeline as `deerflow_runtime_failed` with a safe fallback summary.
- Current validation target: sidecar health, backend auth, config overview, one Task-card generation, five repeated DeerFlow generations, and both DeerFlow built-in ToolUse plus FacetWrite bridge ToolUse against the Docker sidecar.

## Storage
- `server/storage.ts` is the compatibility facade for local persistence. It preserves the public storage API used by routes and services.
- `server/db/sqlite.ts` initializes SQLite, enables WAL and foreign keys, and calls schema migration.
- `server/db/schema.ts` owns schema creation and idempotent migration checks.
- `server/repositories/*` contains focused repository boundaries introduced behind the facade. Thread listing/trash and Agent settings already delegate through repository classes; run and Canvas behavior remain facade-covered while their repository boundaries continue to mature.
- Runtime database path: `.facetwrite/data/facetwrite.db`.
- Knowledge vector path: `.facetwrite/knowledge/<baseId>/vectors.db`.
- Thread file workspace path: `.facetwrite/threads/<threadId>/user-data/`.
- Thread rows are the current project identity boundary. Project rename updates `threads.title`; AgentCard names remain type metadata and are displayed as secondary information.

## Important Current Constraints
- Canvas background drag, context-menu creation, and node resize depend on pointer events reaching the correct React Flow pane or FacetWrite node control. Any future decorative grid, empty state, alignment guide, selection marquee, or overlay should be verified with browser hit testing so it does not become an invisible interaction blocker.
- Canvas writes are never applied directly by the Agent. The Agent can only create a pending write proposal/request. The UI may ask the user to write all content or only annotated snippets, then convert that explicit confirmation into the backend approve/apply flow. Direct user commands such as "写入" or "save to canvas" are treated as explicit confirmation for the new request from that same run, not as permission to apply older pending proposals.
- DeerFlow-generated write or side-effect proposals must still be converted into FacetWrite confirmation and approval flows before data changes.
- Tool definitions, prompt hints, schemas, risk levels, and approval requirements should stay in the Tool catalog/policy layer.
- Provider details should stay behind provider runtime/profile code rather than being inferred in UI components.
