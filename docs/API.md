# FacetWrite API

## Plan Runtime

- `GET /api/threads/:threadId/plans` and `GET /api/threads/:threadId/plans/:planId` return PlanRun state, ordered steps, artifacts, and links.
- `POST /api/threads/:threadId/plans/:planId/approve` authorizes create-only Plan artifacts and starts execution.
- `POST /api/threads/:threadId/plans/:planId/answer` resumes an `awaiting_user` plan. Pending plans return to `draft`; approved plans return to `running`.
- `POST /api/threads/:threadId/plans/:planId/cancel` cancels remaining work.
- `POST /api/threads/:threadId/plans/:planId/steps/:stepId/retry` resets only that step and increments its attempt count.

`POST /api/generate/stream` retains its existing events and additionally emits compact `activity` events plus `plan_updated`, `plan_waiting_for_user`, `artifact_committed`, `run_paused`, and `run_failed` lifecycle events. Thread state is authoritative when events are duplicated or reordered.

Tool event payloads are sanitized before persistence and SSE delivery. Internal Bridge calls require `FACETWRITE_INTERNAL_TOOL_TOKEN`.

When a run uses `web_search`, completed search tool events may include sanitized `payload.sources` entries shaped as `{ title, url }`. The final visible assistant text must contain clickable source URLs; the backend appends a Sources section when possible and blocks the answer when no source URL is available.

`POST /api/threads/:threadId/plans/intake` creates a server-owned draft intake. Approval, resume, and retry routes wake the persistent Plan executor; the frontend does not run Plan steps.

The backend derives Plan phase independently of frontend flags. `/plan` forces planning-only tools; approved continuation forces Plan execution tools and a single step id. Ordinary chat keeps the active Agent's configured tool state.

## Claim Review

- `GET /api/threads/:threadId/claims`
  - Optional query: `sourceNodeId`.
  - Returns `{ claims }` ordered newest first. Claims are review candidates for the current Markdown preview, not Canvas nodes.
- `POST /api/threads/:threadId/claims/from-selection`
  - Body: `{ sourceNodeId, sourceDocumentPath, sourceFileName?, selectedText, sourceAnchor?, surroundingContext?, citationUrls? }`.
  - Creates a persisted candidate Claim from selected Markdown preview text and returns `{ claim }`.
- `POST /api/threads/:threadId/claims/extract`
  - Body: `{ sourceNodeId, sourceDocumentPath, sourceFileName?, configuredModelApiId?, maxCandidates? }`.
  - Extracts a bounded set of candidate Claims from the current Markdown preview. Extraction does not create Canvas nodes.
- `PATCH /api/threads/:threadId/claims/:claimId`
  - Body accepts `{ claimText?, evidenceText?, status? }`.
  - Updates the candidate and returns `{ claim }`. Editing text preserves `originalClaimText` and marks the candidate `edited` unless an explicit status is supplied.
- `DELETE /api/threads/:threadId/claims/:claimId`
  - Deletes the persisted candidate row and returns `{ deleted: true }`.
  - Deleting a Claim candidate does not delete any Canvas node that may already have been created from it.
- `POST /api/threads/:threadId/claims/:claimId/create-node`
  - Legacy accepted-Claim path. Creates one Canvas node only when the Claim is `accepted`.
  - Created nodes use compact `摘要 N` titles and write only `claimText` into visible node content; source path and anchor remain metadata/provenance.
- `POST /api/threads/:threadId/claims/create-nodes`
  - Legacy accepted-Claim batch path. Body may include `{ claimIds?, kind? }` and creates nodes only for accepted Claims matching the optional id filter.
  - Batch-created nodes follow the same compact title/content policy as the single create-node path.

The current Markdown preview UI uses direct user actions for `Create selected` and `Delete selected`: selected candidates are converted through the normal Canvas node creation callback, while deletion calls the persistent `DELETE` route above.
The direct UI path also creates compact document nodes: visible content is the candidate `claimText`; `evidenceText` is retained only for source fallback/highlight behavior.

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
    "code": "bad_request | not_found | internal_error | validation_failed | model_required | model_not_ready | runtime_unavailable | runtime_auth_failed",
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
  - Returns `{ skills, folders }` from local public Skill discovery. The catalog is a selection and management surface only; it does not expose Skill file bodies, private prompts, messages, or runtime context.
  - Each Skill includes `id`, `name`, `description`, `allowedTools`, `capabilityGroup`, `upstream`, `license`, `requiresEnv`, `runtimeTools`, `originalAllowedTools`, `executionMode`, `riskLevel`, `folderId`, `folderName`, `folderPath`, `relativePath`, `source`, `manageable`, and `status`.
  - `allowedTools` contains FacetWrite bridge-tool refs only. Third-party tool names are exposed as `originalAllowedTools` and mapped to Agent Runtime sandbox tool names in `runtimeTools`; they are not directly executable by the FacetWrite backend.
  - Each folder includes `folderId`, `folderName`, `folderPath`, `source`, `manageable`, and `skillCount`.
