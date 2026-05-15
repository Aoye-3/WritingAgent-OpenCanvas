# DeerFlow Docker Sidecar Run Plan

Date: 2026-05-15
Status: Planned, not yet implemented

## Summary

This phase moves FacetWrite + DeerFlow from an implemented adapter to a real Docker sidecar runtime. FacetWrite currently falls back to the TypeScript runtime. DeerFlow already provides Docker Compose files, but Docker reads the user-level config file with a permission warning, so execution should use a workspace-local `DOCKER_CONFIG`.

## Key Changes

### Save Plan First

- Add this plan at `docs/plans/DEERFLOW_DOCKER_SIDECAR_RUN_PLAN.md`.
- Update `docs/REFACTOR_LOG.md` with a saved-plan entry.
- Commit the documentation baseline before running Docker changes.

### Prepare DeerFlow Docker Runtime

- Create a workspace-local Docker config directory such as `.docker-codex/`.
- Run Docker commands with `DOCKER_CONFIG` pointing to that directory.
- Create `Deerflow/config.yaml` from `config.example.yaml` if missing.
- Create `Deerflow/extensions_config.json` from `extensions_config.example.json` if missing.
- Create `Deerflow/.env` if needed, copying provider environment variables from FacetWrite local env files without printing secrets.
- If no API key is available, complete health/status validation and record generation validation as blocked.

### Start Sidecar

- Use DeerFlow's Docker Compose development file: `Deerflow/docker/docker-compose-dev.yaml`.
- Use Compose project name `deer-flow-dev`.
- Prefer DeerFlow nginx as the sidecar entrypoint: `http://127.0.0.1:2026`.
- FacetWrite should use:
  - `DEERFLOW_ENABLED=true`
  - `DEERFLOW_BASE_URL=http://127.0.0.1:2026`
  - `DEERFLOW_ASSISTANT_ID=lead_agent`

### Validate FacetWrite Contract

- Confirm `GET http://127.0.0.1:2026/health` returns healthy.
- Confirm FacetWrite `/api/deerflow/status` returns enabled, reachable, and runtime provider `deerflow`.
- Confirm FacetWrite `/api/deerflow/config` returns read-only DeerFlow skills/MCP overview and redacts secret-like values.
- Run one Task-card generation through DeerFlow if an API key is available.
- If the DeerFlow stream shape differs, update only the stream/event parser and keep ToolUse expansion out of scope.

### Preserve Layer Boundaries

- DeerFlow remains the intelligent runtime sidecar.
- FacetWrite keeps product data, SQLite, Canvas, approval, and frontend state.
- DeerFlow does not write directly to the FacetWrite database.
- DeerFlow write-configuration UI remains out of scope.
- No database schema migration in this phase.

### Review And Documentation

- Run `npm.cmd run typecheck`.
- Run `npm.cmd test`.
- Update current technical docs with Docker sidecar run facts and validation results.
- If Docker build/start fails, record the exact failure point, summarized logs, and next action.
- Commit the implementation result.

## Test Plan

- Docker/sidecar:
  - `docker compose` starts DeerFlow nginx/gateway.
  - `GET http://127.0.0.1:2026/health` returns healthy.
- FacetWrite:
  - `/api/deerflow/status` shows DeerFlow online.
  - `/api/deerflow/config` returns read-only overview without secrets.
  - One Task-card generation returns provider `deerflow`, or generation is explicitly recorded as blocked by missing provider credentials.
- Regression:
  - `npm.cmd run typecheck`
  - `npm.cmd test`
  - TypeScript fallback still works when `DEERFLOW_ENABLED` is off.

## Assumptions

- DeerFlow nginx on `http://127.0.0.1:2026` is the first sidecar target.
- Direct gateway port `8001` is not the first target because Compose exposes nginx by default.
- A missing API key does not block sidecar health/status validation.
- AgentToolUse deep upgrades remain out of scope until the sidecar is stable.
