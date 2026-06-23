# FacetWrite Technical Decisions

## 2026-06-23: Agent Runtime Clarifications Use Composer State

Decision: Treat Agent Runtime `ask_clarification` as pending conversation input, not Canvas delivery. The AgentBackend adapter emits `agent_backend_agent_clarification_requested`, the run timeline mirrors it as `status:"waiting"`, and the right composer renders the existing choice-card UI from that structured timeline payload.

Reason: Blocking clarification asks the user for missing information before work can continue. Writing that prompt as a Canvas node made process UI look like deliverable content and could leave the Agent apparently stopped without an actionable composer choice.

Impact: Structured Agent clarification events must not create `kind:"clarification"` Canvas nodes or `canvas_delivery_clarification_committed` events. The frontend tracks answered Agent clarifications by `clarificationId` / `toolCallId` and continues the run with `requestContext.agentClarification`. The existing Canvas `clarification` node kind remains renderable for historical/manual nodes only.

## 2026-06-23: Progressive Body Drafts Use Separate Canvas Nodes

Decision: Progressive long-task checkpoints update a stable `正文草稿` / `Body draft` document node instead of reusing the final `正文` / `Body` node. Final synthesis writes to the separate final Body node only when a real deliverable is available. `canvas_delivery_body_checkpoint_committed` carries draft-node live hints, not full node content.

Reason: The timeline can show `正文草稿 N` while the Canvas node title and content remain `正文`, which makes users think no draft node exists or that the final Body node is stale. Separating draft and final nodes makes recoverable work visible without blurring it with final deliverables.

Impact: Debugging progressive delivery should inspect the stable Body draft node for intermediate checkpoints and the final Body node for completed output. `bodyDraftWriteLimit` is a hard cap on checkpoint writes; research/progress nodes can continue until the evidence budget triggers final synthesis. Frontend refresh logic treats checkpoint payloads as `nodeId`/`contentPreview`/`contentHash` hints and reconciles full content through thread state refresh.

## 2026-06-23: Long Markdown Deliverables Use File Document Nodes

Decision: Represent long Markdown outputs from Agent Runtime as `file_document` Canvas nodes backed by `/mnt/user-data/outputs/*.md`, rather than storing the full Markdown in ordinary `document` node content. `write_file` and `present_files` events create or update one stable node per virtual path, and the frontend opens the full content through a read-only Markdown preview API.

Reason: Research and review tasks can produce long reports that make the Canvas crowded, expensive to include in follow-up context, and hard to scan. The Canvas should preserve the collaboration structure: overview, progress/source notes, final answer summary, references, and a compact document entry point.

Impact: `file_document` is a separate node kind, not a `document` renderer variant. It stores only short file metadata and defaults to `includeInProjectContext:false`. The preview endpoint accepts only current-thread output Markdown paths, rejects traversal and non-Markdown files, and limits read size. Medium/long tasks with two or more web-search rounds or complex long-form Skills should prefer `write_file` plus `present_files`; if Runtime omits file delivery, Node finalization writes a fallback Markdown file and creates the same document entry. Lightweight Canvas output continues to use ordinary `document` nodes.

## 2026-06-23: Progressive References Prefer Authored Document Links

Decision: Progressive Canvas finalization collects sources from final Canvas content, committed `canvas_write` content, and tool events, then prefers authored Markdown links from the final document before broad `web_search` result links.

Reason: Long research tasks may perform several web searches, but the useful bibliography is often assembled in the final Markdown report. Filling the `References` node from the first search page hides the curated arXiv/DOI links the user expects to see.

Impact: `canvas_mutation_committed` preserves extracted content sources, and final progressive delivery creates or refreshes a dedicated reference node when sources exist. Search progress nodes can still show intermediate search results, but the final reference node should prioritize the authored bibliography.

## 2026-06-23: Task Handling Policy Gates Canvas Delivery

Decision: Add a server-owned `TaskHandlingPolicy` before Agent Runtime context is sent. The policy classifies each request as `simple_chat`, `plan_intake`, `long_task`, `explicit_canvas`, or `plan_execution`, and only Canvas-eligible classes may create or update Canvas nodes. Skills and thinking mode are complexity signals, not standalone authorization for Canvas writes.

