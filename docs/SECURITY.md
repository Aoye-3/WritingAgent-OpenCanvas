# FacetWrite Local Security Notes

FacetWrite is a local-first development app. Treat local provider keys as production secrets.

## API keys

- Store real keys only in `.env.local` or your shell environment.
- Never commit `.env.local`, `.env`, `API-Key.txt`, screenshots containing keys, or pasted provider examples with real tokens.
- If a key was pasted into chat, copied into docs, or stored in a tracked file, rotate it at the provider before continuing.

## Settings API

The local settings panel can write provider settings to `.env.local`. Saving a new API key requires an explicit `confirmLocalKeyWrite=true` request field so accidental writes are rejected by the API.

Settings writes are also guarded by `server/security/policies/settingsWritePolicy.ts`. Production runtime disables local `.env.local` writes by default; local development can explicitly opt in with `LOCAL_SETTINGS_WRITE_ENABLED=true` or `LOCAL_SETTINGS_WRITE_ENABLED=1`.

The API status response reports whether a key is configured, but it must never return the key value.

## Tool permissions

Agent tools are configured through the tool catalog and policy layer:

- Low-risk local context tools may run automatically when enabled.
- `canvas_write` can only create a pending write proposal/request. The user must explicitly confirm the write before Canvas content changes; the frontend may then submit the backend approval automatically.
- Direct write phrases such as `写入`, `保存到画板`, `save to canvas`, or `write this` are considered user confirmation only for new Canvas write requests created by the same run. Older pending requests still require their own visible confirmation.
- Model-requested Canvas replacement is not trusted by itself. Unless the user explicitly asks to replace or overwrite, replace proposals are normalized to append/create before approval.
- External tools such as web search must report when they are not configured.

Runtime tool calls pass through `server/tools/toolPolicyGuard.ts` before executor logic runs. The guard rejects unknown tools, tools outside the active Agent's refs, tools disabled for the current run, and tools missing required external configuration.

DeerFlow bridge tool calls use the same executor path through `/api/internal/deerflow/tool-call`. This endpoint is service-to-service only: it requires a trusted local/container marker or optional `FACETWRITE_INTERNAL_TOOL_TOKEN`, and it does not bypass tool policy or Canvas confirmation/approval. Bridge adapter errors redact token-like strings before returning content to DeerFlow.

Streaming assistant text is a temporary UI preview, not a persistence boundary. `/api/generate/stream` must keep an initial safety buffer and must not stream obvious internal prompt headings, raw ToolUse/search JSON, provider reasoning metadata, or DeerFlow replay payloads. The final assistant message is still normalized before it is recorded, and thread-state reconciliation should replace temporary UI text with the persisted safe output.

## DeerFlow runtime auth

When DeerFlow is enabled, FacetWrite accesses protected DeerFlow APIs through a backend-managed local session. The frontend must never receive DeerFlow cookies, CSRF tokens, auth email/password, provider keys, or MCP secret-like values.

- DeerFlow health may be checked through `/health`.
- Protected calls such as `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` must use the backend auth helper.
- `GET /api/deerflow/status`, `GET /api/deerflow/config`, and `GET /api/deerflow/dashboard` are read-only FacetWrite surfaces and must redact secret-like values.
- `FACETWRITE_INTERNAL_TOOL_TOKEN`, when configured, is only used between DeerFlow and FacetWrite backend bridge calls and must not be shown in frontend payloads, logs, or ToolUse output.
- DeerFlow-proposed writes or external side effects must still pass through FacetWrite Human-in-the-loop confirmation before changing product data.
