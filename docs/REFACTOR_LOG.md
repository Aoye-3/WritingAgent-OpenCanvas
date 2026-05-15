# FacetWrite Refactor Log

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
