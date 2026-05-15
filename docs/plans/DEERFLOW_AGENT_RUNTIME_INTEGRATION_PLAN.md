# DeerFlow Main Agent + FacetWrite Subagent Runtime Integration Plan

Date: 2026-05-15
Status: Planned, not yet implemented

## Summary

FacetWrite will use DeerFlow as the primary intelligent runtime while keeping FacetWrite responsible for product backend behavior, frontend interaction, Canvas state, persistence, and human-in-the-loop approval.

The target architecture is:

- DeerFlow Lead Agent as the main orchestration agent.
- FacetWrite Task cards as configured DeerFlow subagents.
- Shared Skill and Tool configuration surfaced through FacetWrite settings.
- Human-in-the-loop approval for writes, Canvas changes, and external side effects.
- The existing TypeScript agent loop retained as a migration fallback.

Because this plan describes a direct runtime integration, DeerFlow should be documented as an integration foundation when implementation begins, not merely as reference material.

## Key Changes

### DeerFlow Runtime Adapter

- Add a FacetWrite backend adapter that calls the DeerFlow Gateway over HTTP/SSE.
- Use DeerFlow `lead_agent` as the default main agent entrypoint.
- Add environment configuration:
  - `DEERFLOW_ENABLED`
  - `DEERFLOW_BASE_URL`
  - `DEERFLOW_ASSISTANT_ID`
- Keep the existing TypeScript `agentRunLoop` available when DeerFlow is disabled or unavailable during migration.

### Task Card to Subagent Mapping

- Map each built-in FacetWrite AgentCard to a DeerFlow subagent definition.
- Each subagent definition should include:
  - name
  - description
  - system prompt
  - allowed skills
  - allowed tools
  - model inheritance behavior
  - timeout
  - max turns
- Initial coverage should include the existing cards:
  - blog writing
  - summary
  - email writing
  - lesson plan
  - report outline
  - rewrite and polish

### Shared Skill and Tool Configuration

- Treat DeerFlow skill and MCP configuration as the intelligent-runtime source of truth.
- Expose a controlled FacetWrite backend read path for the frontend Agent settings UI.
- Continue using FacetWrite policy/risk metadata for product-facing controls.
- Do not expose high-risk FacetWrite tools as direct database-writing tools inside DeerFlow in the first integration slice.

### Human-in-the-loop Rules

- DeerFlow may propose Canvas changes or external actions.
- FacetWrite must convert those proposals into pending approval requests.
- User approval is required before applying Canvas writes or other external side effects.
- External side-effect tools remain disabled by default and require explicit UI configuration with risk labeling.

### Streaming and Events

- Map DeerFlow SSE token/message events into the existing FacetWrite generation output flow.
- Map DeerFlow subagent events such as `task_started`, `task_running`, and `task_completed` into the FacetWrite run/tool event display.
- Persist final assistant content and run metadata through the existing FacetWrite run/output/version system.

## Documentation Updates Required During Implementation

- Update `docs/ARCHITECTURE.md` to describe the DeerFlow sidecar runtime and the FacetWrite product backend boundary.
- Update `docs/AGENT.md` to describe the main-agent/subagent design, shared Skill/Tool configuration, and HITL rules.
- Update `docs/API.md` if FacetWrite introduces DeerFlow adapter or proxy endpoints.
- Update `docs/DATABASE.md` if thread/run mapping requires schema changes.
- Update `docs/DECISIONS.md` with the decision to adopt DeerFlow as the primary Agent runtime foundation.
- Update `docs/REFACTOR_LOG.md` after each implementation slice.

## Test Plan

- Unit test DeerFlow request construction.
- Unit test SSE event parsing and mapping into FacetWrite events.
- Unit test AgentCard to subagent config mapping.
- Unit test Skill/Tool allowlist behavior.
- Verify `DEERFLOW_ENABLED=false` continues to use the current TypeScript runtime.
- Verify `DEERFLOW_ENABLED=true` routes generation through the DeerFlow adapter.
- Verify DeerFlow failures produce a clear backend error or fallback behavior.
- Verify DeerFlow-proposed Canvas writes only create pending approval requests.
- Manually validate one Task card end to end with DeerFlow backend and FacetWrite frontend running.

## Assumptions

- DeerFlow runs as a local Python sidecar service in v1.
- FacetWrite remains the product backend and owns project data, persistence, approval, and UI state.
- The existing TypeScript runtime remains available during migration.
- The first implementation slice should prioritize one real Task-card generation loop before expanding every card.
- Product-specific AgentToolUse upgrades come after the DeerFlow runtime integration is stable.