- `POST /api/skills/folders`
  - Body: `{ folderId: string }`.
  - Creates a project Skill folder under `skills/public/<folderId>` and returns a refreshed `{ skills, folders }` catalog.
- `PATCH /api/skills/folders/:folderId`
  - Body: `{ folderId: string }`.
  - Renames a manageable project Skill folder by moving the directory and returns a refreshed catalog.
- `DELETE /api/skills/folders/:folderId`
  - Deletes an empty manageable project Skill folder and returns a refreshed catalog.
- `PATCH /api/skills/:skillRef/folder`
  - Body: `{ folderId: string }`.
  - Moves a manageable project Skill into another project folder and returns a refreshed catalog.
  - Folder ids must use lowercase letters, numbers, and dashes. The protected `default` folder cannot be renamed or deleted. Runtime Skills from `modules/agent-runtime/skills/public` are read-only.

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
  - Returns `{ agentCards }`. The only default product Agent is `chat-agent` / `ChatAgent`; historical writing Agent ids are compatibility aliases, not returned as built-in templates.
- `GET /api/agent-cards/:agentCardId/settings`
  - Returns `{ settings }` for the resolved Agent card. Settings contain Prompt, Tools, Knowledge, MCP refs, and Memory; they do not contain model identity or provider credentials.
- `GET /api/agent-cards/:agentCardId/runtime-config`
  - Returns resolved Agent runtime config, including card, merged settings, available tools, tool policies, available skills, and missing/deprecated refs. It does not expose provider profile as an Agent model property.
- `PUT /api/agent-cards/:agentCardId/settings`
  - Body: `{ settings }`.
  - Saves normalized Agent profile settings and returns `{ settings, agentCard }`. Legacy `settings.model` payloads may be read for compatibility but are ignored and not written back.

