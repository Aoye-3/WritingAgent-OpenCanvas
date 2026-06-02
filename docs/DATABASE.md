# FacetWrite Database

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
  - Local project records. Current default project is `local-project`.
- `threads`
  - Thread/project records with `agent_card_id`, custom project `title`, timestamps, and optional `deleted_at`.
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
  - Tool and run events stored as JSON payloads.
- `settings`
  - Generic settings key/value table.
- `agent_settings`
  - Per-Agent settings JSON payloads.
- `quick_messages`
  - Per-Agent quick message text.
- `canvas_nodes`
  - Canvas node state: kind, title, content, position, size, metadata JSON, timestamps.
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

## Thread And Project Title Semantics
The current project list is backed by `threads`; there is no separate project table-level rename. Renaming a project updates `threads.title` and `updated_at` for active, non-trashed threads only.

Recent projects and Projects search prefer the custom thread title for the primary label. AgentCard title remains secondary type metadata.

## Migration Notes
Schema creation and migration live in `server/db/schema.ts`. The migration is idempotent and currently ensures `threads.deleted_at` exists for trash/restore behavior plus the Canvas Workflow tables.

`server/storage.ts` remains the public storage facade. `server/db/sqlite.ts` owns SQLite initialization, `server/storageTypes.ts` owns shared record shapes, `server/storagePaths.ts` owns app-root/thread-directory resolution, and repository classes under `server/repositories/` handle focused persistence areas behind the facade without changing table names or local paths.

Current focused repositories include Thread listing/trash, Agent settings, Run/message/output/tool-event records, Knowledge metadata, and Canvas persistence. Routes should still use domain services or the compatibility facade, not repository internals.

Future storage refactors should preserve existing table names and local paths unless a migration plan is documented here first.

Every new table, column, or index should have a named migration step in `server/db/schema.ts` and a test that covers upgrading an old local database shape.

## Knowledge Notes
Knowledge Base metadata is stored in FacetWrite's main SQLite database, while embeddings are stored in per-base libSQL vector databases managed by the embedjs runtime.

The main database intentionally does not store provider secrets. Embedding requests use process/runtime provider configuration such as `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_EMBEDDING_BASE_URL`, `OPENAI_EMBEDDING_MODEL`, and optional Ollama base URL settings.

File uploads are stored outside the main database under `.facetwrite/knowledge/uploads/<baseId>/`. The database keeps source metadata only; vector chunks remain in the per-base libSQL store.
