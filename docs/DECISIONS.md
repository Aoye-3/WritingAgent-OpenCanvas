# FacetWrite Technical Decisions

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
Decision: The `canvas_write` tool can create pending write requests only. It cannot directly change Canvas nodes.

Reason: Canvas mutation is a user-visible data write and should not happen solely because a model produced a tool call.

Impact: UI must show approve/reject controls. Backend approval is the only path that applies write requests.

## 2026-05-15: Chat Completions Is The Provider Baseline
Decision: Provider runtime uses Chat Completions-style messages, tools, tool calls, and tool result messages as the common baseline.

Reason: This fits current DeepSeek, OpenAI, and OpenAI-compatible integration needs.

Impact: Provider-specific features should be normalized behind provider runtime capabilities.

## 2026-05-15: Local Secrets Stay Out Of Tracked Docs
Decision: Real API keys belong only in `.env.local` or the shell environment and must never be committed or shown by status APIs.

Reason: FacetWrite is local-first but provider keys are production secrets.

Impact: Settings save requires explicit confirmation for local key writes, and docs must avoid pasted secrets.
