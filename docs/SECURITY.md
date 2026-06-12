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

Agent Runtime bridge tool calls use the same executor path through `/api/internal/agent-runtime/tool-call`. The historical `/api/internal/agent-backend/tool-call` path remains a compatibility alias. This endpoint is service-to-service only: it requires a trusted local/container marker or optional `FACETWRITE_INTERNAL_TOOL_TOKEN`, and it does not bypass tool policy or Canvas confirmation/approval. Bridge adapter errors redact token-like strings before returning content to the runtime.

Streaming assistant text is a temporary UI preview, not a persistence boundary. `/api/generate/stream` must keep an initial safety buffer and must not stream obvious internal prompt headings, raw ToolUse/search JSON, provider reasoning metadata, or AgentBackend replay payloads. The final assistant message is still normalized before it is recorded, and thread-state reconciliation should replace temporary UI text with the persisted safe output.

Private context assembly is runtime input, not a user-visible prompt dump. The UI exposes explicit mind-chain/selection intent and a one-shot clear-context action, but it does not reveal internal budgets or automatically read every Canvas node. Ordinary notes remain excluded. Context reset preserves visible history while preventing messages before `threads.context_reset_at` from reaching later model calls.

Runtime/model failures are not converted into successful assistant output. Stable error codes and redacted runtime events may be shown, but no Mock message or output version is persisted unless local development explicitly enables `FACETWRITE_MOCK_FALLBACK_ENABLED=true`.

## Agent Runtime Auth

When Agent Runtime is enabled, FacetWrite accesses protected runtime APIs through a backend-managed local session. The current implementation is the AgentBackend adapter. The frontend must never receive AgentBackend cookies, CSRF tokens, auth email/password, provider keys, or MCP secret-like values.

- AgentBackend health may be checked through `/health`.
- Protected calls such as `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` must use the backend auth helper.
- `GET /api/agent-runtime/status`, `GET /api/agent-runtime/config`, and `GET /api/agent-runtime/dashboard` are read-only FacetWrite surfaces and must redact secret-like values. `/api/agent-backend/*` remains a compatibility alias.
- `FACETWRITE_INTERNAL_TOOL_TOKEN`, when configured, is only used between Agent Runtime and FacetWrite backend bridge calls and must not be shown in frontend payloads, logs, or ToolUse output.
- Agent Runtime-proposed writes or external side effects must still pass through FacetWrite Human-in-the-loop confirmation before changing product data.
- Default local mode uses `LocalSandboxProvider` with `allow_host_bash:false`. Node/npm/npx are available to declared Skills, MCP, and ACP processes, but this does not grant arbitrary host Bash.
- The FacetWrite Agent Runtime dev compose is an optional isolation profile. It intentionally does not mount the host Docker socket or local CLI credential directories into the gateway container. Add those mounts only for isolated sandbox or CLI-auth work after explicitly accepting the credential and host-control risk.

## Electron Development Shell

- Electron renderer windows keep `contextIsolation:true`, `nodeIntegration:false`, and `sandbox:true`.
- The shell exposes no general Node or process API to the OpenCanvas frontend.
- Service ownership is explicit: the shell stops only its Vite/API processes and a local or Docker Agent Runtime that it started.
- Existing partial services, occupied ports, or an incompatible Runtime callback stop startup instead of being terminated automatically.
- Docker Desktop is an external trusted dependency only in Docker mode. External mode is user-managed and receives no lifecycle control from the shell.
- `start-opencanvas-shell.vbs` sets local mode only for its child process, preventing stale machine-level Docker mode variables from changing the one-click path.
- App Shell, API, frontend, and Gateway logs are local ignored files. Startup logging records stages and errors but must not print environment values, auth cookies, CSRF tokens, provider keys, or MCP secrets.
- The maintained local acceptance uses a temporary empty Project so its real provider and Web Search calls cannot transmit existing Project/thread context.
