# FacetWrite Technical Decisions

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

## 2026-05-15: DeerFlow Is The AI Execution Plane
Decision: Treat FacetWrite as the workspace/control plane and DeerFlow as the AI execution/runtime plane.

Reason: The product goal is to reuse DeerFlow's mature Lead Agent, subagent, ToolUse, and MCP framework instead of maintaining a competing FacetWrite Agent runtime.

Impact: Agent settings remain the user configuration surface, while the AI Dashboard shows runtime health, Skills/MCP, Agent mapping, and ToolUse bridge progress. FacetWrite capabilities such as CanvasWrite should be progressively bridged into DeerFlow ToolUse while preserving FacetWrite approval and data boundaries.

## 2026-05-15: AI Dashboard Is Read-only Runtime Observability
Decision: Add an AI Dashboard as a read-only control-plane view rather than another Agent editor.

Reason: Users need to see whether DeerFlow is actually online, authenticated, mapped, and ready for ToolUse/MCP execution, without mixing runtime observability into per-Agent prompt/model settings.

Impact: `/api/deerflow/dashboard` aggregates runtime status, DeerFlow config overview, AgentCard-to-subagent mapping, ToolUse bridge status, and integration maturity. Writing DeerFlow config remains out of scope.

## 2026-05-15: Docker Is The Preferred Local DeerFlow Runtime
Decision: Run DeerFlow as a Docker sidecar through its Compose nginx entrypoint at `http://127.0.0.1:2026` for local FacetWrite integration work.

Reason: DeerFlow is a Python/LangGraph runtime with its own dependency and service boundary. Docker avoids the Windows-native `uv` cache permission failure previously seen during local setup and matches the intended sidecar architecture.

Impact: FacetWrite uses `DEERFLOW_ENABLED=true`, `DEERFLOW_BASE_URL=http://127.0.0.1:2026`, and `DEERFLOW_ASSISTANT_ID=lead_agent` for local sidecar validation. Docker config is kept in workspace-local `.docker-codex/` and ignored by git.

## 2026-05-15: Do Not Bypass DeerFlow Auth
Decision: Treat DeerFlow protected endpoints as an integration contract instead of bypassing auth in FacetWrite.

Reason: Docker validation confirmed `/health` is public, but `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` require DeerFlow auth. Disabling or bypassing that boundary would hide the real production contract and weaken the runtime split.

Impact: FacetWrite now uses a backend-managed DeerFlow local session for protected APIs. Session cookies and CSRF tokens stay server-side, and the frontend only sees `authState`.

## 2026-05-15: FacetWrite Uses One Local DeerFlow Service Session
Decision: Use one backend-managed local DeerFlow session for the current sidecar integration instead of per-user DeerFlow account mapping.

Reason: FacetWrite is still local-first and owns product users, Canvas approvals, and SQLite data. A single local DeerFlow session is enough to validate runtime orchestration without prematurely designing cross-system identity mapping.

Impact: `DEERFLOW_AUTH_EMAIL` and `DEERFLOW_AUTH_PASSWORD` configure the local session. Multi-user DeerFlow identity mapping remains out of scope until the runtime path is stable.

## 2026-05-15: DeerFlow Is The Primary Agent Runtime Foundation
Decision: Integrate DeerFlow as a sidecar Agent runtime and use its Lead Agent as the main orchestration Agent when `DEERFLOW_ENABLED=true`.

Reason: FacetWrite needs mature Agent runtime capability without rebuilding LangGraph-style orchestration, subagents, skill/tool filtering, and streaming semantics from scratch.

Impact: FacetWrite keeps ownership of product data, frontend interaction, SQLite persistence, Canvas writes, and approval flows. DeerFlow runtime events are adapted into FacetWrite run records, and the TypeScript run loop remains as a fallback during migration.

## 2026-05-15: DeerFlow Config Visibility Is Read-only First
Decision: Expose DeerFlow runtime status, skills, and MCP server overview through FacetWrite as read-only observability before adding write controls.

Reason: FacetWrite needs to show whether DeerFlow is active and what intelligent-runtime capabilities are visible, while avoiding premature MCP/Skill mutation paths.

Impact: `/api/deerflow/config` redacts secret-like values and the frontend displays only overview information. Writing DeerFlow skills/MCP settings remains out of scope for this phase.

## 2026-05-15: Maintain Seven Project Fact Documents
Decision: Use `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `AGENT.md`, `DECISIONS.md`, and `REFACTOR_LOG.md` as the maintained technical documentation set.

Reason: The project has moved beyond a single MVP note. AI assistants need concise current facts instead of repeatedly interpreting historical plans.

Impact: Archived research and historical plans are references only. Current implementation truth lives in code plus the maintained docs.

## 2026-05-15: Archive Research Separately From Current Facts
Decision: Move PRD, competitor research, DeerFlow analysis, and old plans under `docs/reference/`.

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
