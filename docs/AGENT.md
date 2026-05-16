# FacetWrite Agent And Tool Architecture

## AgentCard
Agent cards are exposed through `server/agentCards.ts` for compatibility, but the maintained implementation is split across `server/agents/`:

- `server/agents/types.ts`: AgentCard and AgentSettings types.
- `server/agents/cards/builtInCards.ts`: built-in Agent cards and localized field metadata.
- `server/agents/prompts.ts`: built-in identity prompts.
- `server/agents/defaultSettings.ts`: default Agent settings.
- `server/agents/loader.ts`: card lookup and saved-settings application.

An AgentCard includes:

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

Agent settings are the user-controlled configuration surface for concrete Agents. They define intent, model preferences, prompts, Skills, tool refs, memory, knowledge scope, and quick phrases. DeerFlow remains the execution/runtime plane that should consume these settings through FacetWrite's adapter contract.

## Runtime Config
`GET /api/agent-cards/:agentCardId/runtime-config` is the frontend source for rendering settings safely. It should be preferred over hard-coded settings UI assumptions.

Runtime config includes the resolved card/settings, available tools, tool policies, available skills, and missing/deprecated references.

## Runtime Context Boundary
Agent runtime context comes from the left AgentCard structured input drawer and current workspace state such as the draft and selected Canvas node. The bottom workspace utility bar is not a context source and must not inject historical placeholder values such as course notes, audience profiles, or default writing style.

Internal AgentCard, Skill, Tool policy, enabled tool state, and output contract text are private runtime context. They may be sent to the model as internal instructions, but assistant messages, stored chat messages, mock fallback text, and DeerFlow stream output must not expose or reproduce prompt headings such as `# AgentCard`, `# Current User Instruction`, or `# Output Contract`.

## Output Classification
DeerFlow and provider responses are classified before recording:

- `assistant_text`: final user-visible answer only.
- `tool_event`: ToolUse requests/results, DeerFlow task events, and Canvas write request events.
- `internal_event`: blocked system prompts, AgentCard prompt blocks, reasoning payloads, replayed values, and raw tool/search JSON.

Only `assistant_text` may enter `messages` and `output_versions`. `tool_event` and `internal_event` are exposed through the runtime timeline with redacted payload previews.

Recoverable DeerFlow failures are also runtime events. If DeerFlow returns no user-visible text or returns content that the output boundary classifies as internal/runtime-only, FacetWrite records `deerflow_runtime_failed` and immediately continues with the Provider runtime. The chat message is recorded from the Provider result, while the timeline shows that DeerFlow was bypassed for that run.

## DeerFlow Main Agent And Subagents
DeerFlow is the primary Agent runtime integration foundation when `DEERFLOW_ENABLED=true`.

- DeerFlow `lead_agent` acts as the main orchestration Agent.
- Local Docker validation uses DeerFlow nginx at `http://127.0.0.1:2026`.
- Each FacetWrite Task card maps to a DeerFlow subagent configuration.
- The mapping lives in `server/deerflow/taskAgentMapping.ts`.
- Subagent metadata includes name, description, system prompt, skills, tools, model inheritance, timeout, and max turns.
- FacetWrite records DeerFlow runs as provider `deerflow`.
- The current TypeScript run loop remains available when DeerFlow is disabled, unavailable, or returns no valid user-visible answer.
- Runtime status is exposed through `/api/deerflow/status`.
- DeerFlow skills and MCP server overview are read through `/api/deerflow/config`; MCP environment and secret-like values are redacted before reaching the frontend.
- AI runtime status, Agent mapping, and ToolUse bridge progress are exposed through `/api/deerflow/dashboard` and shown in the AI Dashboard.
- FacetWrite sends per-run bridge context to DeerFlow: allowed tool refs, effective tool state, explicit context values, selected Canvas node id, and current chat instruction.
- DeerFlow loads FacetWrite bridge tools from `deerflow.tools.facetwrite_bridge` for `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write`.
- The bridge calls FacetWrite `/api/internal/deerflow/tool-call`, so ToolUse policy remains enforced by FacetWrite and `canvas_write` can only create a pending request.
- `web_search` is verified separately as a DeerFlow built-in tool, not as a FacetWrite local bridge.
- Current Docker sidecar acceptance target: `/health`, backend auth, `/api/deerflow/config`, provider `deerflow` generation, repeated no-fallback runs, DeerFlow built-in ToolUse, and FacetWrite bridge ToolUse.

