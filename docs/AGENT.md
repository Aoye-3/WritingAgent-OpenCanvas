# FacetWrite Agent And Tool Architecture

## Plan Runtime

FacetWrite separates Conversation, Plan, and Artifact output. Conversation is user-facing dialogue; Plan is persistent task state and approval; Artifact is Agent-selected text, image, and link output committed to Canvas.

`/plan` forces a staged workflow. The product server creates the intake Plan before model generation. Intake exposes only `plan_clarification_submit`, revision exposes only `plan_revision_submit`, and execution exposes `artifact_stage` for the current step. Search, browsing, and ordinary Canvas writes are disabled during planning.

Outside `/plan`, Agent-configured tools remain available. Plan lifecycle tools are hidden from the composer and injected only by the server phase policy. The legacy broad `plan_update` contract is not exposed to models.

Ordinary requests are classified by the server as `direct`, `guided`, or `managed_plan`. Guided requests may use decomposition skills without writing to Canvas. Explicit `/plan` always uses the managed workflow and requires a durable Artifact for every completed step.

Generation also applies a server-owned `TaskHandlingPolicy` before Agent Runtime context is sent. The policy is the hard gate for Canvas delivery: `simple_chat` and `plan_intake` are conversation-only, `long_task` and `plan_execution` may use progressive Canvas delivery, and `explicit_canvas` uses the direct Canvas delivery planner. Enabled skills and thinking mode are only complexity signals; they do not by themselves authorize Canvas writes for short Q&A. Plan intake clarification text, such as "I need to confirm a few key points before proceeding", must stay in the Plan clarification UI and must never be committed as `Overview`, `Body`, or final body content.

Successful ordinary replies with at least three top-level list items create a persistent, UI-only Canvas write suggestion. Accepting it creates one or more stable document nodes per point; long content is split near 1200 Chinese characters or 250 English words and linked in order.

Explicit Canvas delivery requests are different from ordinary suggestions. When the user clearly asks to summarize, organize, save, write, split, or turn content into Canvas/board nodes/cards, the server derives a `CanvasDeliveryContent` object from the final run output and tool events, then commits stable Canvas nodes automatically. The assistant reply and Canvas delivery content are separate products: `assistantText` is recorded in chat, while `outlineMarkdown`, `bodyMarkdown`, and `sources` are the only inputs to the direct delivery planner. The Canvas delivery intent detector is shared by `canvasActionPolicy` and `CanvasDeliveryPlanner`; add Chinese and English trigger wording there instead of creating a second regex policy.

Long-task Canvas delivery is progressive and server-owned. During streaming runs in batch-delivery workflow, FacetWrite enables progressive Canvas delivery even when the user did not explicitly say "write to Canvas"; selected Skills, thinking mode, and any evidence-producing tool loop must not rely on the model to decide whether intermediate work should be stored. The server creates or updates stable `整体概述` / `Overview` and `正文` / `Body` placeholders, commits a stable progress node after each completed evidence tool event, and updates the same `正文` / `Body` node with a working body draft checkpoint. Explicit research-to-Canvas runs use `研究摘录 N` / `Research note N`; other long tasks use `进度摘录 N` / `Progress note N`.

Long-task runs also carry a server-owned runtime budget profile: `low`, `medium`, or `high`. The project default is persisted per Project and defaults to `medium`; the composer profile selector is a one-run override only. The profile maps to LangGraph `recursion_limit`, model-call budget, evidence-tool budget, body-draft write budget, and synthesis reserve steps. Agent Runtime middleware must stop exposing evidence tools and inject a final-synthesis instruction before the graph reaches the recursion clamp; increasing `recursion_limit` alone is not the fix.

The long-task budget is a double budget. Evidence-tool budget controls how many material-gathering completions may create `研究摘录` / `进度摘录` nodes. Body-draft write budget controls how many times the stable `正文` / `Body` node may be updated with a working draft. Defaults are low `4 evidence / 1 draft / 10 model calls / 40 recursion / 10 reserve`, medium `8 / 3 / 20 / 80 / 16`, and high `18 / 5 / 36 / 160 / 24`. When any budget enters synthesis territory, the server emits `canvas_delivery_synthesis_started`; later tool events may remain in the run trace, but they no longer create new progress nodes or body checkpoints.

