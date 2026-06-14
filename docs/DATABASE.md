# FacetWrite Database

## Plan Tables

- `plan_runs`: thread task goal, approval, overall status, status message, and optional run mapping.
- `plan_steps`: ordered sequential steps with status, attempts, timestamps, detail, and error.
- `plan_artifacts`: stable-id text/image artifacts with source/layout metadata and Canvas target mapping.
- `plan_artifact_links`: stable-id directed artifact links and committed Canvas edge mapping.

Clarification revises the same pending `plan_runs` row. Artifact upserts use `(plan_run_id, id)` and committed targets are retained, preventing replayed or reordered events from duplicating Canvas content.

## Location
FacetWrite stores local runtime data in SQLite:

```text
.facetwrite/data/facetwrite.db
```

SQLite initialization lives in `server/db/sqlite.ts`. It enables WAL mode and foreign keys before schema migration.

The default app root is `.facetwrite`. Tests and e2e runs may override it with `FACETWRITE_APP_ROOT`; Playwright uses `.facetwrite-test/e2e` when it starts its own dev server.

Thread-specific local folders are created under:

```text
.facetwrite/threads/<threadId>/user-data/
  workspace/
  uploads/
  outputs/
```

Thread IDs and node/request IDs are validated before filesystem operations so data stays inside the resolved app root.

Knowledge Base vector stores and uploads are created under:

```text
.facetwrite/knowledge/<baseId>/vectors.db
.facetwrite/knowledge/uploads/<baseId>/
```

## Tables
- `schema_version`
  - Tracks local schema version and application time.
- `projects`
  - Top-level workspace records. New Projects start with no content context; their first Thread resolves a valid default chat model.
- `threads`
  - Conversations belonging to one Project, with `configured_model_api_id` and optional `context_reset_at`. The reset boundary preserves history while excluding older messages from later model context.
- `project_briefs`
  - One optional Project Brief JSON payload per Project, with autosave revision and update timestamp.
- `thread_task_briefs`
  - One optional Current Task Brief JSON payload per Thread, with autosave revision and update timestamp.
- `messages`
  - User and assistant messages for a thread.
- `runs`
  - Generation runs with mode, provider, mock status, status, error, and timestamp.
- `agent_cards`
  - Persisted AgentCard payload snapshots.
- `skills`
  - Reserved table for skill payload metadata.
- `prompt_versions`
  - Prompt snapshots connected to runs.
- `output_versions`
  - Generated output versions connected to runs.
- `tool_events`
  - Tool and run events stored as JSON payloads. `web_search` events may include sanitized `sources` arrays with title and URL only; raw search result payloads and secrets must not be persisted.
- `settings`
  - Generic settings key/value table.
- `agent_settings`
  - Per-Agent profile settings JSON payloads: Prompt, Tools, Knowledge, MCP refs, and Memory. Model identity and provider credentials are not stored here; legacy `payload_json.model` is ignored during normalization and is not written back.
- `canvas_nodes`
  - Project-owned Canvas node state, including `project_id` and `include_in_project_context`.
- `canvas_objects`
  - Saved non-semantic board artifacts. `kind` is `arrow`, `shape`, `table`, or `asset`; geometry and type-specific data are stored as JSON.
- `canvas_workflows`
  - One project-level Canvas Workflow row per thread with current stage, Role library JSON, and update timestamp.
- `canvas_workflow_suggestions`
  - Role-anchored suggestions with role node id, target content node id, role id, content, rationale, pending/accepted/ignored status, and timestamps.
- `canvas_write_requests`
  - Pending/approved/rejected Agent write requests for Canvas changes.
- `knowledge_bases`
  - Server-owned Knowledge Base metadata: embedding provider/model/base URL, chunk/search settings, optional rerank settings, status, and timestamps.
- `knowledge_items`
  - Indexed source metadata for text, note, URL, sitemap, and file items. Vector chunks live in the per-base libSQL vector store.
- `knowledge_item_events`
  - Audit trail for base creation, item indexing, indexing failures, search failures, rerank fallback, and deletion.

## Canvas Write Semantics
`canvas_write_requests` is the safety buffer between Agent output and user data mutation.

- `create` creates a new Canvas node on approval.
- `replace` replaces an existing node on approval.
- `append` appends to an existing node on approval.
- `pending` requests are shown to the user.
- `approved` requests are applied and marked approved.
- `rejected` requests are not applied.

The current frontend labels these as Canvas write proposals. This changes the interaction model, not the schema: proposed writes still enter `canvas_write_requests` and only mutate `canvas_nodes` through the approve path.

Temporary assistant-message annotations are not persisted. Annotated snippets and highlight state live in React state only and are cleared after write, cancel, or page refresh.

Direct user write intent does not add a new table or bypass the request table. The frontend can auto-approve only newly created pending requests from the same generation run, so `canvas_write_requests` remains the audit/safety buffer even when the UI feels like a direct write.

Canvas V2 stores node geometry in the existing `x`, `y`, `width`, and `height` fields. Dragging updates position; resizing updates dimensions and may also update position when resizing from north or west handles. These are presentation/editor interactions and do not require a schema migration.

