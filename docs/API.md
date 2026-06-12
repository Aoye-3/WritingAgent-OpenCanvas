# FacetWrite API

## Canvas Objects And Assets

- `GET /api/threads/:threadId/canvas`
  - Includes `objects` alongside nodes, semantic edges, workflow, suggestions, and pending write requests.
- `POST /api/threads/:threadId/canvas/objects`
- `PATCH /api/threads/:threadId/canvas/objects/:objectId`
- `DELETE /api/threads/:threadId/canvas/objects/:objectId`
  - CRUD for saved `arrow`, `shape`, `table`, and `asset` objects.
- `POST /api/threads/:threadId/canvas/assets`
  - Body: `{ fileName, fileBase64 }`.
  - Accepts PNG/JPEG/GIF/WebP, PDF, DOCX, TXT, and MD up to 20MB.
- `GET /api/threads/:threadId/canvas/assets/:objectId/content`
  - Returns the thread-local asset bytes for preview/download.

Canvas object writes use the shared kind-specific contract:

```json
{ "kind": "arrow", "geometry": { "startX": 10, "startY": 20, "endX": 180, "endY": 120 }, "data": {} }
{ "kind": "shape", "geometry": { "x": 10, "y": 20, "width": 220, "height": 140 }, "data": { "shapeId": "star" } }
{ "kind": "table", "geometry": { "x": 10, "y": 20, "width": 360, "height": 180 }, "data": { "rows": [["A", "B"]] } }
```

Coordinates and sizes must be finite numbers, shape ids must be registered, and table rows must be a non-empty two-dimensional string array. Invalid writes return `400 bad_request`. Asset objects cannot be created or have metadata replaced through `/canvas/objects`; clients must use `/canvas/assets`, which validates the file and generates safe thread-relative storage metadata. Asset object PATCH requests may update geometry only.

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
  - Returns `{ ok: true, schemaVersion: 3, apiContract: "facetwrite-project-first-v1" }`.
  - The frontend blocks workspace requests when either Project-first contract value is incompatible.

## Catalog
- `GET /api/tools/catalog`
  - Returns `{ tools }` from the Tool catalog.
- `GET /api/skills/catalog`
  - Returns `{ skills }` from local skill discovery.

## Knowledge
- `GET /api/knowledge/bases`
  - Returns `{ bases }` with Knowledge Base metadata and indexed item state. Secret provider values are not returned.
- `POST /api/knowledge/bases`
  - Creates a local Knowledge Base. Body may include `name`, `description`, `embeddingConfigId`, legacy `embeddingProvider`/`embeddingModel`/`embeddingBaseUrl`, chunk/search settings, and optional `rerankConfigId`.
  - New callers should choose an existing configured model API whose `modelType` is `embedding`. The backend resolves that binding's provider, model, base URL, and local key at indexing/search time.
- `GET /api/knowledge/bases/:baseId`
  - Returns `{ base }` with items.
- `PATCH /api/knowledge/bases/:baseId`
  - Updates metadata and runtime settings. Updating embedding settings clears the cached RAG application; callers should reindex when source embeddings need to be rebuilt.
- `DELETE /api/knowledge/bases/:baseId`
  - Deletes metadata and the local vector store under `.facetwrite/knowledge/<baseId>/`.
- `POST /api/knowledge/bases/:baseId/items`
  - Adds and indexes one item. Supported `type` values are `text`, `note`, `url`, `sitemap`, and `file`.
  - `text` and `note` use `content`; `url` and `sitemap` use an `http` or `https` `source`; `file` uses `fileBase64` plus `fileName`.
  - JSON request bodies are capped at 25MB. File payloads are capped at 20MB after base64 decoding and are stored under `.facetwrite/knowledge/uploads/<baseId>/`.
  - Trusted local file paths are disabled by default. They require `KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS=true` and a matching `KNOWLEDGE_ALLOWED_IMPORT_ROOTS` directory.
- `DELETE /api/knowledge/bases/:baseId/items/:itemId`
  - Deletes the item metadata and removes its loader entries from the vector store when available.
- `POST /api/knowledge/search`
  - Body: `{ query, baseIds?, limit?, threshold? }`.
  - Returns `{ results }`, where each result includes `baseId`, `baseName`, `content`, `score`, `source`, `title`, and metadata.
