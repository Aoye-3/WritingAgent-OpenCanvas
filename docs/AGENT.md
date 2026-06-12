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
- Provider ids are resolved through the FacetWrite model registry in `shared/model/`; Agent settings should not hard-code the old three-provider list.
- Agent settings store `configuredModelApiId` plus compatibility `providerId + model` fields. They must not store API keys, provider secrets, or copied base URL credentials.
- Prompt name, description, identity prompt, output type, output format, and selected skills.
- Tool enablement by ToolRef.
- Knowledge settings: enablement, scope label, selected Knowledge Base ids, retrieval result count, score threshold, optional rerank preference.
- Memory flag.
- Quick messages.

Saved settings are merged back onto the base Agent card by the runtime adapter.

Agent settings are the user-controlled configuration surface for concrete Agents. They define intent, model preferences, prompts, Skills, tool refs, memory, knowledge scope, and quick phrases. Agent Runtime is the execution subsystem that consumes these settings through FacetWrite's adapter contract; the current implementation is AgentBackend.

The Agent Settings Knowledge tab loads bases through `GET /api/knowledge/bases` and saves changes through the existing `PUT /api/agent-cards/:agentCardId/settings` path. Selecting no specific base means all ready bases are eligible during generation; selecting one or more base ids constrains retrieval to those bases.

## Runtime Config
`GET /api/agent-cards/:agentCardId/runtime-config` is the frontend source for rendering settings safely. It should be preferred over hard-coded settings UI assumptions.

Runtime config includes the resolved card/settings, available tools, tool policies, available skills, and missing/deprecated references.

## Runtime Context Boundary
Agent runtime context comes from the left AgentCard structured input drawer and current workspace state such as the draft and selected Canvas node. The bottom workspace utility bar is not a context source and must not inject historical placeholder values such as course notes, audience profiles, or default writing style.

Canvas context is filtered by node kind before it reaches the runtime:

- `note` is user thinking space and is excluded from default AI context.
- `document` contributes a preview and remains the default target for approved AI Canvas output.
- `reference` contributes reference content by default.

Canvas Workflow adds a second filter before runtime context is sent. The default order is:

```text
selected or explicitly sent mind chain
 -> current or user-specified Canvas Workflow stage
 -> Role nodes connected to the selected/filtered content nodes
```

The Agent must not default to reading the entire Canvas. Role perspectives are not read from ordinary content node metadata; they are selected by directed `Role -> document | note | reference` edges. Only connected Role node prompts are passed as advice perspectives for the current chain/stage. If the user manually switches the project stage, new nodes inherit that stage and the Agent should treat later context as belonging to the new collaboration phase. If the Agent proposes moving to the next stage, the project stage changes only after user confirmation.

When a user explicitly sends a directed Canvas mind chain to the right collaboration drawer, the selected chain becomes user-provided chat text. That explicit action may include `note` nodes without changing the default context rule.

Internal AgentCard, Skill, Tool policy, enabled tool state, and output contract text are private runtime context. They may be sent to the model as internal instructions, but assistant messages, stored chat messages, mock fallback text, and Agent Runtime stream output must not expose or reproduce prompt headings such as `# AgentCard`, `# Current User Instruction`, or `# Output Contract`.

## Output Classification
AgentBackend and provider responses are classified before recording:

- `assistant_text`: final user-visible answer only.
- `tool_event`: ToolUse requests/results, AgentBackend task events, and Canvas write request events.
- `internal_event`: blocked system prompts, AgentCard prompt blocks, reasoning payloads, replayed values, and raw tool/search JSON.

Only `assistant_text` may enter `messages` and `output_versions`. `tool_event` and `internal_event` are exposed through the runtime timeline with redacted payload previews.

Recoverable AgentBackend failures are runtime events and explicit API errors. If AgentBackend returns no user-visible text or returns content classified as internal/runtime-only, FacetWrite records `agent_backend_runtime_failed` without creating a successful assistant response. Mock output requires explicit local development opt-in; the local Provider runtime is not called by generation.

## Agent Runtime Main Agent And Subagents
Agent Runtime is FacetWrite's internal execution subsystem when `AGENT_BACKEND_ENABLED=true`; the current adapter is AgentBackend.

