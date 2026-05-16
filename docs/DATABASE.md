# FacetWrite Database

## Location
FacetWrite stores local runtime data in SQLite:

```text
.facetwrite/data/facetwrite.db
```

SQLite uses WAL mode and foreign keys are enabled in `server/storage.ts`.

Thread-specific local folders are created under:

```text
.facetwrite/threads/<threadId>/user-data/
  workspace/
  uploads/
  outputs/
```

Thread IDs and node/request IDs are validated before filesystem operations so data stays inside `.facetwrite`.

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
- `canvas_write_requests`
  - Pending/approved/rejected Agent write requests for Canvas changes.

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

Canvas document nodes store the same content and size fields. The current UI expands document-node height to fit full content instead of rendering an internal scroll region; this is a presentation rule, not a schema change.

Canvas pan/drag hit testing is also presentation-only. The visual grid and future decorative overlays should not introduce persistence changes or new node state; they must remain separate from `canvas_nodes` and avoid intercepting viewport pointer events unless they represent an explicit interactive tool.

## Thread And Project Title Semantics
The current project list is backed by `threads`; there is no separate project table-level rename. Renaming a project updates `threads.title` and `updated_at` for active, non-trashed threads only.

Recent projects and Projects search prefer the custom thread title for the primary label. AgentCard title remains secondary type metadata.

## Migration Notes
Schema creation and migration live in `server/db/schema.ts`. The migration is idempotent and currently ensures `threads.deleted_at` exists for trash/restore behavior.

`server/storage.ts` remains the public storage facade. `server/db/sqlite.ts` owns SQLite initialization, and repository classes under `server/repositories/` are being introduced behind the facade without changing table names or local paths.

Future storage refactors should preserve existing table names and local paths unless a migration plan is documented here first.