Reason: Skill-assisted Plan intake could return process text such as "I need to confirm a few key points" and the progressive Canvas finalizer treated it as deliverable body content. Short Q&A also should remain ordinary conversation even if runtime controls are enabled.

Impact: `simple_chat` and `plan_intake` are conversation-only. `long_task` and `plan_execution` can use progressive Canvas delivery, while `explicit_canvas` keeps the direct delivery planner. Final Canvas writeback rejects process clarification text and internal Runtime protocol output, preserving safe progress nodes on failure without pretending the run succeeded.

## 2026-06-21: Long Agent Runs Use Explicit Runtime Budgets And Body Checkpoints

Decision: Add a per-request `runtimeBudgetProfile` (`low`, `medium`, `high`, default `medium`) and keep long-task Canvas progress server-owned. The profile maps to LangGraph recursion limit, model-call budget, evidence-tool budget, and synthesis reserve steps. During batch-delivery runs the server updates a stable `正文草稿` / `Body draft` node with working checkpoints as evidence arrives, then writes final content to the separate `正文` / `Body` node only when the runtime succeeds.

Reason: Increasing LangGraph `recursion_limit` alone hides the symptom but does not force the Agent to stop searching and write. The observed failure mode was a long tool loop that produced many reference nodes, then hit `GRAPH_RECURSION_LIMIT` before final synthesis, leaving `正文` empty. Users need visible control over run depth and recoverable body progress even when the final Agent run fails.

Impact: The composer exposes `低 / 中 / 高` as a compact run-budget control independent of thinking mode. The AgentBackend adapter forwards both `config.recursion_limit` and `facetwrite_*` budget context. Python middleware removes evidence tools and injects a final-synthesis instruction near the budget boundary. `canvas_delivery_body_checkpoint_committed` is a live Canvas-refresh event with a committed draft-node snapshot, not a success condition; runs with only progress/checkpoint events still fail if no final assistant text or final structured lifecycle outcome exists.

## 2026-06-21: Project Skill Folders Are Managed Through The Catalog API

Decision: Keep Skill folder management inside the existing Skill catalog surface. The bottom Canvas Skills panel can create, rename, delete empty project folders, move project Skills, and show details, while the right composer remains a compact per-message enable/disable selector.

Reason: Users need organization and one-message Skill control without turning Agent settings into a filesystem editor. Project Skills are local workspace assets, but Agent Runtime Skills belong to the runtime package and should not be mutated from the product UI.

Impact: `server/skillLoader.ts` is the only filesystem write boundary for project Skill folders. Management APIs always return a refreshed `{ skills, folders }` catalog, folder ids are restricted to lowercase letters, numbers, and dashes, `default` is protected, Runtime Skills are read-only, and Skill bodies remain private runtime context.

## 2026-06-06: Visual Board Objects Stay Separate From Semantic Nodes And Edges

Decision: Store free arrows, shapes, lightweight tables, and local asset cards in `canvas_objects`, while preserving `canvas_nodes` for writing/workflow nodes and `canvas_edges` for mind-chain and Role relationships.

Reason: FigJam-style visual annotations must not silently affect Agent context, Role influence, or directed mind-chain ordering.

Impact: The floating toolbar can create saved visual objects, but Agent selection actions remain proposal-oriented and Agent-originated content writes continue through the existing approval boundary.

## 2026-06-15: Canvas Mode Is The User-Facing Workflow Layer
Decision: Add `CanvasWorkflowMode` and expose `batch_delivery` as the first Canvas Mode. The existing writing stage remains as mode-specific batch-step state instead of the primary workspace concept.

Reason: The product centers on text nodes, batch delivery, and the canvas. Presenting inspiration/research/writing as the top-level control made the workspace look like a linear writing-stage product, while the stage data is still valuable for context filtering and node inheritance.

Impact: `canvas_workflows` stores `mode` with a default of `batch_delivery`. Existing `stage`, node `metadata.workflow.stage`, Role nodes, Role edges, suggestions, and context filtering remain compatible. Future modes can add their own behavior without deleting the current batch-delivery stage contract.