- `POST /api/knowledge/ask`
  - Body: `{ query, baseIds?, limit?, threshold?, locale? }`.
  - Runs a single-turn Knowledge answer for the Knowledge settings test panel. It does not save thread history and must answer from retrieved Knowledge results only.
- `POST /api/knowledge/bases/:baseId/reindex`
  - Rebuilds the vector store from stored item metadata/content.

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
  - Uses AgentBackend as the only real generation runtime. If it is disabled or unavailable, generation records Mock fallback.
  - If Agent Runtime fails without a user-visible answer, returns only internal/runtime output, or returns an empty stream, the backend records `agent_backend_runtime_failed` with `fallback:"mock"`.
  - Provider-private runtime metadata, including DeepSeek `reasoning_content`, is not part of the public request or response schema. It may be used internally for provider continuation only.
  - Direct Canvas-write intent in `chatInstruction`, such as `鍐欏叆`, `淇濆瓨鍒扮敾鏉縛, `save to canvas`, or `write this`, may cause the frontend to approve the newly returned pending Canvas write request after this endpoint completes. The API still records the request first; Canvas mutation remains behind the approve path.
  - When Agent knowledge is enabled and `knowledge_base` is active, generation searches selected Knowledge Bases before model execution. Retrieved references are injected into runtime context and recorded as `knowledge_search_completed` tool events.
- `POST /api/generate/stream`
  - SSE endpoint.
  - Emits `status`, `tool_event`, `token`, `final`, and `error` events.
  - `status` payloads include `{ phase, label }`, where phase is `thinking`, `searching`, `writing`, or `finalizing`. These events are for transient UI state and are not persisted as messages.
  - `token` events are emitted as progressive, user-visible assistant text segments after the backend safety gate has enough text to rule out obvious internal prompt, ToolUse, or reasoning leaks. Segments are intentionally small UI chunks so the right AI collaboration drawer can render a visible typewriter effect even when an upstream provider or runtime flushes a large block at once.
  - `error` payloads include `code` and `message`.
  - Agent Runtime custom subagent events from the current adapter are emitted as `tool_event` records with `eventType` prefixed by `AgentBackend_`.
  - Recoverable Agent Runtime failure is emitted as a `tool_event` with `eventType:"agent_backend_runtime_failed"` and a redacted payload containing `fallback:"mock"`.
  - The `final` payload remains the recorded `GenerateResponse`. Clients should let the chat assistant typewriter queue drain before reconciling temporary streaming text with this final thread state so the drawer does not suddenly replace a large block of content.

## Agent Runtime Configuration
- `AGENT_BACKEND_ENABLED`
  - Enables the Agent Runtime path when set to `true` or `1`.
  - Historical `DEERFLOW_ENABLED` and other `DEERFLOW_*` keys are not compatibility inputs after the AgentBackend rename. Migrate local `.env.local` values to `AGENT_BACKEND_*` and restart the API process.
- `AGENT_BACKEND_BASE_URL`
  - Agent Runtime Gateway base URL. Defaults to `http://127.0.0.1:8000`.
  - For the validated Docker sidecar path, use Agent Runtime nginx: `http://127.0.0.1:2026`.
- `AGENT_BACKEND_ASSISTANT_ID`
  - AgentBackend assistant ID. Defaults to `lead_agent`.
- `AGENT_BACKEND_AUTH_EMAIL`
  - Local AgentBackend account email used by the FacetWrite backend session helper. Never returned by status APIs.
- `AGENT_BACKEND_AUTH_PASSWORD`
  - Local AgentBackend account password used by the FacetWrite backend session helper. Never returned by status APIs.
- `AGENT_BACKEND_AUTO_SETUP`
  - Enables first-boot admin initialization through AgentBackend `/api/v1/auth/initialize` when set to `true` or `1`. Defaults to `false`.
- `AGENT_BACKEND_AUTH_TIMEOUT_MS`
  - Timeout for AgentBackend auth/setup/login requests. Defaults to `5000`.
- `FACETWRITE_INTERNAL_BASE_URL`
  - Agent Runtime-to-FacetWrite callback base URL for bridged ToolUse. Docker sidecar default is `http://host.docker.internal:8837`.
- `FACETWRITE_INTERNAL_TOOL_TOKEN`
  - Optional shared token for Agent Runtime internal ToolUse calls. When set, the runtime sends it as `x-facetwrite-tool-token`; the value is never exposed by FacetWrite APIs.
