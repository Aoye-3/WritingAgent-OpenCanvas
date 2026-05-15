# FacetWrite Refactor Log

## 2026-05-15: DeerFlow Auth Session Run
Scope: Implemented backend-managed DeerFlow local-session auth and validated one real sidecar generation.

Findings:
- DeerFlow protected APIs require a session cookie and CSRF token for state-changing requests.
- DeerFlow first-boot setup can return 422 if the configured email fails DeerFlow validation; `facetwrite-local@example.com` works for local setup.
- DeerFlow `/api/v1/auth/setup-status` is rate-limited, so manual validation may need to wait for its cooldown after repeated checks.

Completed:
- Added `server/deerflow/auth.ts` for setup-status, optional initialize, login, session-cookie/CSRF extraction, in-memory cache, and one retry after 401/403.
- Routed `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` through authenticated DeerFlow fetch.
- Extended `/api/deerflow/status` with `authState`.
- Updated Project Settings DeerFlow runtime display for authenticated, setup-required, auth-required, auth-failed, unreachable, and fallback states.
- Added `.env.local.example` DeerFlow auth fields.
- Added unit coverage for setup-required, auto-setup, login, safe auth errors, 401/403 retry, config proxy auth, and run stream auth headers.
- Validated Docker sidecar health, `authState:"authenticated"`, config overview, and one Summary Task-card generation returning provider `deerflow`.

Open TODO:
- Add a more user-friendly setup/reset note for DeerFlow local credentials in docs if this becomes part of regular onboarding.
- Consider exposing recent DeerFlow auth/runtime errors near generation results instead of only in Project Settings.
- Decide later whether FacetWrite needs per-user DeerFlow identity mapping.

Next Priority Check:
- Review DeerFlow stream wire shape and event semantics from several built-in Task cards before expanding ToolUse bridging.

## 2026-05-15: DeerFlow Auth Session Run Plan
Scope: Saved the automatic DeerFlow local-session auth plan before implementation.

Findings:
- DeerFlow Docker sidecar health/status is online, but protected endpoints require auth.
- DeerFlow exposes public setup/login endpoints and protected API routes behind cookie plus CSRF behavior.
- FacetWrite should keep DeerFlow session cookies server-side only.

Completed:
- Added `docs/plans/DEERFLOW_AUTH_SESSION_RUN_PLAN.md`.
- Captured the planned env configuration, backend session helper, authenticated fetch behavior, frontend status states, tests, and documentation updates.

Open TODO:
- Implement backend DeerFlow auth/session handling.
- Wire config proxy and run stream requests through authenticated fetch.
- Validate one real DeerFlow-backed Task-card generation.

Next Priority Check:
- Start with unit-tested auth/session helper behavior before wiring protected endpoints.

## 2026-05-15: DeerFlow Docker Sidecar Run
Scope: Ran the Docker sidecar path and validated the first real FacetWrite-to-DeerFlow runtime checks.

Findings:
- Workspace-local `DOCKER_CONFIG` avoids the user-level Docker config access-denied warning.
- DeerFlow Compose can start nginx/gateway/frontend through `Deerflow/docker/docker-compose-dev.yaml` with project name `deer-flow-dev`.
- A copied example `Deerflow/config.yaml` needs at least one concrete model entry; an empty/comment-only `models:` block causes gateway startup validation to fail.
- DeerFlow `/health` is public and returns healthy through nginx at `http://127.0.0.1:2026`.
- FacetWrite `/api/deerflow/status` reports `enabled:true`, `reachable:true`, and `runtimeProvider:"deerflow"` when pointed at the Docker sidecar.
- DeerFlow `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` are protected in the Docker runtime. FacetWrite config proxy reports safe errors for 401, and generation reaches DeerFlow but receives HTTP 403 until auth is wired.

Completed:
- Added `.docker-codex/` to `.gitignore`.
- Generated ignored local DeerFlow config/env files needed for Docker startup without printing secrets.
- Started Docker Desktop and DeerFlow Compose services.
- Confirmed sidecar health and FacetWrite runtime status are online.
- Confirmed config proxy does not leak secrets when DeerFlow protected endpoints return auth errors.
- Attempted one Task-card generation and recorded the auth blocker instead of expanding ToolUse or bypassing DeerFlow auth.

