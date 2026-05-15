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
  - Runs generation, records the result, and returns generation metadata and output.
- `POST /api/generate/stream`
  - SSE endpoint.
  - Emits `tool_event`, `token`, `final`, and `error` events.

## Threads
- `GET /api/threads/recent`
  - Returns `{ threads }`.
- `POST /api/threads`
  - Body may include `agentCardId` and optional safe `threadId`.
  - Ensures the thread exists and returns `{ threadId, agentCardId }`.
- `POST /api/threads/:threadId/trash`
  - Soft-deletes a thread.
- `POST /api/threads/:threadId/restore`
  - Restores a trashed thread.
- `DELETE /api/threads/:threadId`
  - Permanently deletes a thread only after it is in trash.
- `GET /api/threads/:threadId/messages`
  - Returns `{ messages }`.
- `GET /api/threads/:threadId/state`
  - Returns thread, messages, output versions, tool events, Canvas nodes, and pending Canvas write requests.

## Projects
- `GET /api/projects`
  - Returns active project/thread summaries.
- `GET /api/projects/trash`
  - Returns trashed project/thread summaries.

## Canvas
- `GET /api/threads/:threadId/canvas`
  - Returns `{ nodes, writeRequests }` for an active thread.
- `POST /api/threads/:threadId/canvas/nodes`
  - Creates a Canvas node.
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`
  - Updates a Canvas node.
- `DELETE /api/threads/:threadId/canvas/nodes/:nodeId`
  - Deletes a Canvas node.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/approve`
  - Applies a pending write request.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/reject`
  - Rejects a pending write request without changing Canvas nodes.

## Settings
- `GET /api/settings/status`
  - Returns local provider/configuration status without exposing secret values.
- `POST /api/settings/validate`
  - Validates provider settings.
- `POST /api/settings/save`
  - Saves settings. Writing an API key requires explicit local key write confirmation.