## Generation
- `POST /api/generate`
  - Body is parsed by `parseGenerateRequest`.
  - `contextValues`, when present, represents explicit transient workspace state such as draft or Canvas node data. Project Brief and Current Task Brief are loaded from storage by Thread identity and are not accepted from the generation request.
  - `transientSkillRefs`, when present, is a per-request string array of public Skill ids selected from `/api/skills/catalog`. The backend trims, deduplicates, and ignores invalid entries. These Skills apply only to the current generation request and are not written to Agent settings.
  - `disabledSkillRefs`, when present, is a per-request string array of Agent/default Skill ids to disable for only this request. Server-forced Plan Skills are added after this exclusion and cannot be disabled by the UI.
  - `modelOverrides`, when present, is a per-run override for runtime-safe model controls such as `thinkingMode` and `reasoningEffort`. It does not mutate saved Agent settings.
  - Model identity is resolved from the Thread's selected `configuredModelApiId`; Agents do not own model selection.
  - Runs generation, records the result, and returns generation metadata and output.
  - Uses Agent Runtime as the only real generation path. Runtime/model failures return stable error codes and do not record an assistant message, output version, or Mock result.
  - Mock fallback is disabled by default and exists only when `FACETWRITE_MOCK_FALLBACK_ENABLED=true` is explicitly configured.
  - Provider-private runtime metadata, including DeepSeek `reasoning_content`, is not part of the public request or response schema. It may be used internally for provider continuation only.
  - Direct Canvas-write intent in `chatInstruction`, such as `鍐欏叆`, `淇濆瓨鍒扮敾鏉縛, `save to canvas`, or `write this`, may cause the frontend to approve the newly returned pending Canvas write request after this endpoint completes. The API still records the request first; Canvas mutation remains behind the approve path.
  - When Agent knowledge is enabled and `knowledge_base` is active, generation searches selected Knowledge Bases before model execution. Retrieved references are injected into runtime context and recorded as `knowledge_search_completed` tool events.
- `POST /api/generate/stream`
  - Request body accepts `runtimeBudgetProfile?: "low" | "medium" | "high"`. When omitted, generation uses the current Project runtime settings; when present, the value is a one-run composer override. The value controls the Agent Runtime recursion limit, model-call budget, evidence-tool budget, body-draft write budget, and synthesis reserve for the single request; it does not change model thinking settings. Progressive runs send both FacetWrite budget context and top-level LangGraph `config.recursion_limit`; the Runtime Gateway mirrors `facetwrite_recursion_limit` to the top-level config when the top-level value would otherwise remain the default.
  - SSE endpoint.
  - Emits `status`, `tool_event`, `timeline_event`, `token`, `final`, and `error` events.
  - `status` payloads include `{ phase, label }`, where phase is `thinking`, `searching`, `writing`, or `finalizing`. These events are for transient UI state and are not persisted as messages.
  - `timeline_event` payloads are safe, user-visible Run Trace summaries attached to the current assistant message. Composer-selected transient Skill usage is represented as a `decision` event with a summary such as `Using skills: frontend-design, writing-plans` and a sanitized payload shaped as `{ source:"composer", skillRefs:[...] }`.
  - `token` events are emitted as progressive, user-visible assistant text segments after the backend safety gate has enough text to rule out obvious internal prompt, ToolUse, or reasoning leaks. Segments are intentionally small UI chunks so the right AI collaboration drawer can render a visible typewriter effect even when an upstream provider or runtime flushes a large block at once.
  - `error` payloads include `code` and `message`.
  - Agent Runtime custom subagent events from the current adapter are emitted as `tool_event` records with `eventType` prefixed by `AgentBackend_`.
  - Agent Runtime evidence-tool lifecycle payloads may include sanitized `query`, `url`, `path`, `snippet`, `summary`, and `sources` fields. `sources` entries are limited to user-safe `{ title, url, snippet? }` data for citations and Canvas delivery; raw tool JSON, prompts, request headers, provider reasoning, full shell output, environment variables, and credentials must not be forwarded.
  - Repeated tool lifecycle events are detailed runtime timeline data, not chat transcript messages. Clients should aggregate same-tool progress into the current streaming assistant status and keep full event detail in the Tool event timeline.
  - Canvas, Plan, and Artifact lifecycle `tool_event` records, such as `canvas_mutation_committed`, `canvas_write_pending_approval`, `canvas_mutation_failed`, `canvas_delivery_outline_started`, `canvas_delivery_outline_committed`, `canvas_delivery_research_committed`, `canvas_delivery_body_checkpoint_committed`, `canvas_delivery_synthesis_started`, `canvas_delivery_body_final_committed`, `canvas_delivery_failed_summary_committed`, `agent_backend_plan_waiting_for_user`, and `artifact_committed`, are live state hints. Clients may refresh Thread state immediately for committed Canvas changes or pending Plan clarification so Canvas/Plan surfaces update while assistant text is still streaming.
  - `agent_backend_plan_waiting_for_user` means a Plan clarification is pending in Thread state. The client must render the structured clarification form from the persisted Plan state; the acknowledgement text is conversation-only and must not be treated as Canvas body or final delivery content.
  - Agent Runtime `ask_clarification` tool calls are adapted into `agent_backend_agent_clarification_requested` events and mirrored as waiting run timeline events. The adapter accepts the middleware-owned structured ToolMessage `artifact` or `additional_kwargs.facetwrite_clarification`, and complete structured tool-call args, including JSON-string `args`. Empty or partial streamed tool-call chunks are ignored until a structured payload is available. The right composer derives its button choice card from that structured timeline payload. These clarifications are conversation input state, not Canvas delivery content; ordinary Markdown or prose option lists in assistant text, formatted ToolMessage content, and partial chunks are not parsed into buttons. For Skill scope clarification, the event payload includes `resumeContext` with the original instruction, transient Skills, disabled Skills, effective runtime budget profile, and Canvas workflow; clients must preserve those values when sending the selected answer. If Runtime emits only a partial `resumeContext`, the generation service fills missing fields before forwarding the event. Invalid Agent clarification payloads are diagnostics only and may expose safe fields such as `reason`, `hasQuestion`, `optionCount`, and `optionShape`; clients must not render empty choice cards from them.
  - Requests that enable a research-scope Skill and look like under-scoped research/search tasks run a server scope guard. Guarded Skills include `database-lookup`, `paper-lookup`, `literature-review`, `systematic-literature-review`, `deep-research`, `github-deep-research`, `citation-management`, `newsletter-generation`, and `consulting-analysis`. If the request lacks an answered `requestContext.agentClarification`, the backend still invokes AgentBackend with the loaded Skill context, but phase one sets `facetwrite_clarification_phase:"clarification_guard"`, exposes only `ask_clarification`, disables thinking/reasoning controls for the forced-tool call, and removes Canvas/progressive/file/evidence delivery context from the Runtime request. Evidence tools such as `web_search`, `web_fetch`, and `knowledge_base` are unavailable until the user answers, and the first guarded run must not create Canvas nodes. The clarification wording is Runtime/Skill-driven, not a deterministic server option template. After the answer, the next request restores the original provider thinking settings, Skills, effective budget, Canvas workflow, and progressive delivery eligibility.
  - Current progressive Canvas semantics: `canvas_delivery_body_checkpoint_committed` updates only the stable `正文草稿` / `Body draft` node and is bounded by `bodyDraftWriteLimit`. It does not update the final `正文` / `Body` node. Checkpoint live payloads are hints (`nodeId`, `title`, `displayTitle`, `contentPreview`, `contentHash`); clients refresh Thread state for full node content. Only `canvas_delivery_body_final_committed` means final assistant content was written to the stable final body node.
  - `canvas_delivery_research_committed` means a progressive research/progress node was committed during a server-owned long-task Canvas delivery run. `canvas_delivery_synthesis_started` means a runtime budget threshold was reached and the run should stop intermediate Canvas writes and enter final synthesis. Intermediate events remain recoverable work only; the run still requires final assistant content or a valid final structured Plan/Artifact/Canvas lifecycle outcome to be recorded as successful. `canvas_delivery_failed_summary_committed` means the server preserved a visible failure summary node before returning the runtime error.
  - Agent Runtime failure is emitted as a `tool_event` with `eventType:"agent_backend_runtime_failed"` and a redacted diagnostic payload. The request then ends with a stable error code; no Mock message or output version is recorded unless the explicit test-only fallback flag is enabled.
  - The `final` payload remains the recorded `GenerateResponse`. Clients should let the chat assistant typewriter queue drain before reconciling temporary streaming text with this final thread state so the drawer does not suddenly replace a large block of content.

## Agent Runtime Configuration
- `AGENT_BACKEND_ENABLED`
  - Enables the Agent Runtime path when set to `true` or `1`.
  - Historical `DEERFLOW_ENABLED` and other `DEERFLOW_*` keys are not compatibility inputs after the AgentBackend rename. Migrate local `.env.local` values to `AGENT_BACKEND_*` and restart the API process.
- `AGENT_BACKEND_BASE_URL`
  - Agent Runtime Gateway base URL. The recommended local App Shell path uses `http://127.0.0.1:8001`.
  - Explicit Docker isolation mode uses Agent Runtime nginx at `http://127.0.0.1:2026`.
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
  - Agent Runtime-to-FacetWrite callback base URL for bridged ToolUse. Local App Shell uses `http://127.0.0.1:17777`; Docker mode uses `http://host.docker.internal:8837`.
