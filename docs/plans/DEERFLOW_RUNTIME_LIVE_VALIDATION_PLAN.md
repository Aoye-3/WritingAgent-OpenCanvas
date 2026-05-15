# DeerFlow Runtime Live Validation Plan

Date: 2026-05-15
Status: Planned, not yet implemented

## Summary

This phase saves the plan first, then validates the real DeerFlow sidecar integration and adds observable runtime configuration surfaces. The goal is for FacetWrite to confirm whether a Task card is actually generated through DeerFlow Lead Agent, and to preserve runtime status, configuration source, and validation results in the technical documentation.

## Key Changes

### Save Plan First

- Create or update `docs/plans/DEERFLOW_RUNTIME_LIVE_VALIDATION_PLAN.md`.
- Add a `docs/REFACTOR_LOG.md` entry noting that the plan is saved and pending execution.
- Commit these documentation changes before implementation.

### Sidecar Validation

- Start the DeerFlow backend.
- Run FacetWrite with:
  - `DEERFLOW_ENABLED=true`
  - `DEERFLOW_BASE_URL=http://127.0.0.1:8000`
- Verify one Task-card generation request reaches DeerFlow `/api/runs/stream`.
- If DeerFlow stream wire shape differs from the current parser, update `server/deerflow/client.ts`.

### Backend Status API

- Add a DeerFlow runtime status service.
- Add `/api/deerflow/status` returning:
  - `enabled`
  - `baseUrl`
  - `assistantId`
  - `reachable`
  - `lastError`
  - `runtimeProvider`
- Do not expose secrets or DeerFlow MCP environment values.

### Frontend Runtime Status

- Show DeerFlow runtime status in the project settings panel or Agent settings page.
- Distinguish:
  - DeerFlow enabled and reachable
  - DeerFlow enabled but unreachable
  - DeerFlow disabled and using TypeScript fallback
- Preserve provider `deerflow` in generation results.

### Shared Skill And Tool Read-only Sync

- Add backend read-only proxy behavior for DeerFlow `/api/skills` and `/api/mcp/config`.
- Show DeerFlow skills and MCP overview in the frontend without write controls.
- Keep FacetWrite Tool policy as the product-side risk source of truth.

### Human-in-the-loop Boundary

- DeerFlow must not write directly to the FacetWrite database.
- DeerFlow-proposed Canvas writes must still go through FacetWrite pending approval.
- This phase validates event and result flow only; high-risk write-operation bridging remains out of scope.

### Review After Execution

- Run `npm.cmd run typecheck`.
- Run `npm.cmd test`.
- Review `git diff` for scope control.
- Confirm documentation is synchronized:
  - `docs/ARCHITECTURE.md`
  - `docs/AGENT.md`
  - `docs/API.md`
  - `docs/DECISIONS.md`
  - `docs/REFACTOR_LOG.md`
- If real DeerFlow sidecar validation cannot complete, record the reason, failure summary, and next action.

## Test Plan

- `npm.cmd run typecheck`
- `npm.cmd test`
- Add DeerFlow status unit tests:
  - disabled state
  - enabled and reachable
  - enabled and unreachable
- Add DeerFlow config proxy tests:
  - skills read succeeds
  - MCP config does not return secret environment values
  - DeerFlow unreachable returns a safe error
- Manual integration:
  - start DeerFlow backend
  - start FacetWrite backend/frontend
  - generate from one Task card
  - confirm provider is `deerflow`
  - confirm run events include `deerflow_*` or DeerFlow runtime metadata

## Assumptions

- Execution order is fixed: save plan to docs, commit plan baseline, implement and validate, review, update docs, commit implementation.
- Real DeerFlow sidecar validation is the highest priority.
- This phase does not add DeerFlow write-configuration UI.
- This phase does not migrate the database schema.
- This phase does not bridge all FacetWrite tools into DeerFlow.
- The TypeScript runtime remains as fallback until the DeerFlow path is stable.
