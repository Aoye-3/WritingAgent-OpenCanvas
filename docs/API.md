# FacetWrite API

## Response Shape
Successful responses return the route payload directly. Errors use:

```json
{
  "error": {
    "code": "bad_request | not_found | internal_error | validation_failed",
    "message": "Human-readable message",
    "details": {}
  }
}
```

The implementation lives in `server/utils/http.ts`.

Request contract validation errors should return HTTP 400 with `code:"bad_request"`. Unexpected runtime failures should return HTTP 500 with `code:"internal_error"`. Streaming generation reports the same code in its SSE `error` event payload.

## Health
- `GET /api/health`
  - Returns server health.

## Catalog
- `GET /api/tools/catalog`
  - Returns `{ tools }` from the Tool catalog.
- `GET /api/skills/catalog`
  - Returns `{ skills }` from local skill discovery.

## Agent Cards
- `GET /api/agent-cards`
  - Returns `{ agentCards }`.
- `GET /api/agent-cards/:agentCardId/settings`
  - Returns `{ settings }` for the resolved Agent card.
- `GET /api/agent-cards/:agentCardId/runtime-config`
  - Returns resolved Agent runtime config, including card, merged settings, available tools, tool policies, available skills, and missing/deprecated refs.
- `PUT /api/agent-cards/:agentCardId/settings`
  - Body: `{ settings }`.
  - Saves normalized settings and returns `{ settings, agentCard }`.

## Generation
- `POST /api/generate`
  - Body is parsed by `parseGenerateRequest`.
  - `contextValues`, when present, represents explicit left AgentCard structured inputs and current workspace state such as draft or Canvas node data. It must not contain bottom-bar placeholder content or historical defaults such as course notes or audience profiles.
  - `modelOverrides`, when present, is a per-run override for runtime-safe model controls such as `thinkingMode` and `reasoningEffort`. It does not mutate saved Agent settings.
  - Runs generation, records the result, and returns generation metadata and output.
  - Uses DeerFlow as the runtime when `DEERFLOW_ENABLED=true`; otherwise uses the current TypeScript provider runtime.
  - If DeerFlow fails without a user-visible answer, returns only internal/runtime output, or returns an empty stream, the backend records a `deerflow_runtime_failed` tool event and continues with the Provider runtime before considering Mock fallback.
  - Provider-private runtime metadata, including DeepSeek `reasoning_content`, is not part of the public request or response schema. It may be used internally for provider continuation only.
- `POST /api/generate/stream`
  - SSE endpoint.
  - Emits `tool_event`, `token`, `final`, and `error` events.
  - `error` payloads include `code` and `message`.
  - DeerFlow custom subagent events are emitted as `tool_event` records with `eventType` prefixed by `deerflow_`.
  - Recoverable DeerFlow-to-Provider fallback is emitted as a `tool_event` with `eventType:"deerflow_runtime_failed"` and a redacted payload containing `fallback:"provider"`.

## DeerFlow Runtime Configuration
- `DEERFLOW_ENABLED`
  - Enables the DeerFlow runtime path when set to `true` or `1`.
- `DEERFLOW_BASE_URL`
  - DeerFlow Gateway base URL. Defaults to `http://127.0.0.1:8000`.
  - For the validated Docker sidecar path, use DeerFlow nginx: `http://127.0.0.1:2026`.
- `DEERFLOW_ASSISTANT_ID`
  - DeerFlow assistant ID. Defaults to `lead_agent`.
- `DEERFLOW_AUTH_EMAIL`
  - Local DeerFlow account email used by the FacetWrite backend session helper. Never returned by status APIs.
- `DEERFLOW_AUTH_PASSWORD`
  - Local DeerFlow account password used by the FacetWrite backend session helper. Never returned by status APIs.
- `DEERFLOW_AUTO_SETUP`
  - Enables first-boot admin initialization through DeerFlow `/api/v1/auth/initialize` when set to `true` or `1`. Defaults to `false`.
- `DEERFLOW_AUTH_TIMEOUT_MS`
  - Timeout for DeerFlow auth/setup/login requests. Defaults to `5000`.
- `FACETWRITE_INTERNAL_BASE_URL`
  - DeerFlow-to-FacetWrite callback base URL for bridged ToolUse. Docker sidecar default is `http://host.docker.internal:8787`.
- `FACETWRITE_INTERNAL_TOOL_TOKEN`
  - Optional shared token for DeerFlow internal ToolUse calls. When set, DeerFlow sends it as `x-facetwrite-tool-token`; the value is never exposed by FacetWrite APIs.
- `GET /api/deerflow/status`
  - Returns DeerFlow runtime status: enabled, baseUrl, assistantId, reachable, runtimeProvider, authState, and lastError.
  - `authState` is one of `not_configured`, `setup_required`, `authenticated`, or `auth_failed`.
  - Docker validation on 2026-05-15 confirmed this endpoint reports `reachable:true` and `authState:"authenticated"` against `http://127.0.0.1:2026` after local session setup.
