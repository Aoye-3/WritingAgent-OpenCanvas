# FacetWrite Architecture

## Plan Runtime Boundary

Agent Runtime plans and executes; FacetWrite validates phase permissions, persists PlanRun state, and commits Canvas artifacts. Planning is side-effect free except for Plan persistence. Approval authorizes creation of new nodes, image assets, and edges for that PlanRun. Replacement, append, and deletion continue through normal Canvas approval.

Execution is sequential and request-scoped: one request may operate only on its designated step. `artifact_stage` accepts only the currently running step and commits stable-id artifacts immediately. Conversation text is never treated as an Artifact, so no tool call means no automatic Canvas write.

Bridged Plan/Artifact tools append a private `__FACETWRITE_EVENT__` envelope to readable tool content. The AgentBackend adapter restores that envelope as structured SSE/tool events and accumulates assistant text by message id, returning only the final visible AI message.

## Naming
OpenCanvas is the external product name for the AI canvas workspace and should be the primary visible brand. FacetWrite remains a small technical lineage mark in the brand lockup and the internal architecture/code name, so existing modules, API routes, env vars, local data paths, and runtime boundaries intentionally keep the FacetWrite name.

## Overview
FacetWrite is a Vite/React workspace and control plane with an Express backend and local SQLite persistence. FacetWrite owns the user workspace, configuration surfaces, interaction windows, Human-in-the-loop approval, and product data boundary. Agent Runtime is the internal AI execution subsystem for Lead Agent, subagents, ToolUse, MCP, and intelligent orchestration. The current Agent Runtime implementation is the AgentBackend adapter.

Primary flow:

```text
User input
 -> AgentCard profile settings + Thread-selected Model Config
 -> PromptBuilder + Skills + Tool policy
 -> Agent Runtime as the only real generation path
 -> explicit runtime/model error when the Runtime cannot complete
 -> SQLite run records and Canvas write requests
 -> Thread state refresh in the UI
```

Mock output is available only when local development explicitly sets `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; it is not a normal runtime fallback.

Runtime ownership is intentionally split into four layers:

```text
Frontend React workspace
 -> Express API/control plane
 -> FacetWrite storage: SQLite + local files
 -> AgentRuntime sidecar only through the backend adapter