Progress nodes contain only allowlisted fields from completed tool events: `toolName`, `query`, `url`, `path`, `title`, `snippet`, `summary`, and `sourceCount` or sanitized `sources`. They cover `web_search`, `web_fetch`, `read_file`, and safe summaries from `grep`, `glob`, `ls`, and `bash` status. They never include raw tool JSON, prompts, provider reasoning, request headers, environment variables, credentials, or hidden chain-of-thought. They are intentionally retained if the later Agent Runtime run fails, so long tasks do not lose already gathered work.

Development must occur in the current `F:\.FinalProject` checkout on a normal `codex/` branch. Git worktrees and project copies outside this workspace are prohibited.

## AgentCard
Agent cards are exposed through `server/agentCards.ts` for compatibility, but the maintained implementation is split across `server/agents/`:

- `server/agents/types.ts`: AgentCard and AgentSettings types.
- `server/agents/cards/builtInCards.ts`: built-in Agent profile cards.
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
- Optional saved `settings`

Current built-in cards expose only the neutral `chat-agent` / `ChatAgent`. Historical built-in ids such as `blog-post`, `summary`, `email-writer`, `lesson-plan`, `report-outline`, and `rewrite-polish` are compatibility aliases that resolve to `ChatAgent`; they are not product templates or default entry points.

## AgentSettings
Settings cover:

- Prompt name, description, identity prompt, output type, output format, and selected skills.
- Tool enablement by ToolRef.
- Knowledge settings: enablement, scope label, selected Knowledge Base ids, retrieval result count, score threshold, optional rerank preference.
- Memory flag.
- MCP server references selected from already configured Agent Runtime MCP servers.

Saved settings are merged back onto the base Agent card by the runtime adapter.

Agent settings are the user-controlled configuration surface for concrete Agent profiles. They define intent, prompts, Skills, tool refs, MCP refs, memory, and knowledge scope. They do not own model identity or provider credentials. Agent Runtime is the execution subsystem that consumes these settings through FacetWrite's adapter contract; the current implementation is AgentBackend.

The Agent Settings Knowledge tab loads bases through `GET /api/knowledge/bases` and saves changes through the existing `PUT /api/agent-cards/:agentCardId/settings` path. Selecting no specific base means all ready bases are eligible during generation; selecting one or more base ids constrains retrieval to those bases.

## Runtime Config
`GET /api/agent-cards/:agentCardId/runtime-config` is the frontend source for rendering settings safely. It should be preferred over hard-coded settings UI assumptions.

Runtime config includes the resolved card/settings, available tools, tool policies, available skills, and missing/deprecated references. It does not return provider profile data as an Agent property; model capabilities come from the Thread-selected Model Config and conversation runtime controls.

## Runtime Context Boundary
Agent runtime context comes from the Project-owned Project Brief, the Thread-owned Current Task Brief, and explicit workspace state such as the draft and selected Canvas node. Briefs are independent from Agent selection and are loaded by the server before generation.

Canvas context is filtered by node kind before it reaches the runtime:

- `note` is user thinking space and is excluded from default AI context.
- `document` contributes a preview and remains the default target for approved AI Canvas output.
- `reference` contributes reference content by default.

Canvas Workflow adds a second filter before runtime context is sent. The default order is:

```text
selected or explicitly sent mind chain
 -> current or user-specified batch-delivery stage
 -> Role nodes connected to the selected/filtered content nodes
```

The Agent must not default to reading the entire Canvas. Role perspectives are not read from ordinary content node metadata; they are selected by directed `Role -> document | note | reference` edges. Only connected Role node prompts are passed as advice perspectives for the current chain and batch-delivery stage. If the user manually switches the batch stage, new nodes inherit that stage and the Agent should treat later context as belonging to that collaboration phase. If the Agent proposes moving to the next batch stage, the project stage changes only after user confirmation.

When a user explicitly sends a directed Canvas mind chain to the right collaboration drawer, the selected chain becomes user-provided chat text. That explicit action may include `note` nodes without changing the default context rule.