## AI Dashboard
The AI Dashboard is not a second Agent settings page. It is a read-only runtime/control-plane surface.

- It shows DeerFlow runtime reachability, auth state, Lead Agent ID, Skills, MCP servers, AgentCard-to-subagent mapping, and ToolUse bridge status.
- It describes FacetWrite capabilities as progressively bridged to DeerFlow ToolUse or MCP capabilities rather than as a competing local Agent runtime.
- Canvas write behavior remains Human-in-the-loop: DeerFlow may propose the write through the bridge, but FacetWrite records only a pending request until the user confirms it and the backend approval path applies it.

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
- `canvas_write`: local high-risk write proposal tool, requires approval.

## Tool Policy
`server/tools/policies.ts` derives runtime policy from Agent tool refs, saved settings, and per-run tool state.

A tool can auto-run only when it is enabled, does not require approval, and does not require missing external configuration.

`server/tools/toolPolicyGuard.ts` is the execution-time gate. It rejects unknown tools, tools not allowed by the active Agent, tools disabled for the current run, and tools that require missing external configuration before the executor branch runs.

`canvas_write` must never directly mutate Canvas content from model output. It can only create a pending request/proposal. The user-facing UI may offer "write all" or "write annotated snippets"; once the user confirms, FacetWrite applies the same backend approve path.

If the user directly says to write/save/add content to Canvas, the generation hook treats that message as confirmation for newly created write requests from the same run and auto-calls the approve path after the thread state refresh. Existing pending requests from earlier runs are deliberately excluded so stale suggestions cannot be applied accidentally.

When a model proposes a `replace` Canvas operation without an explicit user replace/overwrite instruction, the runtime downgrades it to `append` for the selected node or `create` when no node is selected. This keeps ordinary "write this to Canvas" requests non-destructive by default.

The workspace also supports user-created temporary annotations on assistant responses. These annotations are not model output and are not saved as ToolUse state; they only help the user choose which response fragments should be written to Canvas.

When DeerFlow is the active runtime, the FacetWrite bridge tools still call the same policy and executor path. This keeps disabled tools, disallowed Agent tools, and approval-gated writes consistent across DeerFlow and the TypeScript fallback runtime.

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

The TypeScript run loop remains the fallback when DeerFlow is disabled, unavailable, returns an empty answer, or returns only internal/runtime output. A recoverable DeerFlow failure should not create a Mock fallback response by itself; Mock fallback is reserved for cases where both DeerFlow and the Provider runtime cannot produce a safe assistant answer.

`server/services/generationService.ts` is now a compatibility export. The implementation is split under `server/services/generation/`: prompt/message/model preparation, DeerFlow runner, provider runner, mock fallback, and run recording are separate modules while preserving the existing `/api/generate` contract.

## Provider Boundary
Provider-specific request normalization belongs in `server/providerRuntime.ts`. UI and product code should use provider IDs and capabilities rather than inferring provider behavior from base URLs or model strings.

Provider-private fields are allowed only inside the runtime request chain. DeepSeek thinking mode may return `reasoning_content`; when an assistant message also contains `tool_calls`, that field must be preserved for later DeepSeek API calls, but it must never be recorded as visible assistant text, output version content, Canvas content, or mock fallback text. Other providers strip DeepSeek-only fields according to their provider profile.

The workspace chat composer may send per-run model overrides for DeepSeek Think mode and reasoning effort. These overrides affect only the current request; saved Agent settings remain the default configuration source.

DeepSeek prefix completion remains a separate response mode: only the final assistant message may carry `prefix: true`, and only DeepSeek uses the beta base URL for that mode. Canvas writes continue to use tool calls plus FacetWrite approval, not prefix completion.