- `GET /api/agent-runtime/status`
  - Returns Agent Runtime status: enabled, baseUrl, assistantId, reachable, runtimeProvider, authState, and lastError.
  - `authState` is one of `not_configured`, `setup_required`, `authenticated`, or `auth_failed`.
  - Docker validation on 2026-05-20 confirmed this endpoint reports `enabled:true`, `reachable:true`, `runtimeProvider:"agent-backend"`, and `authState:"authenticated"` against `http://127.0.0.1:2026` after local session setup.
- `GET /api/agent-runtime/config`
  - Returns read-only Agent Runtime skills and MCP server overview.
  - Secret-like MCP values such as keys, tokens, passwords, authorization headers, and OAuth client secrets are redacted.
  - Uses the backend AgentBackend auth session for protected AgentBackend APIs. If auth fails, the route returns safe overview defaults plus `lastError`; it must not expose AgentBackend secrets or MCP environment values.
- `GET /api/agent-runtime/dashboard`
  - Returns a read-only AI Dashboard payload containing runtime status, Agent Runtime Skills/MCP overview, Lead Agent metadata, AgentCard-to-runtime subagent mappings, ToolUse bridge status, and integration maturity.
  - This endpoint must not return API keys, provider secrets, AgentBackend cookies, CSRF tokens, or MCP secret-like values.
- `GET /api/agent-runtime/memory`
  - Returns FacetWrite-managed Memory content plus each AgentCard's saved Memory enablement state.
- `PUT /api/agent-runtime/memory`
  - Body: `{ content }`. Saves editable FacetWrite-managed Memory under `.facetwrite/memory/`.
- `DELETE /api/agent-runtime/memory`
  - Clears FacetWrite-managed Memory content without deleting AgentBackend's legacy internal memory files.
- `POST /api/internal/agent-runtime/tool-call`
  - Internal service-to-service endpoint for Agent Runtime bridge tools. `/api/internal/agent-backend/tool-call` remains a compatibility alias. `/api/internal/deerflow/tool-call` is a deprecated compatibility alias for already-running legacy sidecars only.
  - Accepts only trusted local/container calls. Requests must include `x-facetwrite-internal: agent-runtime`, `agent-backend`, deprecated `deerflow`, or the configured `x-facetwrite-tool-token`.
  - Body: `{ threadId, toolName, arguments, allowedToolRefs, toolState, selectedCanvasNodeId, contextValues, chatInstruction }`.
  - Response is the direct Tool execution result `{ ok, content, payload }`; runtime bridge clients must not expect `payload.content`.
  - Reuses FacetWrite ToolUse policy and executors. Unknown tools, disabled tools, or tools not allowed by the active Agent return an `ok:false` result rather than bypassing policy.
  - `canvas_write` creates a pending Canvas write request only; it does not mutate Canvas content.
  - `canvas_write` defaults to non-destructive behavior. A requested `replace` operation is honored only when the user instruction includes an explicit replace/overwrite intent; otherwise it is normalized to append/create.
  - Agent Runtime never receives direct storage access. Product data changes must pass through FacetWrite API/service code.

Compatibility: `/api/agent-backend/status`, `/api/agent-backend/config`, and `/api/agent-backend/dashboard` remain aliases for the corresponding Agent Runtime endpoints during migration.

## Agent Runtime Auth Status
- Agent Runtime Docker sidecar health is reachable without auth at `/health`.
- Agent Runtime `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` are protected in the validated Docker runtime.
- FacetWrite does not bypass this protection. The backend performs AgentBackend setup/login through the current adapter, caches session cookie plus CSRF token in process memory, and retries once after 401/403.
- Session cookies, CSRF tokens, auth email/password, and MCP secret-like values are not exposed through FacetWrite APIs.

## Threads
- `GET /api/threads/recent`
  - Returns `{ threads }`.
- `POST /api/threads`
  - Body: `{ projectId: string, title?: string }`.
  - Creates a Project conversation, defaults the title to `New conversation`, and returns `{ thread, threadId, projectId }`.
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
  - Returns thread, sanitized messages, sanitized output versions, tool events, Canvas nodes, Canvas edges, Canvas Workflow state, Canvas Workflow suggestions, and pending Canvas write requests.
  - Internal prompt text, raw ToolUse JSON, provider-private fields such as DeepSeek `reasoning_content`, and AgentBackend replay values must not appear in `messages` or `outputVersions`; they are represented as redacted tool/runtime events when needed.
  - Runtime fallback events such as `agent_backend_runtime_failed` are returned in `toolEvents`; the only generation fallback is Mock.