## 2026-06-15: AgentBackend Bridge Config Must Match FacetWrite Tools
Decision: Treat AgentBackend bridge tool configuration as a tested FacetWrite connection contract. The active bridge set is `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`; stale `quick_messages` references are invalid.

Reason: A FacetWrite request reached AgentBackend `/api/runs/stream` successfully, but Lead Agent startup failed when AgentBackend tried to load an obsolete `deerflow.tools.facetwrite_bridge:quick_messages_tool` target. The UI symptom looked like "AgentBackend empty response", while the actual failure was tool configuration drift between Agent Runtime YAML, the Python bridge module, and FacetWrite `ToolRef` contracts.

Impact: `modules/agent-runtime/config.yaml` and `config.example.yaml` must stay aligned with `facetwrite_bridge.py`, `server/tools/catalog.ts`, and frontend tool types. `server/agentRuntimeConfig.test.ts` loads both YAML files and verifies every configured `tools[*].use` target resolves to a real exported LangChain tool. Runtime/model failures remain visible failures and must not be converted into fake Canvas delivery nodes or Mock assistant output.

## 2026-05-30: Canvas Role Controls Are Function Nodes
Decision: Model Canvas Workflow Roles as first-class `role` Canvas nodes that apply only through directed `Role -> content` edges. Stage remains a single project/thread state and does not become a normal duplicable node.

Reason: Role is an influence relationship, not another property to pile onto every document, note, and reference node. Keeping Role as a function node preserves Canvas spatial reuse, drag/resize/delete/undo behavior, and prevents ordinary content nodes from becoming large containers for workflow controls.

Impact: Role data lives in `canvas_nodes.metadata.workflowRole`; Role effect is computed from `canvas_edges`; suggestions are anchored to the Role node while retaining `targetNodeId`; Agent context filtering reads connected Role prompts only after chain and stage filtering. New Workflow control capabilities should follow the same nodeized/relationship-driven bias when they need targeted influence, rather than adding more controls to content-node UI. Legacy `metadata.workflow.roles` is migrated into Role nodes and edges, then removed from content node metadata while preserving node stage.

## 2026-05-28: Canvas Workflow Is A Separate Layer Over Canvas V2
Decision: Add Canvas Workflow as a project-level writing-stage, node-stage, Role, and suggestion layer over the existing Canvas V2 spatial model, without adding new node kinds in v1.

Reason: The Canvas needs writing-process awareness so Agents can work on the relevant chain, stage, and Role perspective without reading the entire board. Keeping Workflow separate from React Flow spatial behavior prevents the Canvas UI, Agent orchestration, and suggestion lifecycle from becoming one tangled module.

Impact: Project stage and Role library live in `canvas_workflows`, node stage/Role membership lives in `canvas_nodes.metadata.workflow`, and suggestions live in `canvas_workflow_suggestions`. Pure vocabulary and filters live in `shared/canvasWorkflow.ts`. Agent runtime context must be filtered by selected/specified chain, workflow stage, and Role ids before execution; destructive writes still use the existing approval boundary.

Update 2026-05-30: Role membership moved out of ordinary content-node metadata. Role is now a first-class `role` Canvas node and applies through directed `Role -> content` edges only. Content nodes keep stage metadata; legacy Role arrays are migration input, not the new source of truth.

## 2026-05-20: AgentBackend Is An Internal Agent Runtime Module
Decision: Treat AgentBackend as the current implementation of FacetWrite's internal Agent Runtime subsystem. Its source is tracked under `modules/agent-runtime/`, while the FacetWrite backend talks to it through `server/runtime/agentRuntimePort.ts` and the `server/runtime/agentBackendAdapter/` implementation.

Reason: AgentBackend had already been tracked in the main repository and was no longer just reference material. Making it an explicit internal module preserves the useful runtime capability while preventing frontend, generation, storage, and documentation from depending on its historical top-level path or implementation details.

Impact: New code should use `/api/agent-runtime/*`, `npm run agent-runtime:*`, and the runtime port. `/api/agent-backend/*`, `npm run agent-backend:*`, and `server/agentBackend/*` remain compatibility aliases during migration. The Python/LangGraph runtime remains an independent process/container; it is not merged into the Node/Express service process.