```

The frontend owns interaction state and explicit user intent. The Express backend owns policy, orchestration, output normalization, and all product-data writes. SQLite/local files are the source of truth for threads, Canvas, settings, runs, and Knowledge metadata. AgentRuntime is an execution subsystem: it receives sanitized runtime context from FacetWrite and can call back only through the internal ToolUse bridge.

## Development App Shell

`app-shell/main.mjs` is a Windows source-development control layer around the existing services. Electron owns a Splash window, the main BrowserWindow, Vite on `17776`, Express on `17777`, and any local or Docker Agent Runtime process that it starts. It does not replace the web architecture or production HTTP API.

The shell uses a single-instance lock, checks ports before startup, resolves `local`, `docker`, or `external` Runtime mode, waits for each health endpoint, and opens the main window only after readiness. The double-click `start-opencanvas-shell.vbs` entry explicitly forces `local` and `127.0.0.1:8001`; Docker mode remains an explicit command/configuration path. Local reuse requires compatible project, port, and ToolUse bridge metadata. Partial or incompatible runtimes block startup. Shutdown attempts every owned cleanup step and never stops a reused or external runtime.

Renderer windows use context isolation, disabled Node integration, and sandboxing. Vite HMR remains active for frontend source changes; Electron main-process changes require a shell restart. Docker Desktop is optional and used only for explicit Docker mode.

## Frontend
- `src/app/App.tsx` is the control-plane composition layer. It owns navigation, active Agent selection, and view wiring, while thread, generation, Canvas, and trash workflows live in focused hooks under `src/app/hooks/`.
- `App.tsx` treats Thread state as the frontend source for Plan recovery. When the current Thread has a Plan in `running`, `paused`, or `awaiting_approval`, the app performs lightweight `/state` refresh polling and stops when no active Plan remains. The Plan board reads `plans`, `planActivities`, artifacts, and current-step state from the refreshed Thread state instead of relying on repeated chat messages to express progress.
- `src/app/hooks/useThreadSession.ts` owns Project conversation listing, most-recent conversation restore, empty-Project conversation creation, visible session errors, operation ownership, and last-thread persistence.
- `src/app/hooks/useCanvasState.ts` is the Canvas state composition hook. Canvas API operation orchestration lives in `useCanvasActions.ts`, session undo ownership lives in `useCanvasHistory.ts`, live server-committed node snapshots are merged by id, and pure undo helpers live in `shared/canvasHistory.ts`.
- `src/app/hooks/useGenerationRun.ts` owns structured generation, chat generation, streaming token/status/tool-event updates, versions, collaboration messages, and direct Canvas-write intent handoff. For chat streaming it creates a temporary assistant message in the right AI collaboration drawer, fills that assistant bubble through a typewriter queue, aggregates repeated same-tool events into that message status, then reconciles with persisted thread state after the final response. Canvas and Artifact lifecycle tool events trigger a live Thread-state refresh for Canvas/Plan surfaces while text is still streaming. Final committed Canvas delivery events can apply complete local node snapshots; body checkpoint events carry only preview/hash hints and rely on Thread-state refresh for full draft content. The main Canvas layout is not a streaming transcript surface. When the user explicitly asks to write to Canvas, it auto-approves only the new pending write requests created by that run.
- `src/app/hooks/useProjectTrash.ts` owns trash, restore, and hard-delete flows.
- `src/features/settings/hooks/useProjectSettings.ts` owns provider settings state, validation/save actions, and Agent Runtime status loading. `ProjectSettingsPanel` only renders the dialog shell and composes the provider form with the read-only runtime panel.
- `src/features/agents/hooks/useAgentRuntimeConfig.ts` owns Agent runtime-config loading and settings save. `AgentSettingsView` owns gallery/filter/tab navigation, while tab UI lives in `src/features/agents/components/AgentSettingsTabs.tsx`.
- `src/features/*` groups product areas: agents, canvas, generation, home, i18n, knowledge, projects, settings, start, tasks, and workspace.
- `src/shared/ui/` is the lightweight FacetWrite UI primitive layer. It provides shared buttons, fields, chips, tabs, panels, drawers, dialogs, badges, and empty states without owning business data or backend/runtime behavior.
- `public/assets/ui/` is the local UI and image asset library. Brand asset URLs are centralized in `src/shared/brandAssets.ts` so components avoid hard-coded public paths. See `docs/UI_ASSETS.md`.
- `src/features/home/HomeView.tsx` renders the right-side Home workbench while `AppSidebar` remains the shared left navigation. Home uses the same `AIComposer` component as the workspace, plus local tabs, search/filter/sort controls, grid/list switching, and Project action menus. Submitting a Home prompt calls the app-level create-board-from-prompt flow; empty submission still creates a blank board.
- Home project cards render `ProjectSummary.canvasPreview` when the project summary includes lightweight Canvas preview data. The thumbnail renderer maps node/object geometry into the card area and falls back to the static placeholder when the Project has no preview data. Home must not fetch full Canvas state per card.
- `src/features/workspace/WorkspaceView.tsx` renders the Project-first workspace: Project title plus Project/Task Briefs in the left panel, Project-owned document Canvas in the center, and Project conversation history plus per-run Agent and Thread model selection in the right collaboration drawer.
- `src/features/workspace/components/AICollaborationDrawer.tsx` owns chat-side Canvas write proposals, temporary streaming assistant status, temporary response annotations, annotation chips, and highlighted assistant-message text. Annotation chips are shown both in the proposal panel and above the composer so the user can see the active write selection before sending "write" instructions. Annotation state is intentionally client-only and is cleared after write/cancel/page refresh.
- `src/features/workspace/components/AIComposer.tsx` is the shared composer for Home and the workspace drawer. It owns Agent selection, transient Skill overrides, tool toggles, per-message model controls, runtime budget, thinking mode, and submit payload shape. Thinking controls are rendered only when the selected model is known to support thinking through the configured model flag or `shared/modelCapabilities.ts`; capability group labels are discovery UI, not the render gate. Workspace-specific message history and proposal panels remain in `AICollaborationDrawer`; Home-specific layout and card browsing remain in `HomeView`. Composer-selected Skills are transient request context and are cleared only after a successful send.
- `AICollaborationDrawer` also owns the Plan interaction surface in the right drawer. Active Plan UI is not part of the scrolling message transcript: pending Plan clarification, approval-ready Plan boards, running Plan boards, and paused Plan boards render in a floating composer-adjacent panel above the chat composer. The panel defaults open when the active Plan or Thread changes and can collapse to a narrow local UI strip. The same Plan entry is skipped from the message timeline while it is floating, so plan approval/progress controls are not pushed upward by activity lines.
- `src/features/workspace/components/SkillFolderPicker.tsx` renders both Skill surfaces. In the right composer it is a compact per-message selector. In the bottom Canvas toolbar it becomes the three-column Skill management panel for project folders, Skill lists, and details. The panel can move only project Skills under `skills/public`; Agent Runtime Skills remain read-only.
- `src/features/workspace/components/DocumentCanvas.tsx` renders Canvas V2 through `@xyflow/react`. React Flow owns viewport pan, zoom, selection, and node dragging; FacetWrite owns node rendering, node CRUD calls, resize persistence, and Canvas write approval flows. Shared Canvas submodules under `src/features/workspace/components/canvas/` keep the node frame, node-kind renderers, edge rendering, resize/layout helpers, node constants, status/context/selection chrome, and flow-node mapping separated from the Canvas container.
- `DocumentCanvas` also owns the Markdown preview shell. When a `file_document` preview is open, the adjacent Claim review panel is a compact selectable queue, not a chat transcript: candidates use stable `摘要 N` display names, can be expanded for editing, located in the original document through source highlight, converted to compact Canvas document nodes through explicit `Create selected`, or removed through persistent `Delete selected`. Evidence text remains stored for highlight fallback and node provenance, but is not rendered as a large card block or written into visible node content.
- Canvas Workflow is layered over Canvas V2 without becoming the spatial engine. `shared/canvasWorkflow.ts` owns mode, Role-node, suggestion, and context-filtering pure helpers while keeping legacy stage compatibility centralized; `useCanvasState.ts`/`useCanvasActions.ts` own frontend state and API orchestration. `DocumentCanvas.tsx` renders the top-toolbar Canvas Mode selector, and `CanvasNodeFrame.tsx` renders function nodes and suggestions through passed data. Retired batch-stage UI and ordinary node stage badges should not be reintroduced. Workflow control features that need targeted influence should be nodeized and relationship-driven, not added as more controls on ordinary content nodes.
- `src/features/canvas/CanvasNodeSettingsView.tsx` is the left-navigation Canvas node type catalog. It explains note, document, and reference semantics without reading current project node content or mutating Canvas state.
- Canvas hit testing is intentionally split between React Flow pane interactions and FacetWrite node controls. Inputs/buttons use `nodrag`, resize controls use `nodrag nopan`, and any future overlay must be browser-verified so it does not block pane context menus, pan/zoom, node drag, node resize, or node editing. See `docs/CANVAS.md`.
- Canvas browser coverage lives in Playwright under `tests/e2e/canvas.spec.ts`; stable `data-testid` hooks are allowed for Canvas controls but should not become product behavior.
- `src/shared/MarkdownText.tsx` preserves Markdown block/inline rendering while optionally wrapping annotated text fragments in highlight marks.
- Runtime context is sourced from the Project-owned Project Brief, Thread-owned Current Task Brief, and current draft/Canvas state. Agent selection is a per-run choice recorded on `runs.agent_card_id`; model selection remains Thread state.
- The composer may attach transient Skill ids to one generation request. The backend merges them with Agent profile Skills and server-forced Plan Skills while building run context, but transient Skills are never persisted as Agent settings or Thread defaults.
- Canvas node context is kind-aware and workflow-aware: notes are excluded by default, documents contribute previews, references contribute reference content, Role nodes contribute prompts only when connected to selected/filtered content nodes, and Canvas Workflow filters narrow runtime context by selected/specified chain plus `Role -> content` edges. Legacy node stage metadata is not sent to generation and does not filter runtime context. Explicitly sent mind chains may include notes because they are user-selected context.
- `src/features/ai-dashboard/AiDashboardView.tsx` renders the AI runtime dashboard for Agent Runtime status, Skills/MCP visibility, Agent mapping, and ToolUse bridge progress.
- `src/features/knowledge/KnowledgeSettingsView.tsx` renders the local Knowledge Base management console for creating RAG bases, importing text/URL/sitemap/local-file sources, viewing indexing status, and testing retrieval.
- Agent Settings renders Agent profile controls only: Prompt, Knowledge, Tools, MCP selection, and Memory. It has no Model tab. Users can enable Knowledge, search all bases or selected base ids, tune retrieval count/threshold, and choose from already configured Agent Runtime MCP servers without adding new MCP installation/editing APIs.
- `src/shared/apiClient.ts` provides shared frontend API helpers used by feature clients.

## Backend
- `server/index.ts` starts the HTTP server.
- `server/app.ts` wires Express middleware, storage, Agent runtime, generation service, and route modules.
- `server/routes/*` defines API endpoints for health, catalog, agents, threads, projects, Canvas, settings, and generation. Routes should call domain public APIs or compatibility facades; they should not reach into domain-internal stores or fetchers.
- `server/domains/model-config/` owns provider references, configured model API bindings, local API key persistence, and remote provider model listing.
- `server/domains/canvas/` is the public Canvas domain entry for route-level Canvas operations. Canvas routes depend on this service instead of reaching directly into storage repositories.
- `server/domains/generation/` is the public domain entry for prompt/run-context building, Agent Runtime runner, provider runner, and run recording. `server/services/generationService.ts` remains a compatibility export.
- `server/domains/knowledge/` is the public domain entry for KnowledgeService creation and model binding resolution for embedding/rerank credentials.
- `server/domains/claim-review/` owns Markdown Claim extraction, source validation, candidate updates, persistent deletion, and legacy accepted-Claim node creation. Legacy node creation follows the same compact `摘要 N` title and claim-only visible body policy as the current frontend path. Routes call this domain instead of reaching into `claim_candidates` directly.
- `server/services/*` now contains compatibility exports plus legacy service facades. New code should prefer `server/domains/*/index.ts` where a domain exists.
- `server/knowledge/*` contains the server-owned Knowledge Base runtime. It wraps the Cherry Studio embedjs/libSQL dependency stack behind FacetWrite APIs and keeps vector data under `.facetwrite/knowledge/`.
- `server/runtime/agentRuntimePort.ts` defines the stable FacetWrite execution-runtime boundary. `server/runtime/agentBackendAdapter/*` contains the current AgentBackend implementation: backend-only auth session handling, SSE parsing, runtime status, read-only config proxy, AgentCard-to-subagent mapping, and token/status forwarding for `/api/generate/stream`. `server/agentBackend/*` remains a short-term compatibility re-export layer.
- `server/skillLoader.ts` owns public Skill discovery and project Skill folder mutations. It recursively scans project and Agent Runtime public Skill roots, derives folder metadata, and keeps project folder writes inside `skills/public`.
- `server/providerRuntime.ts` normalizes provider request behavior for supported provider IDs, including Chat Completions streaming behind the provider profile boundary.
- `server/agentRunLoop.ts` runs Chat Completions, executes returned tool calls, records tool events, streams final assistant tokens when available, and stops when final content or `maxToolCalls` is reached.

## Agent And Tool Layers
- `server/agentCards.ts` is a compatibility export for the Agent modules under `server/agents/`.
- `server/agents/types.ts` defines AgentCard and AgentSettings types.
- `server/agents/cards/builtInCards.ts` defines built-in Agent cards and localized field metadata.
- `server/agents/prompts.ts` stores built-in identity prompts.
- `server/agents/defaultSettings.ts` defines default prompt, tool, knowledge, memory, quick-message, and MCP-ref settings. Model runtime settings are conversation/runtime settings, not Agent settings.
- `server/agents/loader.ts` exposes built-in cards and applies saved settings to cards.
- `server/agentRuntimeAdapter.ts` resolves Agent cards, merged settings, runtime config, tool policies, and available skills/tools.
- `server/tools/catalog.ts` is the Tool metadata source of truth.
- `server/tools/policies.ts` derives whether each tool is enabled, auto-runnable, externally configured, or approval-gated.
- `server/tools/toolPolicyGuard.ts` performs runtime checks before a tool call can execute.
- `server/toolRuntime.ts` executes local ToolUse behavior and creates Canvas write requests when `canvas_write` is called. If a model asks for `replace` without an explicit user replace/overwrite instruction, the runtime normalizes the operation to `append` for a selected node or `create` otherwise.
- Canvas directed edges are FacetWrite-owned project data stored in `canvas_edges`. They are used to assemble user-triggered mind chains for the right collaboration composer and are not a model-write bypass.
- Canvas Workflow state is FacetWrite-owned project data stored in `canvas_workflows`, Role nodes in `canvas_nodes`, Role relationships in `canvas_edges`, and `canvas_workflow_suggestions`. `canvas_workflows.stage/stages` and any historical `canvas_nodes.metadata.workflow.stage` values are compatibility data only. Canvas Mode is the user-facing strategy layer over that state; Agent Runtime receives only the mode/Role-filtered context prepared by FacetWrite and can create suggestions or pending write requests only through FacetWrite API/tool paths.

## Agent Output Boundary
- Agent run reporting is projected as `final`, `stage`, and `raw`. `final` is the persisted assistant answer and deliverable summary. `stage` is the public run narration shown in the right conversation run block through `progress_event` / `progressSegments`; it contains semantic milestones and intervention hints only. `raw` is the diagnostic layer behind Run Trace/tool-log expansion and contains tool calls, model lifecycle, commands, safe-point bookkeeping, stdout/stderr, and debug metadata.
- Runtime custom events `agent_progress_reported` and `agent_intervention_checkpoint` carry a `visibility` value. `visibility:"stage"` may become a user-facing stage report after the whitelist filter; `visibility:"raw"` updates active run/intervention metadata and raw logs but must not create a main progress paragraph. The Node generation service can aggregate raw runtime/tool/Canvas events into a stage fallback such as evidence collection, Canvas update, delivery, or finalization, but individual tool start/end events are not stage reports. Runtime event field rules are documented in `modules/agent-runtime/backend/docs/FACETWRITE_PROGRESS.md`.
- Runtime streams may feed temporary UI-only assistant messages, but they are never treated as persisted truth. AgentBackend/provider output must pass through the Agent output normalizer before it is recorded as an assistant message or output version.
- The normalizer separates user-visible assistant text from tool/internal events. System prompts, AgentCard prompt blocks, ToolUse JSON, search result JSON, reasoning payloads, and AgentBackend replay values are blocked from chat/output surfaces and recorded only as redacted runtime events.
- `web_search` has an application-level citation invariant. Search tool results are reduced to sanitized `{ title, url }` sources; final assistant text must include clickable source URLs, or FacetWrite appends them before persistence. If no usable URL exists, the search answer is blocked rather than saved without sources.
- `/api/generate/stream` uses a server-side progressive text gate before releasing text so obvious internal prompt, ToolUse, search JSON, and reasoning payload leaks are not streamed into the UI. After the initial safety buffer, the gate emits small user-visible UI chunks instead of large paragraph-sized blocks; long flush/final remainders are also split before they reach the browser.
- Batch-delivery long tasks use server-owned progressive Canvas delivery. The server starts stable `整体概述` / `Overview` and `正文` / `Body` nodes, commits sanitized progress/reference nodes from completed evidence-tool events, and updates the same `正文` / `Body` node with a working body checkpoint. These Canvas updates are recoverable work products; they do not make a failed runtime run successful.
- Safe `timeline_event` summaries may be streamed into the current assistant Run Trace. Run Trace is a public execution-narration layer, not hidden chain-of-thought: it may summarize intent, milestones, tool phases, and user-relevant decisions, but it must not expose provider reasoning, prompts, raw tool JSON, replayed messages, or internal context. Composer-selected Skill usage is represented only as a sanitized `decision` event naming Skill ids; Skill bodies, prompts, messages, raw tool JSON, and internal context must not appear in the event.
- The frontend treats streamed chunks as input to a UI-only typewriter queue. In chat mode the visible queue target is the assistant bubble in `AICollaborationDrawer`; `final` remains authoritative for persistence, but the UI waits for that typewriter queue to drain and only corrects visible text if the final recorded output differs from the streamed text.
- If AgentBackend returns an empty answer, fails, or returns only blocked internal/runtime output, FacetWrite records `agent_backend_runtime_failed` and returns a stable runtime error. It does not call a local Provider runtime or persist a Mock answer by default.
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
- The Model Config page is a first-level workspace view. It shows the complete provider model catalog separately from the local API model list. The catalog is for discovery; the local list is the set of bindings that conversations and Knowledge Bases may call.
- Dynamic model listing is backend-owned under `server/domains/model-config/model-list/`: `service.ts` handles fallback flow, `fetchers.ts` holds provider-specific remote strategies, and `utils.ts` owns response parsing and redaction helpers. `server/services/modelListService.ts` is only a compatibility export.
- Dynamic model listing remains a provider catalog operation: request draft key/base URL first, saved binding for that provider second, registry defaults for non-secret fields last. It must not borrow a key from another provider.
- Generation resolves the Thread's explicitly selected backend Model Config at request time. There is no default, Agent-owned, environment, Provider-runner, or test compatibility model fallback.
- Knowledge Bases resolve `embeddingConfigId` and `rerankConfigId` through the same configured model API store, so embedding/rerank credentials are not read from unrelated Agent provider settings.
- DeepSeek `reasoning_content` is runtime-only state. It may be preserved across thinking-mode tool-call turns so DeepSeek can continue a valid conversation, but it is never part of FacetWrite's public message, output version, or Canvas schemas.
- Provider-private fields are stripped for providers that do not explicitly support them, including OpenAI-compatible defaults.
- Per-run model overrides from the workspace composer are limited to safe runtime controls such as DeepSeek Think mode and reasoning effort. They do not mutate Agent settings.

## Agent Runtime Boundary
- Agent Runtime is now a FacetWrite internal subsystem, not reference source. Its source lives under `modules/agent-runtime/`.
- FacetWrite calls the current AgentBackend adapter as an independent Python sidecar over HTTP/SSE when `AGENT_BACKEND_ENABLED=true`.
- The recommended local path is the project-managed Python Gateway at `http://127.0.0.1:8001`; Docker Compose through nginx at `http://127.0.0.1:2026` is an explicit isolation and deployment mode.
- Progressive long-task Canvas delivery is server-owned but does not remove `canvas_write`. Instead, the runtime receives `facetwrite_canvas_write_scope:"short_progress_nodes"` so `canvas_write` can create short summaries, overviews, progress/reference notes, and references while rejecting long bodies, full reports, destructive operations, and `file_document` creation. Full Markdown deliverables must use `write_file` plus `present_files`; the server then creates or updates the compact `file_document` preview node.
- Agent Runtime clarification is stateful but not terminal by itself. `agent_backend_agent_clarification_requested` records a waiting state only when no later substantive progress exists; later evidence tools, file tools, or committed Canvas delivery events clear the waiting interpretation and allow the run to complete.
- Streaming and non-streaming generation must pass the complete Runtime event set into progressive finalization, Plan postcondition checks, and Plan completion. Postconditions must run after final Body or `file_document` delivery events are known, not on an early stream payload that lacks delivery events.
- Progressive checkpoints use a separate `正文草稿` / `Body draft` node. The final `正文` / `Body` node is reserved for synthesized deliverable content and must not be used as a working checkpoint target.
- Runtime enablement is controlled only by `AGENT_BACKEND_*` variables. Historical `DEERFLOW_*` variables are migration artifacts and must not be used for active FacetWrite configuration.
- The local dev compose project is `facetwrite-agent-runtime` and container names use `facetwrite-agent-runtime-*`. The FacetWrite acceptance compose keeps host Docker socket and local CLI credential directories out of the gateway container by default; those mounts should only be reintroduced for isolated sandbox/CLI-auth experiments.
- FacetWrite authenticates to protected AgentBackend APIs with a backend-managed local session cookie and CSRF token; these credentials are never returned to the frontend.
- AgentBackend `lead_agent` is the default main-agent entrypoint.
- The neutral `ChatAgent` profile is mapped to AgentBackend subagent metadata with skills, tools, model inheritance, timeout, and max-turn defaults. Historical Task-card ids resolve to `ChatAgent` before mapping.
- FacetWrite exposes Agent Runtime status, config overview, dashboard, and FacetWrite-managed Memory endpoints at `/api/agent-runtime/*`, with `/api/agent-backend/*` kept as compatibility aliases where applicable.
- FacetWrite exposes an AI Dashboard that summarizes Agent Runtime health, auth, Skills/MCP, AgentCard-to-subagent mapping, ToolUse bridge status, and editable FacetWrite-managed Memory.
- FacetWrite exposes `/api/internal/agent-runtime/tool-call` as the only service-to-service ToolUse bridge. Every request requires `FACETWRITE_INTERNAL_TOOL_TOKEN`; source headers are metadata only. The bridge reuses `executeToolCall` and applies the Tool catalog policy guard.
- AgentBackend loads FacetWrite bridge tools through `deerflow.tools.facetwrite_bridge` as configured in `modules/agent-runtime/config.yaml`. The active bridge tool set is `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`; `quick_messages` is not an active tool. `server/agentRuntimeConfig.test.ts` loads both `config.yaml` and `config.example.yaml` and verifies that every `tools[*].use` target resolves to an exported LangChain tool, so stale config references fail before runtime startup.
- The Docker default callback URL is `http://host.docker.internal:8837`; local App Shell mode uses the configured `FACETWRITE_INTERNAL_BASE_URL`, normally `http://127.0.0.1:17777`.
- AgentBackend `web_search` remains a AgentBackend built-in tool and is not counted as a FacetWrite local bridge tool.
- Long-task run budgets are explicit request controls. The workspace composer sends `runtimeBudgetProfile` (`low`, `medium`, or `high`, default `low`), the TypeScript generation service maps that profile to `facetwrite_recursion_limit`, `facetwrite_model_call_limit`, `facetwrite_evidence_tool_limit`, `facetwrite_body_draft_write_limit`, and `facetwrite_synthesis_reserve_steps`, and the AgentBackend adapter forwards both `config.recursion_limit` and matching runtime context fields. Current defaults are low `8/2/18/80/16`, medium `12/3/24/110/22`, and high `16/4/32/140/28`. The Python middleware must remove evidence tools and inject a final-synthesis reminder before the graph reaches the LangGraph recursion clamp; the budget system is not a simple higher `recursion_limit`.
- AgentBackend global memory is not injected or updated for FacetWrite runs by default. Per-run context carries `facetwrite_memory_enabled`; when enabled, only FacetWrite-managed Memory content is injected.
- FacetWrite remains responsible for product data, SQLite persistence, frontend state, Canvas approval, and local fallback behavior.
- AgentBackend runtime failures are visible in the Tool event timeline as `agent_backend_runtime_failed` with a redacted diagnostic summary. They are not recovered by the TypeScript Provider runtime, Mock output, or fake Canvas delivery unless an explicit local development fallback flag says otherwise.
- Current validation target: sidecar health, backend auth, config overview, one Task-card generation, five repeated AgentBackend generations, and both AgentBackend built-in ToolUse plus FacetWrite bridge ToolUse against the Docker sidecar. The latest 2026-05-20 smoke test confirmed `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"`.

## Storage
- `server/storage.ts` is the compatibility facade for local persistence. It preserves the public storage API used by routes and services while delegating focused behavior to repository and path modules.
- `server/db/sqlite.ts` initializes SQLite, enables WAL and foreign keys, and calls schema migration.
- `server/db/schema.ts` owns schema creation and idempotent migration checks.
- `server/storageTypes.ts` owns shared storage and Canvas record shapes so repositories can depend on data contracts without importing the storage facade.
- `server/storagePaths.ts` owns local app-root resolution and workspace directory creation. `FACETWRITE_APP_ROOT` can point tests or e2e runs at an isolated local workspace.
- `server/repositories/*` contains focused repository boundaries introduced behind the facade. Thread listing/trash, Agent settings, Run/message/output/tool-event persistence, Knowledge metadata, and Canvas persistence delegate through repository classes; `server/storage.ts` remains the compatibility facade used by routes and services.
- Runtime database path: `.facetwrite/data/facetwrite.db`.
- Knowledge vector path: `.facetwrite/knowledge/<baseId>/vectors.db`.
- Thread file workspace path: `.facetwrite/threads/<threadId>/user-data/`.
- Markdown output previews are Thread-file reads, not Project-file reads. Project-level `file_document` Canvas nodes must carry `metadata.fileDocument.threadId` so the frontend calls the preview route for the Thread that generated the archived `/mnt/user-data/outputs/*.md` file; legacy generated nodes may recover the source Thread from `deliveryId`.
- Project rows are the workspace, Canvas, shared-context, and model-binding boundary. Threads own conversation history and one explicit Model Config selection. Agents are selected per run and own no project context.
- Canvas undo depth is stored in the generic `settings` table under the `canvas` key. The undo stack itself is browser-session state and is not persisted.
- Canvas Workflow stores one project-level mode and Role library per thread in `canvas_workflows`. Legacy `stage/stages` columns remain readable for compatibility but are no longer the delivery or context strategy. New content nodes do not receive `canvas_nodes.metadata.workflow.stage`, and generation context does not include node stage. Role behavior lives in `role` Canvas nodes plus directed `Role -> content` edges; legacy `metadata.workflow.roles` is migrated away. Role suggestions live in `canvas_workflow_suggestions` with both `roleNodeId` and `targetNodeId`.
- Claim Review candidates live in `claim_candidates` behind `ClaimReviewRepository`. `evidence_text` is source fallback data for locating/highlighting the original document, not default Canvas body content. Deleting a candidate is a persistent row deletion and deliberately does not cascade into `canvas_nodes`; once a Claim has been converted into a node, the node is user workspace data with its own lifecycle.

## Domain Dependency Rules
- `routes -> domains -> repositories/shared/config/security/utils`.
- Canvas routes must call the Canvas domain service. Agent Runtime bridges and adapters must not import Canvas repositories directly; Agent-originated Canvas changes go through Tool policy and pending write requests.
- `Agent` and `Knowledge` may use `model-config` public resolvers; `model-config` must not depend on Agent, Knowledge, Generation, or UI modules.
- Frontend feature clients own their feature API calls. `src/features/model-config/modelConfigClient.ts` owns provider catalog and configured model API requests; `src/features/settings/settingsClient.ts` owns settings status and validation/save compatibility; runtime status/config calls use `/api/agent-runtime/*`.
- Compatibility files are allowed only to preserve old imports during branch convergence. New code should import from domain public `index.ts` files or feature-local clients.

## Test Boundaries
- Server, shared pure helpers, lightweight frontend pure-state tests, and architecture boundary checks are covered by `npm.cmd test`.
- Shared composer controls are covered against the real `AIComposer` component. Tests should render or inspect `AIComposer` directly for thinking-mode, model, Skill, Plan, and send/stop behavior; obsolete form remnants in `AICollaborationDrawer` are not an acceptable proxy for the current Home or Workspace composer UI.
- Agent Knowledge readiness is covered by deterministic server tests: generation facade tests prove unique Knowledge facts reach provider messages as `Knowledge References`, and Tool Runtime tests prove the `knowledge_base` bridge prefers RAG results and forwards selected base ids.
- Architecture guard tests check that frontend files do not import server modules, Agent Runtime code does not import Canvas persistence directly, Canvas routes go through the Canvas domain service, and generated QA artifacts stay ignored.
- Frontend Canvas interaction coverage is Playwright-based. `npm.cmd run test:e2e:canvas` runs `tests/e2e/canvas.spec.ts` against the local Vite/Express dev server and verifies node type creation, session undo, blur persistence, kind conversion preservation, directed edge creation/deletion, and explicit mind-chain drafting.
- Playwright tests may use stable `data-testid` hooks for interaction targets, but those hooks are test infrastructure only and must not carry product state or business rules.

## Canvas Visual Object Boundary

Canvas has three intentionally separate persisted concepts:

- `canvas_nodes`: writing and workflow content rendered by React Flow.
- `canvas_edges`: semantic directed relationships used by mind chains and Role influence.
- `canvas_objects`: non-semantic arrows, shapes, tables, and assets.

`shared/canvasObjects.ts` is the single contract for visual-object kinds, geometry, type-specific data, default drafts, strict write validation, and compatible reads. New writes are validated by kind before persistence. Existing local rows are normalized on read so missing legacy fields receive safe defaults and an unknown object becomes a safe rectangle placeholder instead of breaking the board.

The frontend keeps orchestration in `DocumentCanvas`, tool overlays and file input behavior in `CanvasToolOverlays`, and type-specific table/asset content in `CanvasObjectContent`. Adding an object kind must extend the shared discriminated union first, which makes unhandled frontend and backend branches visible to TypeScript.

## Important Current Constraints
- Canvas background drag, context-menu creation, and node resize depend on pointer events reaching the correct React Flow pane or FacetWrite node control. Any future decorative grid, empty state, alignment guide, selection marquee, or overlay should be verified with browser hit testing so it does not become an invisible interaction blocker.
- Canvas create and append operations are low-risk direct commits with stable IDs and authoritative results. Replace, range replacement, delete, and other destructive mutations remain approval-gated. Ordinary assistant text is never written automatically.
- Agent Runtime-generated write or side-effect proposals must still be converted into FacetWrite confirmation and approval flows before data changes. AgentRuntime does not read or write Canvas storage directly; it receives frontend-filtered context through the backend generation request and can affect Canvas only through the internal ToolUse bridge.
- AgentBackend connection failures should be debugged from the actual chain: FacetWrite `/api/generate/stream` -> AgentBackend adapter `/api/runs/stream` -> AgentBackend config/tool resolution -> FacetWrite internal ToolUse bridge callbacks. HTTP 200 from `/api/runs/stream` only proves the sidecar was reached; a Lead Agent startup failure caused by an unresolvable `tools[*].use` target is still a runtime failure and must not be hidden by Mock or Canvas fallback output.
- Tool definitions, prompt hints, schemas, risk levels, and approval requirements should stay in the Tool catalog/policy layer.
- Provider details should stay behind provider runtime/profile code rather than being inferred in UI components.
# Project-First Runtime Boundary (2026-06-11)

FacetWrite uses `Project` as the only workspace and shared-context boundary.

- A Project owns one Project Brief, Canvas resources, project summary, model bindings, and shared outputs.
- A Thread belongs to one Project and owns its Current Task Brief, conversation messages, runs, and current explicit Model Config selection.
- An Agent is selected per run. Agent definitions contain capabilities, prompts, Skills, tools, Knowledge, Memory, and MCP refs; they do not own Briefs or model configuration.
- New Projects and Threads start with empty Briefs. Runs automatically receive the current Project Brief and Current Task Brief plus the current Thread history, never another Project's context.
- AgentBackend receives the real `facetwrite_project_id` and current `thread_id`; the former `local-project` scope is forbidden.

Canvas database columns and public Canvas records use `project_id`/`projectId`. Thread-scoped Canvas routes explicitly resolve the Thread's Project before calling the Project-owned Canvas domain.

Model selection and context assembly are hidden runtime policies. Threads select directly from valid stored chat Model Configs and persist inherited defaults. Historical Project model bindings and context-inclusion flags remain readable compatibility data but are not current UI gates.

Generation context is bounded to Project Brief, Current Task Brief, explicit mind chains/selections, the selected node and directed related nodes, Workflow/Role state, current draft, messages after `context_reset_at`, and Knowledge results. Ordinary notes and the rest of an unselected Canvas are excluded. Frontend generation and Thread restoration use operation ownership checks so stale asynchronous results cannot apply after a Project or Thread switch.

Agent Runtime is the sole real generation path. Default failures return stable model/runtime errors, emit redacted failure events, and do not persist Mock messages or output versions.

## Structured Plan Lifecycle

New `/plan` requests force-load the project-local `brainstorming` skill and expose only `plan_clarification_submit`. After the structured clarification is answered, `writing-plans` exposes only `plan_revision_submit` for the same Plan ID. `PlanOrchestrator` owns step status, failure-to-pause behavior, and persistent safe activities; `PlanExecutor` owns lease-backed sequential execution and restart recovery. Skill usage and execution progress are projected into the compact conversation activity timeline. Models never own Plan lifecycle status.
