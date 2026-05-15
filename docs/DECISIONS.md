# FacetWrite Technical Decisions

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