## 2026-05-20: AgentBackend Rename Requires New Runtime Env Keys
Decision: Treat `AGENT_BACKEND_*` as the only active FacetWrite runtime configuration namespace after the AgentBackend rename.

Reason: Keeping `DEERFLOW_*` as live aliases would blur the boundary between FacetWrite-owned AgentBackend runtime code and the upstream/reference project identity. During live testing, stale `DEERFLOW_*` entries caused `/api/agent-backend/status` to report `enabled:false` and the UI to fall back to Mock output.

Impact: Local `.env.local` must use `AGENT_BACKEND_ENABLED`, `AGENT_BACKEND_BASE_URL`, `AGENT_BACKEND_ASSISTANT_ID`, and AgentBackend auth keys. After changing these values, restart the FacetWrite API process so dotenv reloads. Historical references may still mention DeerFlow only as upstream source context.

## 2026-05-20: AgentBackend Dev Compose Uses A Safe Acceptance Profile
Decision: Run the local AgentBackend acceptance sidecar with `agent-backend-*` container names, Docker-managed networking, and no default host Docker socket or local CLI credential mounts.

Reason: The original upstream compose shape can expose broad host control and local credential directories. FacetWrite's default local validation only needs nginx, frontend, gateway, auth, and run streaming, so the acceptance profile should reduce local blast radius.

Impact: `npm run agent-runtime:up/status/down` injects `AGENT_RUNTIME_ROOT` and manages the `facetwrite-agent-runtime` compose project. The historical `agent-backend:*` commands remain aliases. Sandbox execution or CLI auto-auth experiments must explicitly reintroduce sensitive mounts in an isolated environment. The 2026-05-20 smoke test confirmed `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"` with this profile.

## 2026-05-18: Right-side AI Chat Uses Real Streaming Preview
Decision: The collaboration drawer uses `/api/generate/stream` as a real streaming channel for AI chat replies, with transient status events and temporary assistant messages reconciled against persisted thread state after `final`.

Reason: Waiting for the complete model result creates a visible empty period. A temporary assistant avatar/status plus token/typewriter output gives users immediate feedback while keeping SQLite messages, Canvas write requests, and output versions behind the existing normalization and approval boundaries.

Impact: Provider and AgentBackend runtimes may forward assistant token/message deltas through SSE, but final recorded text still passes through `normalizeAgentRunOutput`. Obvious internal prompt or ToolUse payload leaks are buffered/blocked before initial streaming. This does not change Canvas write approval semantics.

## 2026-05-18: FacetWrite Uses A Lightweight In-Repo UI Primitive Layer
Decision: Build shared frontend primitives in `src/shared/ui/` instead of introducing AntD, MUI, Mantine, shadcn, or another large component library.

Reason: FacetWrite already has a product-specific workspace visual language in `docs/DESIGN.md`. A small in-repo primitive layer preserves that language, keeps Canvas hit-testing and approval flows under FacetWrite control, and avoids large third-party styling/runtime assumptions.

Impact: Shared UI components may standardize buttons, fields, panels, tabs, drawers, dialogs, badges, and empty states. They must not own provider, AgentBackend, Canvas approval, or storage behavior; business logic remains in feature components and hooks.

## 2026-05-18: Canvas V2 Uses React Flow With FacetWrite-Owned Persistence
Decision: Use `@xyflow/react` as the Canvas V2 viewport and node interaction engine while keeping FacetWrite's Canvas API, SQLite tables, and write-request approval boundary as the source of truth.

Reason: Node editors need reliable pan, zoom, selection, dragging, and future extensibility. React Flow provides that interaction layer without requiring backend schema changes.

Impact: `DocumentCanvas.tsx` maps persisted `CanvasNode` records into React Flow nodes. Dragging and resizing persist through `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`. Current node kinds remain `document`, `note`, and `reference`; future node types should extend the kind renderer and backend validation deliberately. AI-originated writes still go through `canvas_write_requests` and approval.

## 2026-05-18: Canvas Resize Handles Stay Inside Node Hit Areas
Decision: Use a custom eight-point resize frame rendered just outside the selected node boundary instead of relying on React Flow's default handles.