- AgentBackend `lead_agent` acts as the main orchestration Agent for the current adapter.
- Default local validation uses the project-managed Gateway at `http://127.0.0.1:8001`; explicit Docker validation uses nginx at `http://127.0.0.1:2026`.
- Runtime status reports `deploymentMode` and `sandboxProvider` so the UI does not confuse local process execution with container isolation.
- AgentBackend enablement uses `AGENT_BACKEND_*` env keys only; stale `DEERFLOW_*` values are historical and leave the runtime disabled.
- Each FacetWrite Task card maps to an Agent Runtime subagent configuration.
- The current mapping lives in `server/runtime/agentBackendAdapter/taskAgentMapping.ts`, with `server/agentBackend/taskAgentMapping.ts` kept as a compatibility export.
- Subagent metadata includes name, description, system prompt, skills, tools, model inheritance, timeout, and max turns.
- FacetWrite records AgentBackend runs as provider `agent-backend`.
- The TypeScript run loop remains legacy compatibility code and is not a product fallback. Agent Runtime is the only real generation path.
- Runtime status is exposed through `/api/agent-runtime/status`.
- Skills and MCP server overview are read through `/api/agent-runtime/config`; MCP environment and secret-like values are redacted before reaching the frontend.
- AI runtime status, Agent mapping, and ToolUse bridge progress are exposed through `/api/agent-runtime/dashboard` and shown in the AI Dashboard. `/api/agent-backend/*` remains a compatibility alias.
- FacetWrite sends per-run bridge context to AgentBackend: allowed tool refs, effective tool state, explicit context values, selected Canvas node id, and current chat instruction.
- FacetWrite also sends Memory isolation context. `facetwrite_memory_enabled` defaults to false unless the current Agent settings explicitly enable Memory; FacetWrite-managed Memory content is sent only from `.facetwrite/memory/`, never from AgentBackend's legacy global memory store.
- AgentBackend loads FacetWrite bridge tools from `AgentBackend.tools.facetwrite_bridge` for `knowledge_base`, `quick_messages`, `clear_context`, and `canvas_write`.
- `knowledge_base` bridge calls prefer KnowledgeService RAG results and pass optional selected `baseIds`; explicit runtime context values are only the fallback when no Knowledge result is available.
- The bridge calls FacetWrite `/api/internal/agent-runtime/tool-call`, so ToolUse policy remains enforced by FacetWrite and `canvas_write` can only create a pending request. `/api/internal/agent-backend/tool-call` remains a compatibility alias; `/api/internal/deerflow/tool-call` is deprecated and exists only to protect already-running legacy sidecars.
- AgentRuntime does not own FacetWrite product data. Threads, messages, Canvas nodes/edges/write requests, settings, and Knowledge metadata stay in FacetWrite storage; AgentRuntime can affect them only through the backend adapter and internal ToolUse bridge. It must not bypass frontend Canvas context filtering, and it must not call Canvas repositories or storage facades directly.
- Canvas Workflow suggestions are low-risk additions when routed through FacetWrite APIs: creating nodes, edges, appending body text, and writing suggestions are allowed product operations. Replace, overwrite, and delete operations still require the existing approval path.
- `web_search` is verified separately as a AgentBackend built-in tool, not as a FacetWrite local bridge.
- Local and Docker acceptance targets remain `/health`, backend auth, runtime config, provider `agent-backend` generation, repeated no-fallback runs, built-in ToolUse, Skills/MCP/Memory/subagents, and FacetWrite bridge ToolUse. Docker-only sandbox facilities are tested separately.

## AI Dashboard
The AI Dashboard is primarily a runtime/control-plane surface. FacetWrite-managed Memory is the one editable exception because users need to inspect and correct what the runtime may reuse.

- It shows Agent Runtime reachability, auth state, Lead Agent ID, Skills, MCP servers, AgentCard-to-subagent mapping, and ToolUse bridge status.
- It shows and edits FacetWrite-managed Memory through `/api/agent-runtime/memory`. Agent settings still decide whether a concrete Agent can use that Memory during a run.
- It describes FacetWrite capabilities as progressively bridged to runtime ToolUse or MCP capabilities rather than as a competing local Agent runtime.
- Canvas write behavior remains Human-in-the-loop: Agent Runtime may propose the write through the bridge, but FacetWrite records only a pending request until the user confirms it and the backend approval path applies it.

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
- `knowledge_base`: local Knowledge/context tool, low risk, accepts `query`, `limit`, and optional `baseIds`.
- `quick_messages`: local editing intent tool, low risk.
- `clear_context`: local context control tool, low risk.
- `canvas_write`: local high-risk write proposal tool, requires approval.

## Tool Policy
`server/tools/policies.ts` derives runtime policy from Agent tool refs, saved settings, and per-run tool state.

A tool can auto-run only when it is enabled, does not require approval, and does not require missing external configuration.

`server/tools/toolPolicyGuard.ts` is the execution-time gate. It rejects unknown tools, tools not allowed by the active Agent, tools disabled for the current run, and tools that require missing external configuration before the executor branch runs.

`canvas_write` must never directly mutate Canvas content from model output. It can only create a pending request/proposal. The user-facing UI may offer "write all" or "write annotated snippets"; once the user confirms, FacetWrite applies the same backend approve path.

`canvas_write` defaults created nodes to `document` unless the tool request explicitly supplies a valid Canvas node kind. This preserves the rule that AI output appears as editable documents by default.

