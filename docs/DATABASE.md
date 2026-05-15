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
  - Thread/project records with `agent_card_id`, title, timestamps, and optional `deleted_at`.
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

## Migration Notes
Schema creation and migration currently live in `SQLiteStorageRepository.migrate()`. The migration is idempotent and currently ensures `threads.deleted_at` exists for trash/restore behavior.

Future storage refactors should preserve existing table names and local paths unless a migration plan is documented here first.