Reason: Users need a clear separation between the content box and the selection controls. The outer frame makes resize affordances visually obvious, while enlarged transparent hit targets, `nodrag nopan`, and capture-phase pointer handling keep Figma-like resize reliable.

Impact: Resize handles use enlarged transparent hit targets so users do not need pixel-perfect pointer placement. Resize changes update React Flow `style`, `width`, and `height` during pointer drag and persist `x/y/width/height` once on pointer release. While a resize gesture is active, Canvas V2 disables React Flow node/pane dragging and filters position changes for that node so resize cannot also translate the node. Future selection boxes, alignment guides, or resize affordances must preserve handle hit testing, drag locking, and live visual updates.

## 2026-05-18: Canvas Text Nodes Auto-Expand Until Manually Resized
Decision: Treat text Canvas nodes as full information blocks by default. The frontend measures persisted text content and grows node height automatically until the user manually resizes the node.

Reason: Canvas content is expected to arrive as complete material, not as a truncated preview card. Users should be able to read the full generated or approved content first, then adjust the frame like a design canvas object.

Impact: Auto-expansion is a frontend layout behavior and does not alter the Canvas schema. Manual resize writes `metadata.canvasLayout.sizeMode = "manual"` so future auto-height updates do not override the user's chosen dimensions.

## 2026-05-16: Canvas Visual Layers Must Not Block Background Drag
Decision: Keep Canvas decorative and layout layers out of pointer hit testing unless they are intentionally interactive.

Reason: The Canvas viewport owns background pan and context-menu behavior. A transparent full-size grid layer can visually look harmless while intercepting pointer events and making the center of the board feel blocked.

Impact: `.canvas-grid` is visual-only and uses `pointer-events:none`; `.canvas-node` restores `pointer-events:auto` for selection, editing, and node dragging. Future overlays such as grids, guides, empty states, selection marquees, or alignment helpers must be browser-verified so they do not block viewport drag.

## 2026-05-16: Direct Canvas Write Intent Auto-Approves Same-Run Requests
Decision: Treat explicit user write commands as confirmation for newly created Canvas write requests from the same generation run.

Reason: Users expect "写入" / "save to canvas" to apply the content, while the Agent must still be unable to mutate Canvas silently.

Impact: `canvas_write` and fallback write-intent detection still create `canvas_write_requests` first. The frontend records pending request ids before the run, refreshes thread state after the run, and auto-approves only new pending requests. Existing stale requests remain pending. Model-requested `replace` operations are honored only when the user explicitly asks to replace/overwrite; otherwise they become append/create.

## 2026-05-16: CanvasWriter Uses Proposal Plus User Confirmation
Decision: Reframe `canvas_write` from a hard approval card into a Canvas write proposal that the user can confirm from the collaboration drawer.

Reason: The Agent should be allowed to suggest useful Canvas writes, but product data must still require user intent. The UI can make confirmation lightweight without granting silent write access.

Impact: `canvas_write` still creates `canvas_write_requests` and keeps `requiresApproval:true`. The frontend may show "write all", "write annotated snippets", and "cancel"; confirmation calls the backend approve/apply flow. Temporary selected-response annotations and highlights are client-only and are not persisted.

## 2026-05-16: Threads Are The Current Project Rename Boundary
Decision: Treat local project rename as `threads.title` rename rather than introducing a separate project title table.

Reason: Current project rows, recent project cards, open behavior, trash behavior, and Canvas assets are all keyed by thread id.

Impact: `PATCH /api/threads/:threadId` updates active thread titles only. Home and Projects use the custom title as the primary label and keep AgentCard title as secondary metadata. Trash entries cannot be renamed.

## 2026-05-16: Project Bulk Operations Stay Thread-scoped
Decision: Add batch move-to-trash and batch hard-delete as thread-scoped operations.

Reason: Projects currently represent local threads. Batch management should reuse existing trash/delete semantics instead of introducing a parallel project lifecycle.

Impact: `POST /api/threads/batch-trash` works on active threads; `POST /api/threads/batch-delete` permanently deletes only threads already in trash. The Projects UI exposes selection state and a context-aware batch action.