## Projects
- `GET /api/projects`
  - Returns active Project summaries, model bindings, Thread counts, and asset counts.
- `GET /api/projects/trash`
  - Returns trashed project/thread summaries.
- `GET /api/projects/:projectId/threads`
  - Returns `{ threads }` containing only active conversations for that Project, ordered by `updatedAt` descending.

## Canvas
- `GET /api/threads/:threadId/canvas`
  - Resolves the Thread's Project, then returns the Project-owned `{ nodes, edges, objects, writeRequests, workflow, suggestions }`.
- `POST /api/threads/:threadId/canvas/nodes`
  - Creates a Canvas node. Body accepts the existing node draft fields: `id`, `kind`, `title`, `content`, `x`, `y`, `width`, `height`, and `metadata`. `id` is optional and is used by session undo restore paths.
  - New nodes inherit the current Canvas Workflow stage into `metadata.workflow.stage` unless the request supplies explicit workflow metadata.
- `POST /api/threads/:threadId/canvas/write-requests`
  - Creates a pending Canvas write request from explicit user action, annotated assistant snippets, or Agent runtime intent. The request is not applied until approved.
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`
  - Updates a Canvas node. Canvas V2 uses this for user-driven title/content edits, node drag position persistence, and node resize geometry persistence.
  - Updating `kind` converts a node between supported Canvas kinds. `role` is a workflow function node; AI write requests should continue to default to `document`.
  - `includeInProjectContext` explicitly controls whether the node enters Project shared context.
- `DELETE /api/threads/:threadId/canvas/nodes/:nodeId`
  - Deletes a Canvas node and removes attached directed edges.
- `POST /api/threads/:threadId/canvas/edges`
  - Creates a directed Canvas edge. Body: `{ sourceNodeId, targetNodeId, label? }`. Source and target must be different existing nodes in the same thread.
- `DELETE /api/threads/:threadId/canvas/edges/:edgeId`
  - Deletes a directed Canvas edge without changing its nodes.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/approve`
  - Applies a pending write request. The frontend can call this immediately after explicit user confirmation in the Canvas write proposal UI.
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/reject`
  - Rejects a pending write request without changing Canvas nodes.
- `PUT /api/threads/:threadId/canvas/workflow`
  - Updates project-level Canvas Workflow state. Body may include `{ stage, roles }`. `stage` must be one of `inspiration`, `research`, `structure`, `writing`, `polish`, or `publish`. Returns `{ workflow }`.
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId/workflow`
  - Updates one content node's workflow stage metadata. Body may include `{ stage }`. Legacy `{ roles }` input may still be migrated, but Role membership is no longer read from content node metadata.