- `GET /api/deerflow/config`
  - Returns read-only DeerFlow skills and MCP server overview.
  - Secret-like MCP values such as keys, tokens, passwords, authorization headers, and OAuth client secrets are redacted.
  - Uses the backend DeerFlow auth session for protected DeerFlow APIs. If auth fails, the route returns safe overview defaults plus `lastError`; it must not expose DeerFlow secrets or MCP environment values.
- `GET /api/deerflow/dashboard`
  - Returns a read-only AI Dashboard payload containing runtime status, DeerFlow Skills/MCP overview, Lead Agent metadata, AgentCard-to-DeerFlow subagent mappings, ToolUse bridge status, and integration maturity.
  - This endpoint must not return API keys, provider secrets, DeerFlow cookies, CSRF tokens, or MCP secret-like values.
- `POST /api/internal/deerflow/tool-call`
  - Internal service-to-service endpoint for DeerFlow bridge tools.
  - Accepts only trusted local/container calls. Requests must include `x-facetwrite-internal: deerflow` or the configured `x-facetwrite-tool-token`.
  - Body: `{ threadId, toolName, arguments, allowedToolRefs, toolState, selectedCanvasNodeId, contextValues, chatInstruction }`.
  - Reuses FacetWrite ToolUse policy and executors. Unknown tools, disabled tools, or tools not allowed by the active Agent return an `ok:false` result rather than bypassing policy.
  - `canvas_write` creates a pending Canvas write request only; it does not mutate Canvas content.

## DeerFlow Auth Status
- DeerFlow Docker sidecar health is reachable without auth at `/health`.
- DeerFlow `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` are protected in the validated Docker runtime.
- FacetWrite does not bypass this protection. The backend performs DeerFlow setup/login, caches session cookie plus CSRF token in process memory, and retries once after 401/403.
- Session cookies, CSRF tokens, auth email/password, and MCP secret-like values are not exposed through FacetWrite APIs.

## Threads
- `GET /api/threads/recent`
  - Returns `{ threads }`.
- `POST /api/threads`
  - Body may include `agentCardId` and optional safe `threadId`.
  - Ensures the thread exists and returns `{ threadId, agentCardId }`.
- `PATCH /api/threads/:threadId`
  - Body: `{ title: string }`.
  - Renames an active thread/project by updating `threads.title` and `updated_at`.
  - Titles are trimmed, must be non-empty, and are limited to 120 characters.
  - Returns `{ thread }`; missing or trashed threads return 404.
- `POST /api/threads/batch-trash`
  - Body: `{ threadIds: string[] }`.
  - Moves active threads to trash and returns `{ ok, results, movedCount }`.
  - Empty or invalid arrays return HTTP 400.
- `POST /api/threads/batch-delete`
  - Body: `{ threadIds: string[] }`.
  - Permanently deletes trashed threads and returns `{ ok, results, deletedCount }`.
  - Threads must already be in trash; empty or invalid arrays return HTTP 400.
- `POST /api/threads/:threadId/trash`
  - Soft-deletes a thread.
- `POST /api/threads/:threadId/restore`
  - Restores a trashed thread.
- `DELETE /api/threads/:threadId`
  - Permanently deletes a thread only after it is in trash.
- `GET /api/threads/:threadId/messages`
  - Returns `{ messages }`.
- `GET /api/threads/:threadId/state`
  - Returns thread, sanitized messages, sanitized output versions, tool events, Canvas nodes, and pending Canvas write requests.
  - Internal prompt text, raw ToolUse JSON, provider-private fields such as DeepSeek `reasoning_content`, and DeerFlow replay values must not appear in `messages` or `outputVersions`; they are represented as redacted tool/runtime events when needed.
  - Runtime fallback events such as `deerflow_runtime_failed` are returned in `toolEvents` so the UI can show when a run switched from DeerFlow to the Provider runtime.

## Projects
- `GET /api/projects`
  - Returns active project/thread summaries. `title` is the custom thread/project title; Agent display name remains available as Agent metadata.
- `GET /api/projects/trash`
  - Returns trashed project/thread summaries.

## Canvas
- `GET /api/threads/:threadId/canvas`
  - Returns `{ nodes, writeRequests }` for an active thread.
- `POST /api/threads/:threadId/canvas/nodes`
  - Creates a Canvas node.
- `POST /api/threads/:threadId/canvas/write-requests`
  - Creates a pending Canvas write request from explicit user action, annotated assistant snippets, or Agent runtime intent. The request is not applied until approved.
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`
  - Updates a Canvas node.
- `DELETE /api/threads/:threadId/canvas/nodes/:nodeId`
  - Deletes a Canvas node.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/approve`
  - Applies a pending write request. The frontend can call this immediately after explicit user confirmation in the Canvas write proposal UI.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/reject`
  - Rejects a pending write request without changing Canvas nodes.

## Settings
- `GET /api/settings/status`
  - Returns local provider/configuration status without exposing secret values.
- `POST /api/settings/validate`
  - Validates provider settings.
- `POST /api/settings/save`
  - Saves settings. Writing an API key requires explicit local key write confirmation.