## 2026-05-15: AgentBackend Is The AI Execution Plane
Decision: Treat FacetWrite as the workspace/control plane and AgentBackend as the AI execution/runtime plane.

Reason: The product goal is to reuse AgentBackend's mature Lead Agent, subagent, ToolUse, and MCP framework instead of maintaining a competing FacetWrite Agent runtime.

Impact: Agent settings remain the user configuration surface, while the AI Dashboard shows runtime health, Skills/MCP, Agent mapping, and ToolUse bridge progress. FacetWrite capabilities such as CanvasWrite should be progressively bridged into AgentBackend ToolUse while preserving FacetWrite approval and data boundaries.

## 2026-05-15: AI Dashboard Is Read-only Runtime Observability
Decision: Add an AI Dashboard as a read-only control-plane view rather than another Agent editor.

Reason: Users need to see whether AgentBackend is actually online, authenticated, mapped, and ready for ToolUse/MCP execution, without mixing runtime observability into per-Agent prompt/model settings.

Impact: `/api/agent-backend/dashboard` aggregates runtime status, AgentBackend config overview, AgentCard-to-subagent mapping, ToolUse bridge status, and integration maturity. Writing AgentBackend config remains out of scope.

Update 2026-05-25: FacetWrite-managed Memory is an explicit exception to the read-only dashboard rule. The AI Dashboard may show, edit, and clear `.facetwrite/memory/` content because users need a visible control for what Agents may remember. AgentBackend legacy global memory remains outside the active FacetWrite run path unless FacetWrite passes explicit managed memory content.

## 2026-05-15: Docker Is The Preferred Local AgentBackend Runtime
Status: Superseded by `2026-06-12: Project-Managed Local Gateway Is The Default Runtime`.

Decision: Run AgentBackend as a Docker sidecar through its Compose nginx entrypoint at `http://127.0.0.1:2026` for local FacetWrite integration work.

Reason: AgentBackend is a Python/LangGraph runtime with its own dependency and service boundary. Docker avoids the Windows-native `uv` cache permission failure previously seen during local setup and matches the intended sidecar architecture.

Impact: FacetWrite uses `AGENT_BACKEND_ENABLED=true`, `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`, and `AGENT_BACKEND_ASSISTANT_ID=lead_agent` for local sidecar validation. Docker config is kept in workspace-local `.docker-codex/` and ignored by git.

## 2026-05-15: Do Not Bypass AgentBackend Auth
Decision: Treat AgentBackend protected endpoints as an integration contract instead of bypassing auth in FacetWrite.

Reason: Docker validation confirmed `/health` is public, but `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` require AgentBackend auth. Disabling or bypassing that boundary would hide the real production contract and weaken the runtime split.

Impact: FacetWrite now uses a backend-managed AgentBackend local session for protected APIs. Session cookies and CSRF tokens stay server-side, and the frontend only sees `authState`.

## 2026-05-15: FacetWrite Uses One Local AgentBackend Service Session
Decision: Use one backend-managed local AgentBackend session for the current sidecar integration instead of per-user AgentBackend account mapping.

Reason: FacetWrite is still local-first and owns product users, Canvas approvals, and SQLite data. A single local AgentBackend session is enough to validate runtime orchestration without prematurely designing cross-system identity mapping.

Impact: `AGENT_BACKEND_AUTH_EMAIL` and `AGENT_BACKEND_AUTH_PASSWORD` configure the local session. Multi-user AgentBackend identity mapping remains out of scope until the runtime path is stable.

## 2026-05-15: AgentBackend Is The Primary Agent Runtime Foundation
Decision: Integrate AgentBackend as a sidecar Agent runtime and use its Lead Agent as the main orchestration Agent when `AGENT_BACKEND_ENABLED=true`.

Reason: FacetWrite needs mature Agent runtime capability without rebuilding LangGraph-style orchestration, subagents, skill/tool filtering, and streaming semantics from scratch.

Impact: FacetWrite keeps ownership of product data, frontend interaction, SQLite persistence, Canvas writes, and approval flows. AgentBackend runtime events are adapted into FacetWrite run records, and the TypeScript run loop remains as a fallback during migration.