Open TODO:
- Complete DeerFlow first-boot setup or implement a FacetWrite service-to-service auth flow for protected DeerFlow endpoints.
- Re-run `/api/deerflow/config` after auth and confirm skills/MCP overview is populated.
- Re-run one Task-card generation and confirm provider `deerflow` only after `/api/runs/stream` accepts authenticated requests.
- Add user-facing error affordance near generation results if DeerFlow is enabled but protected endpoints reject requests.

Next Priority Check:
- Decide the DeerFlow auth strategy: automated setup/login cookie/token handling in the FacetWrite adapter, or a documented DeerFlow development auth mode if the project supports one.

## 2026-05-15: DeerFlow Docker Sidecar Run Plan
Scope: Saved the Docker sidecar execution plan before implementation.

Findings:
- DeerFlow includes Docker Compose files for nginx/gateway startup.
- Docker CLI is available, but reading `C:\Users\123\.docker\config.json` reports an access-denied warning.
- FacetWrite currently reports DeerFlow disabled and uses TypeScript fallback.

Completed:
- Added `docs/plans/DEERFLOW_DOCKER_SIDECAR_RUN_PLAN.md`.
- Captured the intended Docker execution path, sidecar URL, FacetWrite env values, validation checks, and layer-boundary constraints.

Open TODO:
- Run Docker commands with a workspace-local `DOCKER_CONFIG`.
- Start DeerFlow nginx/gateway through Compose.
- Validate FacetWrite `/api/deerflow/status` and one DeerFlow-backed Task-card generation if credentials are available.

Next Priority Check:
- Generate missing DeerFlow local config files and start the Docker sidecar.

## 2026-05-15: DeerFlow Runtime Observability And Live Validation
Scope: Implemented DeerFlow runtime status/config visibility and attempted real sidecar validation.

Findings:
- FacetWrite can safely expose DeerFlow runtime status through a dedicated backend route without mixing it into provider settings validation.
- DeerFlow Skill/MCP visibility should remain read-only for now, with secret-like MCP fields redacted before reaching the UI.
- Real sidecar validation could not complete in this environment: `uv` found CPython 3.12.12 and started dependency setup, but failed while downloading/caching `langfuse==4.5.1` due to Windows cache rename permission errors (`os error 5`, access denied).

Completed:
- Added `/api/deerflow/status`.
- Added `/api/deerflow/config`.
- Added backend tests for disabled, reachable, unreachable, skills read, MCP redaction, and safe unreachable config behavior.
- Added Project Settings DeerFlow runtime visibility with status, base URL, assistant ID, skill count, and MCP server overview.
- Confirmed `npm.cmd run typecheck` and `npm.cmd test` pass before documentation review.
- Cleaned temporary `.venv` and `.uv-cache` artifacts created by the failed sidecar setup attempt.

Open TODO:
- Retry live sidecar validation in an environment where `uv` can complete dependency installation and cache writes.
- Confirm `/api/runs/stream` wire shape against a running DeerFlow backend.
- Add UI affordance for showing recent DeerFlow runtime errors near generation results if live validation reveals user-facing failure cases.

Next Priority Check:
- Fix the local DeerFlow Python/uv environment or run the sidecar in a clean container, then perform one Task-card end-to-end generation with `DEERFLOW_ENABLED=true`.

## 2026-05-15: DeerFlow Runtime Live Validation Plan
Scope: Saved the next DeerFlow runtime plan before implementation.

Findings:
- The first DeerFlow backend adapter slice is implemented and committed.
- The next priority is real sidecar validation, runtime observability, and read-only shared Skill/MCP configuration visibility.

Completed:
- Added `docs/plans/DEERFLOW_RUNTIME_LIVE_VALIDATION_PLAN.md`.
- Captured the required execution order: save plan, commit baseline, implement and validate, review, update docs, and commit implementation.

Open TODO:
- Add DeerFlow runtime status API and frontend visibility.
- Add read-only DeerFlow Skill/MCP config proxy behavior.
- Attempt real DeerFlow sidecar validation and record the result.

Next Priority Check:
- Start by implementing runtime status and safe read-only config proxy tests.

## 2026-05-15: DeerFlow Runtime Adapter First Slice
Scope: Implemented the first backend slice of the DeerFlow Agent runtime integration.