Internal AgentCard, Skill, Tool policy, enabled tool state, and output contract text are private runtime context. They may be sent to the model as internal instructions, but assistant messages, stored chat messages, mock fallback text, and Agent Runtime stream output must not expose or reproduce prompt headings such as `# AgentCard`, `# Current User Instruction`, or `# Output Contract`.

## Output Classification
AgentBackend and provider responses are classified before recording:

- `assistant_text`: final user-visible answer only.
- `tool_event`: ToolUse requests/results, AgentBackend task events, and Canvas write request events.
- `internal_event`: blocked system prompts, AgentCard prompt blocks, reasoning payloads, replayed values, and raw tool/search JSON.

Only `assistant_text` may enter `messages` and `output_versions`. `tool_event` and `internal_event` remain internal audit/debug records and are not shown as a default workspace UI surface. Safe `timeline_event` summaries may be streamed and restored into the current assistant message as a collapsible run trace, but provider reasoning, prompts, raw tool JSON, and replayed messages must never be included.

If `web_search` is used, the visible assistant answer must include clickable source URLs. The AgentBackend adapter extracts sanitized `sources` from the `web_search` tool result, and the output normalizer appends a Sources section when the model omitted citations. If no usable source URL is available, the answer is blocked instead of being stored as an unsourced search conclusion.

Direct Canvas delivery also uses those sanitized sources. Source links are collected from `web_search` events first and Markdown links second, deduplicated by URL, and written to a dedicated `来源` / `Sources` reference node when available.

Streaming progress nodes are not final-output evidence by themselves. A run with only progressive `canvas_delivery_research_committed` or `canvas_delivery_body_checkpoint_committed` events and no final assistant text still fails as a runtime error; the preserved progress nodes and body checkpoint are recoverable work product, not proof that the assistant completed the requested task. On successful generic progressive delivery, the final assistant text replaces the stable `正文` / `Body` draft and emits `canvas_delivery_body_final_committed`. Explicit direct Canvas delivery still uses the dedicated structured delivery planner and is not overwritten by the generic final-body path. On runtime failure, the server updates `整体概述` / `Overview`, commits a `运行失败` / `Run failed` summary node, and emits `canvas_delivery_failed_summary_committed`.

Direct delivery source nodes store sources as Markdown links. The Canvas node renderer is responsible for displaying clickable link titles instead of raw `[title](url)` syntax, and table-heavy body nodes rely on the Canvas Markdown renderer for compact table display.

Recoverable AgentBackend failures are runtime events and explicit API errors. If AgentBackend returns no user-visible text or returns content classified as internal/runtime-only, FacetWrite records `agent_backend_runtime_failed` without creating a successful assistant response. Mock output requires explicit local development opt-in; the local Provider runtime is not called by generation.

## Agent Runtime Main Agent And Subagents
Agent Runtime is FacetWrite's internal execution subsystem when `AGENT_BACKEND_ENABLED=true`; the current adapter is AgentBackend.