- `FACETWRITE_INTERNAL_TOOL_TOKEN`
  - Optional shared token for Agent Runtime internal ToolUse calls. When set, the runtime sends it as `x-facetwrite-tool-token`; the value is never exposed by FacetWrite APIs.
- `GET /api/agent-runtime/status`
  - Returns Agent Runtime status: enabled, baseUrl, assistantId, reachable, runtimeProvider, authState, and lastError.
  - `authState` is one of `not_configured`, `setup_required`, `authenticated`, or `auth_failed`.
  - The response also exposes `deploymentMode` and `sandboxProvider`, so callers can distinguish the recommended local Gateway from explicit Docker isolation.
  - `reachable:true` only proves that the Gateway/status path answered. Full generation also requires AgentBackend to load the configured Lead Agent and every active `tools[*].use` target from `modules/agent-runtime/config.yaml`.
- `GET /api/agent-runtime/config`
  - Returns read-only Agent Runtime skills and MCP server overview.
  - Secret-like MCP values such as keys, tokens, passwords, authorization headers, and OAuth client secrets are redacted.
  - Agent profiles may save references to these already configured MCP server ids. This API is not an MCP installation or editing surface.
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
  - Active Agent Runtime bridge config must match FacetWrite's current tool contracts: `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`. `quick_messages` is not an accepted current bridge tool, and stale config references are treated as runtime configuration failures.
  - `canvas_write` follows operation-level risk policy. Low-risk create/append operations may return a committed node result; replace, delete, and other destructive operations remain pending for approval.
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
  - Creates a Project conversation, resolves and persists a valid chat Model Config, defaults the title to `New conversation`, and returns `{ thread, threadId, projectId }`.
