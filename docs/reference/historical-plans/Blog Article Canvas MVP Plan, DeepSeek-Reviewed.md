# Blog Article Canvas MVP Plan, DeepSeek-Reviewed

## Summary
Build Blog Article first as a zoomable node Canvas backed by SQLite. Left sidebar supplies fixed Task context, right Agent chat interprets intent, and Canvas changes happen only through approved ToolUse write requests.

DeepSeek prefix completion is out of MVP for Canvas writes. Use Function Calling for structured `canvas_write` proposals because the model should request a tool call, while the app executes and persists changes after approval.

## Key Changes
- Replace the center single-document editor with a `DocumentCanvas` supporting pan, zoom, node drag, node selection, and right-click create.
- Support three node types: `document`, `note`, `reference`.
- Persist Canvas state in SQLite under each thread:
  - `canvas_nodes`
  - `canvas_write_requests`
- Add `canvas_write` as an internal tool with operations:
  - `create`
  - `replace`
  - `append`
- `canvas_write` never writes immediately. It creates a pending request rendered in the right chat drawer.
- User approves/rejects the request in the right chat drawer. Approval applies the write to Canvas nodes.
- Remove direct “Generate” write behavior from top/left controls for this MVP. Agent chat becomes the write entrypoint.
- Keep Agent locked to Blog Article for MVP; no free Agent switching yet.

## DeepSeek API Notes
- Use standard Function Calling as the primary path for `canvas_write`.
- Do not parse normal assistant prose as JSON for Canvas writes.
- Do not rely on Chat Prefix Completion for write approval flow.
- If strict function schemas are introduced later, add provider-level handling for DeepSeek beta endpoint compatibility instead of changing Canvas logic.
- The app remains responsible for executing tools, storing pending requests, and applying approved writes.

## Test Plan
- Server tests:
  - Canvas node CRUD.
  - SQLite migration creates Canvas tables.
  - `canvas_write` creates pending requests only.
  - approve `create`, `replace`, `append`.
  - reject leaves nodes unchanged.
- Provider/tool tests:
  - Function-call arguments validate against allowed Canvas operations.
  - malformed tool arguments become rejected/failed tool events, not direct writes.
- UI/manual QA:
  - right-click creates document/note/reference nodes.
  - pan/zoom and node drag keep coordinates correct.
  - selected node is included in Agent context.
  - chat shows write request cards.
  - approve/reject updates Canvas correctly.
  - refresh/reopen restores nodes and positions.

## Assumptions
- Blog Article is the only polished Task for this MVP.
- Canvas nodes are first-class thread assets.
- AI can suggest writes, but user approval is required before mutation.
- DeepSeek prefix completion may be revisited later for constrained natural-language continuations, not Canvas write execution.
