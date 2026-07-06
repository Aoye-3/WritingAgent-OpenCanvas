# AI Dashboard And DeerFlow Runtime Control Plane Plan

> Historical/superseded plan. The current AI Dashboard describes Agent Runtime/AgentBackend health, Skills/MCP, subagent mapping, ToolUse bridge, and FacetWrite-managed Memory through `/api/agent-runtime/*`. DeerFlow-specific names below are historical implementation context.

Date: 2026-05-15
Status: Implemented and validated

## Summary

Add an `AI Dashboard` entry that shows the full AI runtime state. FacetWrite is the workspace, configuration surface, interaction window, approval layer, and data boundary. DeerFlow is the execution/runtime plane for Lead Agent, subagents, ToolUse, MCP, and orchestration.

## Run Result

- Added `/api/deerflow/dashboard`.
- Added the `AI仪表盘` / `AI Dashboard` navigation entry.
- Added a read-only dashboard page for runtime status, Skills/MCP overview, Agent runtime mapping, ToolUse bridge status, and integration maturity.
- Added a pending-session guard in the DeerFlow auth helper so concurrent protected requests share one setup/login flow.
- Verified typecheck, tests, and dashboard API against the local Docker sidecar.

## Key Changes

- Add `AI仪表盘` / `AI Dashboard` to the left navigation between Agent settings and Knowledge settings.
- Add a read-only AI Dashboard page for runtime status, Skills/MCP overview, AgentCard-to-DeerFlow subagent mapping, and ToolUse bridge status.
- Add `GET /api/deerflow/dashboard` to aggregate DeerFlow status, config overview, Agent mapping, and bridge status without exposing secrets.
- Use wording that avoids "FacetWrite tool vs DeerFlow tool" as competing runtimes. FacetWrite capabilities should be described as workspace/control-plane capabilities that are progressively bridged into DeerFlow tools or MCP capabilities.
- Keep Agent settings focused on configuring concrete Agents. Keep AI Dashboard focused on runtime observability and integration maturity.

## Test Plan

- `npm.cmd run typecheck`
- `npm.cmd test`
- Unit tests for dashboard shape, disabled runtime behavior, authenticated runtime behavior, and secret-safe responses.
- Manual frontend verification that the navigation entry opens the dashboard and Agent settings still works.

## Assumptions

- This phase is read-only and does not write DeerFlow configuration.
- No database schema migration.
- No direct DeerFlow writes to FacetWrite SQLite or Canvas.
- TypeScript fallback remains available.