- `POST /api/threads/:threadId/canvas/suggestions`
  - Creates a Role-anchored suggestion. Body: `{ roleNodeId, targetNodeId, roleId?, content, rationale? }`. The Role node must be connected to the target content node by a directed `Role -> target` edge. Returns `{ suggestion }`.
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/accept`
  - Marks a pending suggestion accepted and appends its content to the target content node body. Returns `{ suggestion }`; clients should refresh Canvas state to read updated node content.
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/ignore`
  - Marks a pending suggestion ignored without changing node content. Returns `{ suggestion }`.
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/convert-to-node`
  - Creates a new Canvas node from suggestion content, defaults to `note` unless a valid `kind` is supplied, and marks the suggestion accepted. Returns `{ suggestion, node }`.
- `GET /api/settings/canvas`
  - Returns `{ undoDepth }`. Default is 20.
- `PUT /api/settings/canvas`
  - Saves `{ undoDepth }`. `undoDepth` must be an integer from 1 to 200.

## Settings
- `GET /api/settings/status`
  - Returns the current effective provider/configuration status without exposing secret values.
- `GET /api/settings/provider-references`
  - Returns `{ providers }` from the FacetWrite model registry.
  - Provider records include id, name, type, API host, optional documentation links, default model, and static model references.
  - The response must not include API keys or logo/image resources.
- `GET /api/settings/provider-api-configs`
  - Compatibility endpoint. Returns provider-grouped summaries derived from configured model API bindings.
  - Summaries include provider id/label, whether a key exists, a short key hint, base URL, default model, enabled state, and update time. They never include API key plaintext.
- `GET /api/settings/provider-api-configs/:providerId`
  - Compatibility endpoint. Returns one provider API summary. Missing local config returns registry defaults plus `keyConfigured:false`.
- `PUT /api/settings/provider-api-configs/:providerId`
  - Body: `{ apiKey?, baseURL?, defaultModel?, enabled?, confirmLocalKeyWrite? }`.
  - Compatibility endpoint. Saves or updates a configured model API binding using `defaultModel` as the bound model. Writing or replacing `apiKey` requires `confirmLocalKeyWrite:true`.
- `DELETE /api/settings/provider-api-configs/:providerId`
  - Compatibility endpoint. Deletes configured model API bindings for that provider without touching other providers.
- `GET /api/settings/configured-model-apis`
  - Returns `{ activeConfigId?, configs }`, where every config is a local callable `API + model` binding.
  - Summaries include binding id, provider id/label, model id/name/type, key configured state, key hint, base URL, enabled state, and timestamps. API key plaintext is never returned.
- `GET /api/settings/model-runtime-sync-status`
  - Returns per-Model Config AgentBackend synchronization state: `synced`, `failed`, `unsupported`, or `disabled`. It never returns API keys.
- `POST /api/settings/model-runtime-sync/retry`
  - Retries synchronization. Failed or unsupported models remain unavailable for generation.
- `GET /api/settings/configured-model-apis/:configId`
  - Returns one redacted configured model API summary.
- `POST /api/settings/configured-model-apis`
  - Body: `{ providerId, modelId, modelName?, modelType?, apiKey?, baseURL?, enabled?, confirmLocalKeyWrite? }`.
  - Creates a new local binding in `.facetwrite/provider-apis.json`. Writing `apiKey` requires `confirmLocalKeyWrite:true`.
- `PUT /api/settings/configured-model-apis/:configId`
  - Updates one local binding. API key replacement requires `confirmLocalKeyWrite:true`; omitting `apiKey` preserves the existing key.
- `DELETE /api/settings/configured-model-apis/:configId`
  - Deletes exactly one local API/model binding.
- `POST /api/settings/provider-models`
  - Body: `{ providerId, apiKey?, baseURL? }`.
  - Fetches a remote model list through the FacetWrite backend using provider-specific strategies for OpenAI-compatible APIs, Ollama, Gemini, OpenRouter, PPIO, AIHubMix, Together, New API, GitHub Models, and Vercel AI Gateway.
  - API config precedence is request draft `apiKey/baseURL`, then that provider's saved local config, then registry defaults for non-secret fields. It must not use an unrelated global key from another provider.
  - Returns `{ providerId, models, source, error? }`, where `source` is `"remote"` or `"static"`.
  - If the remote request fails or the provider has no compatible listing endpoint, the endpoint returns registry static models with a safe error message.
- `POST /api/settings/validate`
  - Validates provider settings using request draft values first, then that provider's saved local API config.
- `POST /api/settings/save`
  - Compatibility endpoint for saving the active provider config. Internally delegates provider credential persistence to the provider API config store.
  - Writing an API key requires explicit local key write confirmation.

Implementation note: these HTTP contracts are stable while the internals move to domain modules. Provider registry, configured model API bindings, and provider model listing are served by `server/domains/model-config/`; legacy service files re-export that domain for compatibility.
# Project And Conversation APIs (2026-06-11)

- `POST /api/projects`: create an empty Project.
- `PATCH /api/projects/:projectId`: rename a Project.
- `PUT /api/projects/:projectId/models`: replace the Project's allowed Model Config IDs.
- `POST /api/threads`: create a conversation; requires a valid `projectId`.
- `GET /api/projects/:projectId/threads`: list the current Project's active conversations in most-recently-updated order.
- `PATCH /api/threads/:threadId/model`: explicitly select the conversation Model Config.
- `PATCH /api/threads/:threadId/inputs`: save Project-scoped Agent inputs; requires `agentCardId` and a monotonically increasing integer `revision`.
- `PATCH /api/threads/:threadId/output-versions/:versionId/context`: explicitly include or exclude an output version from Project shared context.
- `GET /api/threads/:threadId/state`: returns Thread history plus Project metadata, all Project Agent inputs, and Project Canvas state.

Generation requests may include `projectId` when creating a new conversation. Existing conversations derive Project and model selection from backend storage. Provider/model names supplied by the frontend are not authoritative.