Canvas Workflow stores the project/thread current writing stage in `canvas_workflows.stage`. Per-node stage is stored in `canvas_nodes.metadata.workflow.stage`. Role behavior is represented by first-class `role` rows in `canvas_nodes`, `metadata.workflowRole`, and directed `Role -> content` rows in `canvas_edges`. Legacy `metadata.workflow.roles` is migration input only and is removed from content nodes after Role nodes and edges are created. New content nodes inherit the current workflow stage when created.

Canvas Workflow suggestions are separate rows in `canvas_workflow_suggestions` because they have their own status lifecycle. Suggestions are anchored to the Role node (`role_node_id`) but keep the target content node (`target_node_id`). Accepting appends suggestion content to the target node and marks the suggestion accepted. Ignoring changes only suggestion status. Converting creates a new node from the suggestion and marks it accepted.

Canvas pan, drag, resize, and hit testing are presentation-only. React Flow viewport state, selected node state, visual grid, resize handles, and future decorative overlays should not introduce persistence changes or new node state; they must remain separate from `canvas_nodes` unless they represent an explicit saved user artifact.

Free arrows, shapes, tables, and asset cards are explicit saved user artifacts and therefore live in `canvas_objects`. They never create `canvas_edges` implicitly. Asset bytes live under `.facetwrite/threads/<threadId>/user-data/uploads/`; SQLite stores only safe metadata and the thread-relative path.

## Thread And Project Semantics
Projects are backed by `projects` and renamed independently from their Threads. Threads are conversations inside a Project and own the explicit `configured_model_api_id` for model selection; they do not own Agent identity, Canvas resources, project model bindings, or project shared context.

## Migration Notes
Schema creation and migration live in `server/db/schema.ts`. Schema version 3 completed the Project-owned Canvas migration. Schema version 4 adds `threads.context_reset_at` without deleting conversation history. Model Config, Agent definitions, and Knowledge data are retained.

`server/storage.ts` remains the public storage facade. `server/db/sqlite.ts` owns SQLite initialization, `server/storageTypes.ts` owns shared record shapes, `server/storagePaths.ts` owns app-root/thread-directory resolution, and repository classes under `server/repositories/` handle focused persistence areas behind the facade without changing table names or local paths.

Current focused repositories include Thread listing/trash, Agent settings, Run/message/output/tool-event records, Knowledge metadata, and Canvas persistence. Routes should still use domain services or the compatibility facade, not repository internals.

Future storage refactors should preserve existing table names and local paths unless a migration plan is documented here first.

Every new table, column, or index should have a named migration step in `server/db/schema.ts` and a test that covers upgrading an old local database shape.

## Knowledge Notes
Knowledge Base metadata is stored in FacetWrite's main SQLite database, while embeddings are stored in per-base libSQL vector databases managed by the embedjs runtime.

The main database intentionally does not store provider secrets. Embedding requests use process/runtime provider configuration such as `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_EMBEDDING_BASE_URL`, `OPENAI_EMBEDDING_MODEL`, and optional Ollama base URL settings.

File uploads are stored outside the main database under `.facetwrite/knowledge/uploads/<baseId>/`. The database keeps source metadata only; vector chunks remain in the per-base libSQL store.
# Project-First Workspace Schema V12 (2026-06-13)

- `projects`: top-level workspace, title, summary, timestamps, trash state.
- `threads`: conversations belonging to a Project. `configured_model_api_id` stores the resolved chat model and `context_reset_at` stores the soft history boundary.
- `project_model_bindings`: compatibility data from the former Project model allowlist.
- `project_briefs`: Project-owned reusable Brief JSON.
- `thread_task_briefs`: Thread-owned Current Task Brief JSON.
- `messages`, `runs`, `prompt_versions`, `output_versions`, and `tool_events`: Thread history.
- Canvas resources are physically and logically Project-owned through `project_id`.
- `canvas_nodes.include_in_project_context` and `output_versions.include_in_project_context` default to false.
- Brief revisions reject stale autosave writes independently.

Schema version 3 intentionally clears legacy workspace data to complete the physical Project migration. Model Config, Agent definitions, and knowledge-base data are retained.
Schema version 4 adds `threads.context_reset_at` without deleting history.
Schema version 12 drops legacy `project_agent_inputs` data and creates Agent-independent Project and Thread Brief tables.

Schema version 6 adds `plan_runs.clarification_json`. It stores the structured intake question, options, answer status, selected option, and optional custom answer while preserving the existing Plan ID through revision and execution.

Schema version 7 adds persistent Plan execution and feedback state: Plan projection/current-step/version fields on `plan_runs`, recoverable executor state in `plan_executions`, and ordered safe user-visible events in `run_activities`.

Schema version 8 repairs historical `canvas_write_requests.project_id` values that incorrectly stored a valid Thread ID. It resolves the real Project through `threads.project_id` and marks old pending create/append requests as `stale` so they cannot be executed after the new direct-commit policy is enabled.
Plan execution leases are stored in `plan_executions` with owner, expiry, heartbeat, attempt, current step, and cancellation state. `run_activities` stores ordered safe activity summaries used by the compact conversation timeline. Canvas Plan nodes are read-only projections of `plan_runs`.
`canvas_write_suggestions` persists UI-only write suggestions derived from ordinary replies. It stores structured points, status, and committed stable node IDs without modifying assistant message text.

`plan_executions` leases are renewed while a step runs. Startup does not clear active leases; expired leases are reclaimed by the executor.