- `POST /api/threads/:threadId/context-reset`
  - Preserves messages and UI history, persists `contextResetAt`, and makes later model requests read only messages after the boundary.
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
  - Returns thread, sanitized messages, sanitized output versions, tool events, Canvas nodes, Canvas edges, Canvas Workflow state, Canvas Workflow suggestions, pending Canvas write requests, ordinary Canvas write suggestions, Plans, and Plan activities.
  - Internal prompt text, raw ToolUse JSON, provider-private fields such as DeepSeek `reasoning_content`, and AgentBackend replay values must not appear in `messages` or `outputVersions`; they are represented as redacted tool/runtime events when needed.
  - Runtime fallback events such as `agent_backend_runtime_failed` are returned in `toolEvents`; the only generation fallback is Mock.

## Projects
- `GET /api/projects`
  - Returns active Project summaries, model bindings, Thread counts, and asset counts.
- `GET /api/projects/trash`
  - Returns trashed project/thread summaries.
- `GET /api/projects/:projectId/threads`
  - Returns `{ threads }` containing only active conversations for that Project, ordered by `updatedAt` descending.
- `GET /api/projects/:projectId/runtime-settings`
  - Returns `{ settings }` for this Project's Agent run budget. Defaults are medium when the Project has no saved row.
- `PUT /api/projects/:projectId/runtime-settings`
  - Body: `{ runtimeBudgetProfile, evidenceToolLimit, bodyDraftWriteLimit, modelCallLimit, recursionLimit, synthesisReserveSteps }`.
  - Saves only the addressed Project. Composer profile buttons may override the profile for one request but do not mutate this setting.

## Canvas
- `GET /api/threads/:threadId/canvas`
  - Resolves the Thread's Project, then returns the Project-owned `{ nodes, edges, objects, writeRequests, workflow, suggestions }`.