- AgentBackend `lead_agent` acts as the main orchestration Agent for the current adapter.
- Default local validation uses the project-managed Gateway at `http://127.0.0.1:8001`; explicit Docker validation uses nginx at `http://127.0.0.1:2026`.
- Runtime status reports `deploymentMode` and `sandboxProvider` so the UI does not confuse local process execution with container isolation.
- AgentBackend enablement uses `AGENT_BACKEND_*` env keys only; stale `DEERFLOW_*` values are historical and leave the runtime disabled.
- The neutral `ChatAgent` profile maps to an Agent Runtime subagent configuration; legacy Task-card ids are normalized before mapping.
- The current mapping lives in `server/runtime/agentBackendAdapter/taskAgentMapping.ts`, with `server/agentBackend/taskAgentMapping.ts` kept as a compatibility export.
- Subagent metadata includes name, description, system prompt, skills, tools, model inheritance, timeout, and max turns.
- FacetWrite records AgentBackend runs as provider `agent-backend`.
- The TypeScript run loop remains legacy compatibility code and is not a product fallback. Agent Runtime is the only real generation path.
- Runtime status is exposed through `/api/agent-runtime/status`.
- Skills and MCP server overview are read through `/api/agent-runtime/config`; MCP environment and secret-like values are redacted before reaching the frontend.
- AI runtime status, Agent mapping, and ToolUse bridge progress are exposed through `/api/agent-runtime/dashboard` and shown in the AI Dashboard. `/api/agent-backend/*` remains a compatibility alias.
- FacetWrite sends per-run bridge context to AgentBackend: allowed tool refs, effective tool state, explicit context values, selected Canvas node id, and current chat instruction.
- FacetWrite also sends Memory isolation context. `facetwrite_memory_enabled` defaults to false unless the current Agent settings explicitly enable Memory; FacetWrite-managed Memory content is sent only from `.facetwrite/memory/`, never from AgentBackend's legacy global memory store.
- AgentBackend loads FacetWrite bridge tools from `deerflow.tools.facetwrite_bridge`. Tool loading is part of the connection contract, not just runtime UI state. `modules/agent-runtime/config.yaml`, `modules/agent-runtime/config.example.yaml`, `modules/agent-runtime/backend/packages/harness/deerflow/tools/facetwrite_bridge.py`, `server/tools/catalog.ts`, and frontend `ToolRef` types must stay aligned on the active FacetWrite bridge set: `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`. `quick_messages` is a historical tool reference only; it must not appear in active Agent Runtime config or ToolRef contracts.
- `knowledge_base` bridge calls prefer KnowledgeService RAG results and pass optional selected `baseIds`; explicit runtime context values are only the fallback when no Knowledge result is available.
- The bridge calls FacetWrite `/api/internal/agent-runtime/tool-call`, so ToolUse policy remains enforced by FacetWrite. `canvas_write` may directly commit low-risk create/append operations through FacetWrite's server-owned policy path and keeps destructive operations pending for approval. `/api/internal/agent-backend/tool-call` remains a compatibility alias; `/api/internal/deerflow/tool-call` is deprecated and exists only to protect already-running legacy sidecars.
- AgentRuntime does not own FacetWrite product data. Threads, messages, Canvas nodes/edges/write requests, settings, and Knowledge metadata stay in FacetWrite storage; AgentRuntime can affect them only through the backend adapter and internal ToolUse bridge. It must not bypass frontend Canvas context filtering, and it must not call Canvas repositories or storage facades directly.
- Canvas Workflow suggestions are low-risk additions when routed through FacetWrite APIs: creating nodes, edges, appending body text, and writing suggestions are allowed product operations. Replace, overwrite, and delete operations still require the existing approval path.
- `web_search` is verified separately as a AgentBackend built-in tool, not as a FacetWrite local bridge.
- Local and Docker acceptance targets remain `/health`, backend auth, runtime config, provider `agent-backend` generation, repeated no-fallback runs, built-in ToolUse, Skills/MCP/Memory/subagents, and FacetWrite bridge ToolUse. Docker-only sandbox facilities are tested separately.
- After changing Agent Runtime config, Python bridge code, or FacetWrite generation/runtime code, restart the local Runtime and Node API before judging UI behavior. The local Python Gateway and `tsx server/index.ts` do not reliably reload these connection contracts in place.

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
- `clear_context`: local context control tool, low risk.
- `canvas_write`: local high-risk write proposal tool, requires approval.

## Tool Policy
`server/tools/policies.ts` derives runtime policy from Agent tool refs, saved settings, and per-run tool state.

A tool can auto-run only when it is enabled, does not require approval, and does not require missing external configuration.

`server/tools/toolPolicyGuard.ts` is the execution-time gate. It rejects unknown tools, tools not allowed by the active Agent, tools disabled for the current run, and tools that require missing external configuration before the executor branch runs.

`canvas_write` must never bypass FacetWrite policy or trust model arguments over server-recognized intent. Replace, overwrite, delete, and other destructive operations create a pending request/proposal for user confirmation. Low-risk create/append operations may be committed directly only by the server-owned bridge or direct Canvas delivery planner, using the Thread-owned Project and stable ids.

`canvas_write` defaults created nodes to `document` unless the tool request explicitly supplies a valid Canvas node kind. This preserves the rule that AI output appears as editable documents by default.

