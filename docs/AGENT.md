# FacetWrite Agent And Tool Architecture

## AgentCard
Agent cards are defined in `server/agentCards.ts`. An AgentCard includes:

- Stable `id`
- Category, accent, and icon metadata
- Localized title and description
- `identityPrompt`
- `skillRefs`
- `toolRefs`
- Output contract
- Default structured input values
- Field definitions
- Optional saved `settings`

Current built-in cards include blog post, summary, email writer, lesson plan, report outline, and rewrite/polish.

## AgentSettings
Settings cover:

- Model provider, model name, temperature, topP, max tokens, streaming, tool call mode, and max tool calls.
- Prompt name, description, identity prompt, output type, output format, and selected skills.
- Tool enablement by ToolRef.
- Knowledge scope.
- Memory flag.
- Quick messages.

Saved settings are merged back onto the base Agent card by the runtime adapter.

## Runtime Config
`GET /api/agent-cards/:agentCardId/runtime-config` is the frontend source for rendering settings safely. It should be preferred over hard-coded settings UI assumptions.

Runtime config includes the resolved card/settings, available tools, tool policies, available skills, and missing/deprecated references.

## DeerFlow Main Agent And Subagents
DeerFlow is the primary Agent runtime integration foundation when `DEERFLOW_ENABLED=true`.

- DeerFlow `lead_agent` acts as the main orchestration Agent.
- Local Docker validation uses DeerFlow nginx at `http://127.0.0.1:2026`.
- Each FacetWrite Task card maps to a DeerFlow subagent configuration.
- The mapping lives in `server/deerflow/taskAgentMapping.ts`.
- Subagent metadata includes name, description, system prompt, skills, tools, model inheritance, timeout, and max turns.
- FacetWrite records DeerFlow runs as provider `deerflow`.
- The current TypeScript run loop remains available when DeerFlow is disabled or unavailable.
- Runtime status is exposed through `/api/deerflow/status`.
- DeerFlow skills and MCP server overview are read through `/api/deerflow/config`; MCP environment and secret-like values are redacted before reaching the frontend.
- Current Docker sidecar status: `/health`, backend auth, `/api/deerflow/config`, and one Summary Task-card generation pass against DeerFlow nginx.

## Tool Catalog
`server/tools/catalog.ts` is the Tool metadata source of truth. Each ToolDefinition includes:

- Name, group, label, description, and prompt hint
- JSON schema for provider function calling
- Executor kind: local or external
- Default enablement
- External configuration requirement
- Risk level
- Approval requirement

Current tools:

- `web_search`: external, medium risk, requires external config.
- `knowledge_base`: local context tool, low risk.
- `quick_messages`: local editing intent tool, low risk.
- `clear_context`: local context control tool, low risk.
- `canvas_write`: local high-risk write request tool, requires approval.

## Tool Policy
`server/tools/policies.ts` derives runtime policy from Agent tool refs, saved settings, and per-run tool state.

A tool can auto-run only when it is enabled, does not require approval, and does not require missing external configuration.

`canvas_write` must never directly mutate Canvas content from model output. It can only create a pending request that the user approves or rejects.

## Run Loop
When DeerFlow is disabled, `server/agentRunLoop.ts` performs the fallback Agent run:

```text
build messages
 -> call provider chat completion
 -> if assistant returns tool_calls, execute allowed tools
 -> append tool result messages
 -> repeat until final assistant content or maxToolCalls
```

Tool events are recorded as `tool_call_requested`, `tool_call_completed`, `tool_call_failed`, and `tool_loop_stopped`.

When DeerFlow is enabled, `server/deerflow/client.ts` calls `/api/runs/stream` through the backend DeerFlow auth session, maps token/message stream output into the FacetWrite response, and maps DeerFlow custom task events into `deerflow_*` tool events for the run history.

The TypeScript run loop remains the fallback when DeerFlow is disabled or unavailable.

## Provider Boundary
Provider-specific request normalization belongs in `server/providerRuntime.ts`. UI and product code should use provider IDs and capabilities rather than inferring provider behavior from base URLs or model strings.