If the user directly says to write/save/add content to Canvas, the generation hook treats that message as confirmation for newly created write requests from the same run and auto-calls the approve path after the thread state refresh. Existing pending requests from earlier runs are deliberately excluded so stale suggestions cannot be applied accidentally.

When a model proposes a `replace` Canvas operation without an explicit user replace/overwrite instruction, the runtime downgrades it to `append` for the selected node or `create` when no node is selected. This keeps ordinary "write this to Canvas" requests non-destructive by default.

The workspace also supports user-created temporary annotations on assistant responses. These annotations are not model output and are not saved as ToolUse state; they only help the user choose which response fragments should be written to Canvas.

When Agent Runtime is active, the FacetWrite bridge tools still call the same policy and executor path. This keeps disabled tools, disallowed Agent tools, and approval-gated writes consistent across Agent Runtime and the TypeScript fallback runtime.

## Run Loop
`server/agentRunLoop.ts` preserves the historical TypeScript loop for compatibility tests and isolated development. Normal generation does not route to it when Agent Runtime fails:

```text
build messages
 -> call provider chat completion
 -> if assistant returns tool_calls, execute allowed tools
 -> append tool result messages
 -> repeat until final assistant content or maxToolCalls
```

Tool events are recorded as `tool_call_requested`, `tool_call_completed`, `tool_call_failed`, and `tool_loop_stopped`.

For `/api/generate/stream`, the TypeScript run loop uses provider streaming when available. It forwards assistant content deltas as `token` events, emits transient `status` events around thinking, ToolUse/searching, writing, and finalizing phases, and still accumulates the same final text for normalization and persistence.

When Agent Runtime is enabled, `server/runtime/agentBackendAdapter/client.ts` calls `/api/runs/stream` through the backend AgentBackend auth session, maps token/message stream output into the FacetWrite response, forwards assistant message chunks as `token` events, and maps AgentBackend custom task events into `AgentBackend_*` tool events for the run history.

AgentBackend failure returns stable `runtime_unavailable`, `runtime_auth_failed`, `model_required`, or `model_not_ready` diagnostics. It does not call the TypeScript/provider loop or persist Mock output unless `FACETWRITE_MOCK_FALLBACK_ENABLED=true` is deliberately enabled for local demonstration.

`server/services/generationService.ts` is now a compatibility export. The domain public entry is `server/domains/generation/index.ts`, which exposes prompt/message/model preparation, Agent Runtime runner, provider runner, mock fallback integration, and run recording while preserving the existing `/api/generate` contract.

## Provider Boundary
Provider-specific request normalization belongs in `server/providerRuntime.ts`. UI and product code should use provider IDs and capabilities rather than inferring provider behavior from base URLs or model strings.

Provider API credentials belong to the configured model API store, not Agent settings. The Model Config page writes local `API + model` bindings to `.facetwrite/provider-apis.json`; runtime code resolves the active Agent's `configuredModelApiId` immediately before calling the provider. If an Agent references a deleted, disabled, or keyless binding, the Provider runtime returns a clear configuration error and the UI should direct the user back to Model Config.

The Agent Settings model tab only offers saved, enabled, key-configured bindings whose model type can be used for chat generation. This prevents Agents from being assigned models that have no local callable API configuration.

Frontend Agent settings load configured chat bindings through `src/features/model-config/modelConfigClient.ts`; they should not import provider/model API calls from the generic settings client.

Provider-private fields are allowed only inside the runtime request chain. DeepSeek thinking mode may return `reasoning_content`; when an assistant message also contains `tool_calls`, that field must be preserved for later DeepSeek API calls, but it must never be recorded as visible assistant text, output version content, Canvas content, or mock fallback text. Other providers strip DeepSeek-only fields according to their provider profile.

The workspace chat composer may send per-run model overrides for DeepSeek Think mode and reasoning effort. These overrides affect only the current request; saved Agent settings remain the default configuration source.

DeepSeek prefix completion remains a separate response mode: only the final assistant message may carry `prefix: true`, and only DeepSeek uses the beta base URL for that mode. Canvas writes continue to use tool calls plus FacetWrite approval, not prefix completion.

## Conversation Runtime Policy (2026-06-12)

- Conversation model choices come directly from enabled, keyed `modelType:"chat"` Model Configs and are grouped by capability.
- New conversations inherit the Project's most recent valid model, then global recent/active/first valid chat configuration.
- Context composition is private and bounded. The default UI does not expose Project model allowlists or manual Canvas/output context checkboxes.
- Clear context is a one-shot persisted Thread operation. It keeps history visible and excludes messages before `context_reset_at` from later model requests.
- Runtime/model failures never become successful Mock assistant messages unless explicit local fallback is enabled.