If the user directly says to write/save/add content to Canvas and the operation is low risk, the server may commit it during the run and emit safe Canvas node timeline summaries. Existing pending requests from earlier runs are deliberately excluded so stale suggestions cannot be applied accidentally.

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

Plan mode has stricter completion rules than ordinary chat. AgentBackend receives a stable phase attempt id and exactly one stage-specific submission contract. Repeated model calls in the same attempt are not allowed to force the stage tool again. The server-owned executor accepts a successful execution unit only after an `artifact_committed` event; waiting-for-user and failed states are the only valid no-artifact exits.

For `/api/generate/stream`, the TypeScript run loop uses provider streaming when available. It forwards assistant content deltas as `token` events, emits transient `status` events around thinking, ToolUse/searching, writing, and finalizing phases, and still accumulates the same final text for normalization and persistence. `timeline_event` is a separate safe UX stream for public run summaries; the frontend attaches it to the active assistant message rather than showing raw tool events in a separate drawer. If a direct Canvas delivery run emits a `facetwrite_canvas_delivery` fenced block, the progressive text gate suppresses that block from streamed UI text; the final backfill uses the parsed `assistantText`.

When Agent Runtime is enabled, `server/runtime/agentBackendAdapter/client.ts` calls `/api/runs/stream` through the backend AgentBackend auth session, maps token/message stream output into the FacetWrite response, forwards assistant message chunks as `token` events, and maps AgentBackend custom task events into `AgentBackend_*` tool events for the run history. Canvas and Artifact lifecycle events are safe to consume during the stream; the frontend may refresh Canvas/Plan surfaces immediately and still reconcile the final Thread state after `final`.

AgentBackend failure returns stable `runtime_unavailable`, `runtime_auth_failed`, `model_required`, or `model_not_ready` diagnostics. It does not call the TypeScript/provider loop or persist Mock output unless `FACETWRITE_MOCK_FALLBACK_ENABLED=true` is deliberately enabled for local demonstration.

`server/services/generationService.ts` is now a compatibility export. The domain public entry is `server/domains/generation/index.ts`, which exposes prompt/message/model preparation, Agent Runtime runner, provider runner, mock fallback integration, and run recording while preserving the existing `/api/generate` contract.

## Provider Boundary
Provider-specific request normalization belongs in `server/providerRuntime.ts`. UI and product code should use provider IDs and capabilities rather than inferring provider behavior from base URLs or model strings.

Provider API credentials belong to the configured model API store, not Agent settings. The Model Config page writes local `API + model` bindings to `.facetwrite/provider-apis.json`; runtime code resolves the current Thread's `configuredModelApiId` immediately before generation. If the selected conversation model is deleted, disabled, or keyless, generation returns a clear `model_required` or `model_not_ready` error and the UI should direct the user back to Model Config.

The Agent Settings page has no model tab. Conversation model selection is visible in the workspace composer and persists on `threads.configured_model_api_id`. Switching Agents must not change the current Thread model.

Provider-private fields are allowed only inside the runtime request chain. DeepSeek thinking mode may return `reasoning_content`; when an assistant message also contains `tool_calls`, that field must be preserved for later DeepSeek API calls, but it must never be recorded as visible assistant text, output version content, Canvas content, or mock fallback text. Other providers strip DeepSeek-only fields according to their provider profile.

The workspace chat composer may send per-run model overrides for DeepSeek Think mode and reasoning effort. These overrides affect only the current request; saved Agent settings remain the default configuration source.

DeepSeek prefix completion remains a separate response mode: only the final assistant message may carry `prefix: true`, and only DeepSeek uses the beta base URL for that mode. Canvas writes continue to use tool calls plus FacetWrite approval, not prefix completion.

## Conversation Runtime Policy (2026-06-12)

- Conversation model choices come directly from enabled, keyed `modelType:"chat"` Model Configs and are grouped by capability.
- New conversations inherit the Project's most recent valid model, then global recent/active/first valid chat configuration.
- Context composition is private and bounded. The default UI does not expose Project model allowlists or manual Canvas/output context checkboxes.
- Clear context is a one-shot persisted Thread operation. It keeps history visible and excludes messages before `context_reset_at` from later model requests.
- Runtime/model failures never become successful Mock assistant messages unless explicit local fallback is enabled.

