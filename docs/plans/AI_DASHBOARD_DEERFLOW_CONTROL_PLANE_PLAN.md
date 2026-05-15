# AI Dashboard And DeerFlow Runtime Control Plane Plan

Date: 2026-05-15
Status: Planned, not yet implemented

## Summary

Add an `AI Dashboard` entry that shows the full AI runtime state. FacetWrite is the workspace, configuration surface, interaction window, approval layer, and data boundary. DeerFlow is the execution/runtime plane for Lead Agent, subagents, ToolUse, MCP, and orchestration.

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
