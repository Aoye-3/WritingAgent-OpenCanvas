# DeerFlow Auth Session Run Plan

Date: 2026-05-15
Status: Planned, not yet implemented

## Summary

FacetWrite should access DeerFlow protected APIs through a legitimate backend-managed DeerFlow session. The session uses DeerFlow local auth, remains in FacetWrite server memory, and is never exposed to the frontend.

## Key Changes

- Add DeerFlow auth configuration:
  - `DEERFLOW_AUTH_EMAIL`
  - `DEERFLOW_AUTH_PASSWORD`
  - `DEERFLOW_AUTO_SETUP`
  - `DEERFLOW_AUTH_TIMEOUT_MS`
- Add a backend DeerFlow auth/session helper that checks setup status, optionally initializes the first admin, logs in, extracts `access_token` and `csrf_token`, and caches them in memory.
- Route protected DeerFlow requests through authenticated fetch:
  - `GET /api/skills`
  - `GET /api/mcp/config`
  - `POST /api/runs/stream`
- Retry once after 401/403 by clearing the cached session and logging in again.
- Extend `/api/deerflow/status` with `authState` while keeping secrets, cookies, and tokens out of all API responses.
- Update the settings UI to distinguish online/authenticated, online/auth-required, setup-required, auth-failed, unreachable, and TypeScript fallback states.
- Keep DeerFlow as the Agent runtime sidecar. FacetWrite keeps product data, Canvas approval, SQLite, and frontend state.

## Test Plan

- Unit tests for setup required, auto setup, login success, auth failure, 401/403 retry, secret-safe errors, config proxy auth, and run stream auth headers.
- `npm.cmd run typecheck`
- `npm.cmd test`
- Manual sidecar validation against `http://127.0.0.1:2026`:
  - `/api/deerflow/status` returns `reachable:true` and `authState:"authenticated"`.
  - `/api/deerflow/config` reads skills/MCP overview without leaking secrets.
  - One Task-card generation returns provider `deerflow`.

## Assumptions

- Use automatic local DeerFlow session auth, not manual cookie entry and not disabled DeerFlow auth.
- First-boot setup is allowed only when `DEERFLOW_AUTO_SETUP=true`.
- Session state is process-local memory and is recreated after FacetWrite restarts.
- This phase does not add multi-user DeerFlow account mapping, schema migrations, ToolUse expansion, or direct DeerFlow writes to FacetWrite data.