## 2026-05-15: AgentBackend Config Visibility Is Read-only First
Decision: Expose AgentBackend runtime status, skills, and MCP server overview through FacetWrite as read-only observability before adding write controls.

Reason: FacetWrite needs to show whether AgentBackend is active and what intelligent-runtime capabilities are visible, while avoiding premature MCP/Skill mutation paths.

Impact: `/api/agent-backend/config` redacts secret-like values and the frontend displays only overview information. Writing AgentBackend skills/MCP settings remains out of scope for this phase.

## 2026-05-15: Maintain Seven Project Fact Documents
Decision: Use `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `AGENT.md`, `DECISIONS.md`, and `REFACTOR_LOG.md` as the maintained technical documentation set.

Reason: The project has moved beyond a single MVP note. AI assistants need concise current facts instead of repeatedly interpreting historical plans.

Impact: Archived research and historical plans are references only. Current implementation truth lives in code plus the maintained docs.

## 2026-05-15: Archive Research Separately From Current Facts
Decision: Move PRD, competitor research, AgentBackend analysis, and old plans under `docs/reference/`.

Reason: These files are valuable context but can conflict with the current implementation state.

Impact: Implementation work should read `docs/reference/` only when background or rationale is needed.

## 2026-05-15: Tool Catalog Is The Tool Source Of Truth
Decision: Tool names, schemas, descriptions, prompt hints, default enablement, risk levels, and approval requirements live in `server/tools/catalog.ts` and `server/tools/policies.ts`.

Reason: Duplicating Tool definitions across UI, runtime, and prompt code causes drift.

Impact: New tools must update catalog/policy docs and Agent runtime config behavior.

## 2026-05-15: Canvas Writes Require User Approval
Status: Superseded by `2026-06-13: Canvas Writes Use Operation-Level Risk`.

Decision: The `canvas_write` tool can create pending write requests only. It cannot directly change Canvas nodes. This decision is preserved by the 2026-05-16 proposal UI: user confirmation may auto-call approval, but the Agent still cannot write silently.

Reason: Canvas mutation is a user-visible data write and should not happen solely because a model produced a tool call.

Impact: UI must collect explicit user confirmation. Backend approval is the only path that applies write requests.

## 2026-05-15: Chat Completions Is The Provider Baseline
Decision: Provider runtime uses Chat Completions-style messages, tools, tool calls, and tool result messages as the common baseline.

Reason: This fits current DeepSeek, OpenAI, and OpenAI-compatible integration needs.

Impact: Provider-specific features should be normalized behind provider runtime capabilities.

## 2026-05-15: Local Secrets Stay Out Of Tracked Docs
Decision: Real API keys belong only in `.env.local` or the shell environment and must never be committed or shown by status APIs.

Reason: FacetWrite is local-first but provider keys are production secrets.

Impact: Settings save requires explicit confirmation for local key writes, and docs must avoid pasted secrets.

# 2026-06-08: Electron Owns The Windows Source-Development Shell

Status: Partially superseded by `2026-06-12: Project-Managed Local Gateway Is The Default Runtime`. Electron ownership remains current; mandatory Docker startup does not.

Decision: Use Electron as a Windows source-development application shell around the existing Vite, Express, and Docker Agent Runtime services.

Reason: The immediate goal is an independent application window with startup feedback, Vite HMR, and window-bound service lifecycle without prematurely designing an installer or native Agent Runtime.

Impact: The shell uses fixed development ports `17776` and `17777`, starts Docker Desktop when available, owns only services it starts, and preserves complete compatible pre-existing Agent Runtime services. The planned Vite port `3100` was rejected because Windows dynamically reserved `3007-3106`. Docker Desktop remains required. Packaging, automatic updates, and a no-Docker local Runtime are deferred.
## 2026-06-12: Project-Managed Local Gateway Is The Default Runtime

Decision: Default to `AGENT_RUNTIME_MODE=local`, running the Agent Runtime Gateway with project-managed Python 3.12 and `uv`; retain Docker Compose as an explicit isolation/deployment mode and support user-managed external Gateways.

Reason: Core Agent capabilities live in the Python Gateway, not the Runtime Next.js frontend or nginx. Managing that Gateway directly removes the mandatory Docker Desktop startup dependency without rewriting the Agent protocol or dropping Skills, MCP, Memory, subagents, auth, SSE, or the FacetWrite bridge.

Impact: Local mode uses `127.0.0.1:8001`, shared `.deer-flow` state, `LocalSandboxProvider`, and `allow_host_bash:false`. Docker remains required for `AioSandboxProvider`, Kubernetes provisioning, Docker socket workflows, and Linux-container Bash Skills. Status surfaces expose deployment mode and sandbox provider.

The Windows double-click entry `start-opencanvas-shell.vbs` is a stricter local-only contract: it overrides stale parent mode variables, never invokes Docker, and is covered by `npm.cmd run acceptance:local-runtime`. The acceptance must start from that VBS, perform five real no-Mock generations, execute Skill/Web Search, observe Memory persistence, preserve Canvas approval, and reclaim owned processes.

# 2026-06-11: Project-First Context And Explicit Model Selection

- Project is the strict workspace and shared-context boundary.
- Thread is a conversation inside a Project and does not bind an Agent.
- Agent is selected per run and begins with no personal or cross-project context.
- Project Agent input values are keyed by Project and Agent, then immediately become Project shared context.
- Model Config backend storage is the sole generation model source.
- Threads select directly from valid chat Model Config entries and inherit a persisted default; Project bindings remain compatibility data.
- Existing legacy workspace data is cleared instead of migrated from the shared `local-project` design.

## 2026-06-11: Complete Physical Project Boundary And Runtime Sync Gate

- Schema version 3 clears workspace data again and rebuilds Canvas storage with physical `project_id` ownership.
- Project Agent inputs are shared by default and protected by monotonically increasing revisions.
- Canvas nodes and output versions enter Project shared context only after explicit user inclusion; shared context uses deterministic category budgets totaling 24,000 characters.
- Model Config remains saved when AgentBackend synchronization fails, but the model is marked degraded and cannot generate until synchronized.
- New Threads resolve a valid chat model from recent/active configured Model Configs. Project model bindings remain compatibility data only.
- Agent Runtime is the only real generation runtime. Runtime failure returns explicit errors and never calls the local Provider runner or records Mock output by default.

## 2026-06-12: Direct Conversation Models, Private Context, And Explicit Failures

- Threads select directly from enabled, keyed chat Model Configs grouped as reasoning, chat, or other chat.
- Context assembly is private and bounded: explicit mind chains/selections, selected and directed-related nodes, Workflow/Role state, structured inputs, post-reset Thread history, then Knowledge.
- `threads.context_reset_at` is a soft boundary that preserves visible history. The `clear_context` bridge tool uses the same persisted reset operation.
- Mock fallback requires explicit `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; normal runtime/model failures use stable error codes.