- `POST /api/threads/:threadId/canvas/nodes`
  - Creates a Canvas node. Body accepts the existing node draft fields: `id`, `kind`, `title`, `content`, `x`, `y`, `width`, `height`, and `metadata`. `id` is optional and is used by session undo restore paths.
  - New nodes inherit the current batch-delivery stage into `metadata.workflow.stage` unless the request supplies explicit workflow metadata.
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
  - Updates project-level Canvas Workflow state. Body may include `{ mode, stage, roles }`. `mode` currently supports `batch_delivery`; `stage` must be one of `inspiration`, `research`, `structure`, `writing`, `polish`, or `publish`. Returns `{ workflow }`.
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId/workflow`
  - Updates one content node's batch-step metadata. Body may include `{ stage }`. Legacy `{ roles }` input may still be migrated, but Role membership is no longer read from content node metadata.
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
  - Summaries include binding id, provider id/label, model id/name/type, `capabilityGroup`, key configured state, key hint, base URL, enabled state, and timestamps. API key plaintext is never returned.
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
- `PUT /api/projects/:projectId/models`: compatibility API for historical Project model bindings; current generation and UI do not depend on it.
- `POST /api/threads`: create a conversation; requires a valid `projectId`.
- `GET /api/projects/:projectId/threads`: list the current Project's active conversations in most-recently-updated order.
- `PATCH /api/threads/:threadId/model`: explicitly select the conversation Model Config.
- `POST /api/threads/:threadId/context-reset`: persist a soft context boundary without deleting visible history.
- `PATCH /api/projects/:projectId/brief`: save the Project-owned Project Brief with `{ brief, revision }`.
- `PATCH /api/threads/:threadId/task-brief`: save the Thread-owned Current Task Brief with `{ brief, revision }`.
- `PATCH /api/threads/:threadId/output-versions/:versionId/context`: explicitly include or exclude an output version from Project shared context.
- `GET /api/threads/:threadId/state`: returns Thread history plus Project metadata, Project Brief, Current Task Brief, their revisions, and Project Canvas state.

Generation requests may include `projectId` when creating a new conversation. Existing conversations derive Project and model selection from backend storage. Provider/model names supplied by the frontend are not authoritative.

Explicit Canvas instructions are converted server-side into a structured `canvasAction`. Internal Runtime Bridge calls always resolve `projectId` from `threadId`; a mismatched Runtime-supplied project is rejected. `canvas_write` returns either `{ status:"committed", nodeId, projectId, operation }` for create/append or `{ status:"pending", requestId, projectId, operation }` for destructive writes.

Streaming generation is client-cancellable. The frontend passes an `AbortSignal` into the `/api/generate/stream` request and marks the active assistant message as `stopped` when the user cancels. AgentBackend requests are created with `on_disconnect:"cancel"`, so a client disconnect cancels the active runtime run instead of letting it continue invisibly. Cancellation is a transport/run control; persistent Plan state remains the source of truth for whether a Plan is awaiting clarification, awaiting approval, paused, failed, or ready to retry.

## Plan Clarification API

Plan generation uses phase-scoped contracts: `plan_clarification_submit`, `plan_revision_submit`, and approved-step-only `artifact_stage`. Generation requests may carry explicit `planPhase`, `planId`, and `stepId`. `POST /api/threads/:threadId/plans/:planId/answer` accepts `optionId`, `customAnswer`, or legacy text `answer`; pause, resume, activities, and Canvas projection endpoints persist recovery state.

`plan_clarification_submit.options` contains 2-3 objects. Every option requires `id`, `label`, `description`, and boolean `recommended`; exactly one option must set `recommended: true`. Invalid submissions return a structured `plan_submission_failed` bridge event with a stable `reason` such as `invalid_clarification`, the intake `planId` when available, and a safe summary. They do not produce a successful Plan lifecycle event.

Pending clarification is a UI form state, not only assistant prose. After intake persists an `awaiting_user` Plan with `clarification.status:"pending"`, refreshed thread state must populate `plans` and `planActivities` in the frontend. The composer area renders the active clarification as a required selection form: question title, 2-3 option buttons, one recommended badge, option detail exposed through hover/focus tooltip and accessible labels, plus an "Other" free-text path. The ordinary textarea is secondary/disabled while this form is pending. Assistant text may provide a short transition, but the option form is the authoritative decision surface.

Choosing an option posts to the existing answer endpoint and immediately starts the revise phase. The next generation request carries the full selected context in `contextValues.awaitingPlan`, for example `{ id, optionId, answer, option: { id, label, description, recommended } }`. The free-text path carries `{ id, customAnswer, answer }` and does not invent an `optionId`. This preserves the public Plan answer API while making the user's click available to AgentBackend as structured context.

AgentBackend run context uses an explicit FacetWrite field allowlist. Plan identifiers are sent as `facetwrite_plan_id`, `facetwrite_plan_step_id`, and `facetwrite_plan_phase_attempt_id`; `facetwrite_context_values.planGeneration` remains a compatibility fallback. Request-level `facetwrite_allowed_tool_refs` and `facetwrite_tool_state` are authoritative for model-visible tools. Intake exposes only `plan_clarification_submit`, revision exposes only `plan_revision_submit`, and disabled tools are removed before every model call.

Approval-ready Plans are projected to a `kind:"plan"` Canvas node. The node is a recoverable projection of Plan state, not the source of truth: it contains title, goal, overall status, current step, committed artifact count, and a checklist of steps. The projection is refreshed when the Plan is revised, approved, paused, resumed, failed, when a step changes status, and when an artifact is committed. Deleting the Canvas node does not delete the Plan; the next projection refresh may create a replacement and update `canvas_node_id`.

`artifact_stage` remains the only Canvas write path during approved Plan execution. For text artifacts, `payload.content` is still accepted, but `payload.sections` or `payload.items` is preferred:

```json
{
  "artifactId": "decision_framework",
  "stepId": "compare",
  "type": "text",
  "title": "Decision framework",
  "payload": {
    "sections": [
      { "id": "m4_if", "title": "Prefer M4 if", "content": "..." },
      { "id": "m3_if", "title": "Prefer M3 if", "content": "..." }
    ]
  }
}
```

Each section is projected as one semantic Canvas node. Only an individual overlong section is paginated; generated pages are linked with `continues` edges. Artifact nodes are linked from the Plan projection node, and explicit `artifact_stage.links` are committed as Canvas edges after both endpoint artifacts have committed nodes. Plan execution does not create ordinary `CanvasWriteSuggestion` prompts and does not ask for a second "create nodes" confirmation after the Plan has been approved.

Ordinary reply Canvas suggestions are persisted in thread state and controlled through:

- `POST /api/threads/:threadId/canvas/write-suggestions/:suggestionId/accept`
- `POST /api/threads/:threadId/canvas/write-suggestions/:suggestionId/dismiss`