## Plan Skills

Plan phases force-load `modules/agent-runtime/skills/public/brainstorming` or `writing-plans`. Skills guide content only. Intake exposes `plan_clarification_submit`, revision exposes `plan_revision_submit`, and approved execution exposes `artifact_stage`; broad `plan_update` is not exposed to models. Product services own lifecycle status, retries, pause/resume, and completion.

## Per-Message Skill Selection

Agent settings remain the durable profile-level Skill source. The right collaboration composer and bottom Canvas toolbar can also override public Skills for one message through `transientSkillRefs` and `disabledSkillRefs`. Runtime prompt construction merges Agent default Skills, composer-selected transient Skills, removes user-disabled defaults for this run, and then adds any server-forced Plan Skill. Plan-forced Skills cannot be disabled by the UI.

Public Skills are discovered recursively from `skills/public/**/SKILL.md` and `modules/agent-runtime/skills/public/**/SKILL.md`. Project default Skills live under `skills/public/default/<skill>/SKILL.md`; the API reports that folder as `default` and the UI labels it "Default skills" / "默认技能". Legacy one-level project Skills are temporarily categorized as `default`. New folders such as `skills/public/research/...` become new UI groups without frontend category code.

The bottom Canvas Skills panel is also the project Skill folder management surface. It can create, rename, and delete empty project folders, move project Skills between folders, and show Skill details. These operations are limited to `skills/public` and use safe resolved-path checks; `default` is locked, and Agent Runtime Skills from `modules/agent-runtime/skills/public` are read-only. The right composer keeps the compact per-message selector and does not expose folder management controls.

The maintained implementation contract for Skill folder management lives in `docs/SKILL_MANAGEMENT.md`. Update that document when changing catalog fields, folder mutation rules, or per-message Skill override behavior.

Transient enable/disable choices are intentionally not saved back to Agent settings, Project state, or Thread defaults. The frontend may show enabled and disabled Skill chips near the composer, but it sends only Skill refs. Skill content is loaded server-side from the public Skill roots and remains private runtime context.

When transient Skills are successfully loaded for a streaming run, the backend emits one safe Run Trace `decision` timeline event naming the Skill ids. The event payload is limited to `{ source:"composer", skillRefs:[...] }`; it must not include Skill file bodies, prompts, user messages, tool arguments, or internal context.

## Canvas Action Orchestration

Explicit single-node Canvas create/append instructions are recognized before generation and carried as a structured `canvasAction`. Agent Runtime forces `canvas_write` once for those tool-managed actions; the server-recognized operation is authoritative over model arguments. The internal Bridge resolves the real Project from the Thread, commits low-risk create/append operations directly, and returns a real `nodeId`. Replace and other destructive operations remain pending for approval. An Agent response is not evidence of success without a structured committed event.

Direct multi-node Canvas delivery is server-managed and does not depend on the model calling `canvas_write`. It is handled after output normalization for requests such as "总结到画板里", "整理成节点", "放进 Canvas", "summarize this to canvas", "turn this into nodes", and "make canvas cards". The Agent prompt receives a private `Canvas Delivery Contract` asking for a `facetwrite_canvas_delivery` block with `assistant_reply`, `outline_markdown`, `body_markdown`, and `sources`; this block is deliverable content, not hidden reasoning. If the block is missing, the server falls back to cleaning completion chatter from the assistant text and extracting headings/lists and source links.

The direct delivery planner always commits the same final phase order: `outline` document node titled `整体概述` / `Overview`, one or more `body` document nodes split with `splitCanvasText()`, then a `sources` reference node when links exist. Streaming long tasks may add `research` or `progress` reference nodes before those final phases, and failed runs may add a `failure` node after retained progress. Nodes and edges use stable delivery ids and metadata with delivery id, phase, page index, and page count. Timeline summaries report the safe public phases and node commits only; prompts, messages, raw tool JSON, and provider reasoning remain excluded.

Current default delivery geometry is intentionally wider for readability: `outline` 520x260, `body` 640x520, and `sources` 520x320, with wider horizontal spacing between phases. Retrying the same delivery id updates existing delivery nodes with the current content and layout contract instead of keeping stale narrow geometry.