## 2026-06-12: Plan Runtime Owns Orchestration

- Superpowers-inspired brainstorming and plan writing are adapted as project-local skills.
- Persisted Plan state, approval, step isolation, Artifact ownership, and Canvas safety remain server-owned.
- A new Plan always requests one structured clarification before producing an approval-ready task board.
- Approved execution is sequential and pauses on interruption or failure.
## 2026-06-13: Product Runtime Owns Plan Lifecycle

Plan state transitions and execution scheduling are server-owned. Models receive one phase-scoped structured contract and cannot mark steps or Plans complete. Safe activities are persisted separately from private reasoning and raw tool payloads. Canvas Plan nodes are disposable read-only projections, not authoritative state.

## 2026-06-13: Canvas Writes Use Operation-Level Risk

Explicit Canvas actions are recognized and scheduled by product services instead of relying on model tool selection. Create and append are low-risk direct commits with stable action IDs and authoritative node results. Replace, range replacement, and delete remain destructive approval-gated operations. Runtime-supplied Project IDs are never trusted over Thread ownership.
## 2026-06-13: Product Server Owns Plan Attempts And Execution

Decision: The server creates Plan intake state, injects one phase-specific model contract, and runs approved steps through a leased persistent executor. React renders state and activities but does not initiate execution steps.

Reason: Model-selected lifecycle actions and frontend-memory loops caused repeated clarification calls, silent stalls, and unrecoverable execution after refresh.
