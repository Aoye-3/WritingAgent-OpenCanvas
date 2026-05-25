# FacetWrite Technical Decisions

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