Findings:
- DeerFlow can be introduced through the stateless `/api/runs/stream` Gateway endpoint without changing the FacetWrite SQLite schema in this slice.
- The current `generationService` is the right integration point because it already owns prompt construction, thread creation, run recording, and fallback behavior.
- FacetWrite's existing `ToolEventRecord` needed to accept DeerFlow subagent events in addition to local tool-call events.

Completed:
- Added `server/deerflow/config.ts`, `server/deerflow/client.ts`, `server/deerflow/sse.ts`, and `server/deerflow/taskAgentMapping.ts`.
- Added `DEERFLOW_ENABLED`, `DEERFLOW_BASE_URL`, and `DEERFLOW_ASSISTANT_ID` runtime configuration.
- Routed generation through DeerFlow when enabled, while keeping the existing TypeScript provider runtime available when disabled.
- Mapped FacetWrite AgentCards to DeerFlow subagent metadata.
- Mapped DeerFlow custom `task_*` stream events into persisted `deerflow_*` tool events.
- Added unit tests for request construction, SSE parsing, stream reading, and Task-card subagent mapping.

Open TODO:
- Start and validate against a real DeerFlow backend process.
- Add frontend settings/status surfaces for DeerFlow availability and shared Skill/Tool config.
- Add controlled bridge behavior for DeerFlow-proposed Canvas writes rather than exposing direct database writes.
- Expand the first real Task-card run into all built-in Task cards after the end-to-end path is stable.

Next Priority Check:
- Run FacetWrite with `DEERFLOW_ENABLED=true` and verify one Task-card generation against a live DeerFlow sidecar.

## 2026-05-15: DeerFlow Agent Runtime Integration Plan
Scope: Saved the DeerFlow main-agent and FacetWrite subagent runtime integration plan for later implementation.

Findings:
- FacetWrite should pursue a serious Agent runtime by directly integrating DeerFlow as the intelligent orchestration layer, rather than only treating it as reference code.
- The preferred architecture is DeerFlow Lead Agent as the main agent, with FacetWrite Task cards mapped to configured subagents.
- FacetWrite should continue to own frontend interaction, persistence, Canvas state, and human-in-the-loop approval.

Completed:
- Added `docs/plans/DEERFLOW_AGENT_RUNTIME_INTEGRATION_PLAN.md`.
- Captured the planned DeerFlow sidecar runtime boundary, Task-card subagent mapping, shared Skill/Tool configuration, HITL rules, event streaming, documentation updates, and test plan.

Open TODO:
- Implement the DeerFlow backend adapter and environment configuration.
- Add TaskCard to DeerFlow subagent mapping.
- Wire DeerFlow streaming events into the existing FacetWrite generation/run event flow.
- Keep Canvas writes and external side effects behind pending user approval.
- Update `docs/ARCHITECTURE.md`, `docs/AGENT.md`, `docs/API.md`, `docs/DATABASE.md`, and `docs/DECISIONS.md` as implementation begins.

Next Priority Check:
- Start with one real Task-card generation loop routed through DeerFlow while keeping the current TypeScript runtime as fallback.

## 2026-05-15: Technical Documentation Architecture
Scope: Organized project documentation around current code facts and archived historical planning/research material.

Findings:
- `docs/` previously mixed current security notes with PRD, competitor analysis, DeerFlow research, and implementation plans.
- Current code has already implemented several historical plan items: route/service split, Tool catalog/policy, Agent runtime config, Provider runtime, Canvas write requests, and SQLite persistence.
- The remaining maintainability risks should be tracked as current refactor work rather than rediscovered from old plans.

Completed:
- Planned seven maintained technical documents: project brief, architecture, API, database, Agent/Tool, decisions, and refactor log.
- Classified historical research and Plan files as references instead of current implementation truth.
- Moved root PRD, duplicated `Plan/` research files, and existing `docs/` research files into `docs/reference/`.
- Preserved `SECURITY.md` as the active security document.

Open TODO:
- Fix mojibake Chinese copy in AgentCard data and any remaining UI text.
- Continue reducing `src/app/App.tsx` responsibilities by moving thread, Canvas, and generation orchestration into focused hooks.
- Split `server/storage.ts` into schema/client/repository/service layers when storage behavior changes next.
- Continue tightening runtime validation for API boundaries.

Next Priority Check:
- Audit Agent settings save/load after the new Skill catalog UI commit.
- Verify `canvas_write` cannot be enabled outside policy or applied without approve.
- Review API response consistency across frontend clients.
