# FacetWrite Technical Decisions

## 2026-07-14: Durable Tasks Use Guarded Completion And Persisted Continuation

Decision: Keep a useful process reply visible without treating it as task completion. Durable Runtime runs may auto-continue a pure action promise twice inside the same LangGraph graph. FacetWrite then evaluates completion before Canvas finalization or Plan completion. If work is still incomplete, it atomically records the nonterminal run and a server-owned continuation descriptor. A later standalone `continue` claims that descriptor and starts normal input on the same Runtime thread; it does not fabricate clarification `command.resume` metadata.

Reason: A model can say that it will start searching or synthesize results and then naturally exit. Treating that text as final can commit placeholder prose to Canvas, lose Skills/budgets/Plan position, or make a later `continue` start an unrelated task. Browser-only state cannot survive refresh, stream failure, concurrent requests, or service restart.

Impact: `durable_task_continuations` owns the `ready | claimed | completed | failed | superseded` lifecycle. Claims are atomic, retries are idempotent by `clientRequestId`, and requeued attempts preserve a delivery-scoped chain of safe evidence. Public APIs expose only `state`, `canContinue`, `attempts`, and an optional allowlisted `lastError`. Checkpoint-backed Agent clarification remains a separate persisted protocol using `command.resume`. Detailed ADR: `docs/decisions/ADR-2026-07-14-durable-task-premature-exit-continuation.md`.

## 2026-07-10: Cloudflare Tunnel Is A Temporary Remote Test Path

Decision: Use Cloudflare Tunnel as a temporary remote testing bridge for the local Windows App Shell instead of moving storage, Express, or the Python Agent Runtime onto Cloudflare in this stage.

Reason: The current goal is remote smoke validation and demos while preserving the local-first data model and avoiding an expensive AgentRuntime rewrite. Cloudflare can provide a public HTTPS entry, but the reliable execution path remains the project-managed local Node API and Python Gateway.

Impact: `npm run cloudflare:app-shell` starts the local App Shell and prints a temporary `trycloudflare.com` URL. The machine must stay online. `.facetwrite/**`, SQLite, uploads, outputs, Knowledge, Memory, provider keys, and Agent Runtime ports remain local. Production Cloudflare storage, named tunnels, Containers, D1, R2, and Vectorize are deferred decisions.

## 2026-07-09: Skill Selection Uses A Shared Dialog Layer

Decision: Render Home and Canvas Skill selection through a shared `SkillPickerDialog` portal mounted to `document.body`, with fixed modal-layer positioning and `z-index: var(--z-modal)`. `AIComposer` and `WorkspaceUtilityBar` open this dialog and pass existing Skill catalog/toggle props; `SkillFolderPicker` remains the behavior owner.

Reason: The old local absolute menus were clipped by composer cards, drawers, Canvas containers, and ancestor overflow/stacking contexts. Increasing local `z-index` could not reliably escape those layout boundaries.

Impact: New Skill picker entry points must use `SkillPickerDialog` instead of reintroducing `.composer-skill-menu` or `.board-skill-menu`. Tests should guard the shared dialog wiring, old menu class removal, Escape/close dismissal, and scrollable dialog body. Detailed ADR: `docs/decisions/ADR-2026-07-09-skill-picker-dialog-layer.md`.

## 2026-07-09: Progressive CanvasWrite Keeps Scope And Skips Untargeted Updates

Decision: Keep progressive long-task `canvas_write` inside the `short_progress_nodes` scope even when a structured `canvasAction.requiresTool` forces the tool to be available. Tool Runtime must reject a forced `replace` or `delete` before storage when no target node is resolved from `canvasAction.targetNodeId`, tool args, or the selected Canvas node. The diagnostic is `canvas_mutation_failed` with `reason:"missing_target_node"` and should be treated as recoverable noise in live/timeline UI.

Reason: A reproduced long-task run completed through server-owned `canvas_delivery`, but Agent Runtime also emitted repeated `canvas_write` failures because a forced update path reached `createCanvasWriteRequest()` without a valid target node. Those failures polluted the run trace and could make visible Canvas summaries look failed even though `file_document` and final delivery events existed. The fix should protect the auxiliary ToolUse path without changing final Markdown, file document, or `canvas_delivery` finalization.

Impact: `canvasWriteScopeForRun()` no longer clears progressive scope for `canvasActionRequiresTool`. `toolRuntime` guards untargeted `replace/delete` before repository validation. Frontend live tool presentation and persisted run timelines suppress this specific guard event as a main failure while retaining the diagnostic payload. Targeted destructive writes still require approval, low-risk create/append behavior is unchanged, and terminal delivery remains based on `canvas_delivery_body_final_committed`, `canvas_delivery_file_document_committed`, committed Canvas mutations, final assistant text, or committed Plan/Artifact events.

## 2026-07-08: Budget Gate Violations Use Finite Finalization Retries

Decision: Keep budget-gate tool narrowing, but replace the first-violation hard replacement with a bounded 1+3+1 finalization retry loop. After the hidden budget notice, non-finalization tool calls or internal tool protocol count as violations. The first violation appends a strong hidden finalization prompt; violations two through four append stricter prompts that list the allowed finalization paths; the fifth violation emits `finalization_retry_exhausted` telemetry and returns a recoverable partial state. Allowed finalization tools such as `canvas_write`, and for file delivery `write_file` / `present_files`, continue normally and do not count as violations.

Reason: The old immediate replacement prevented runaway exploration, but it could surface a status sentence that looked like a final answer and left the UI in an ambiguous "continuing" state. Fully removing the guard would push normal budget behavior back toward the LangGraph `recursion_limit:160` fuse. Finite retries give the Agent a few chances to obey the narrowed tool surface while still bounding cost and preserving the hard fuse as a last-resort safety guard.

Impact: `PlanToolChoiceMiddleware` owns retry prompting and emits `finalization_retry_count`, `finalization_retry_limit`, and `finalization_retry_exhausted` in `synthesis_gate` telemetry. `completionEvaluator` treats exhausted finalization retries as `partial` even when fallback text exists. The AI drawer recognizes this telemetry as a budget-continuation condition and offers the existing continue-finalization draft. Detailed ADR: `docs/decisions/ADR-2026-07-06-layer-agent-budget-gates.md`.

## 2026-07-08: Ordinary Agent Clarification Uses Ordinary Intake

Decision: Keep the existing `agent_clarification_requested { question, options }` protocol for ordinary Agent clarification, but move ordinary multi-question behavior into an explicit Ordinary Intake stage before execution. The generation service injects `ordinaryClarificationIntake` with `state`, `maxRounds`, `minAnsweredRoundsAfterFirstAsk`, `answeredRounds`, `remainingRounds`, and an answered question/answer summary. While intake is collecting, Runtime can only use intake tools: `ask_clarification` and, when allowed by the round policy, `agent_intake_complete`. After intake completes, execution no longer exposes ordinary `ask_clarification`.

Reason: The stable product surface is already built around a single pending clarification row, a single composer choice card, and a single-answer resume payload. Moving to a multi-field Human Interaction protocol would be a larger architecture change and would risk the current durable clarification path. Keeping follow-up questions inside execution was too easy for the model to skip after one answer because execution tools and delivery context competed with clarification. The Skill scope guard already proved that multiple turns of single-question intake can work when the phase is isolated; ordinary tasks need that same staged behavior, not a new UI contract.

Impact: `ask_clarification` remains a single `question` plus 2-3 structured `options`; there is no `questions[]`, no new Human Interaction table, and no frontend form migration. If an ordinary task starts asking, the default policy requires at least two answered clarification rounds before `agent_intake_complete` is exposed; the task may still complete intake immediately before asking anything when the request is already sufficiently scoped. Ordinary clarification counts exclude Skill scope guard and Plan clarification records. Skill intake keeps its separate slot-based `MAX_SKILL_INTAKE_ROUNDS` behavior. Tests should cover dynamic intake tools, answered-summary injection, the 3-round stop condition, execution tool restoration after `agent_intake_complete`, and the Python tool schema staying single-question. Detailed ADR: `docs/decisions/ADR-2026-07-08-ordinary-agent-intake-stage.md`.

## 2026-07-07: Answered Clarification Restores Execution Budgets

Decision: Treat an answered Agent clarification as execution once the server scope guard has enough information, or once its maximum intake rounds have been reached. In that state FacetWrite marks the payload `agentIntake.phase:"execution"` / `completed:true`, restores progressive Canvas delivery, evidence tools, `write_file`, `present_files`, and the effective runtime budget profile from clarification `resumeContext`. The ask-only `skill_scope_guard` path remains active only while required slots are still missing.

Reason: The previous clarification-resume rule treated every answer as another intake checkpoint. That protected Canvas context during early clarification, but it also stripped `progressiveCanvasDelivery` and the low-profile `facetwrite_*` budget fields from answered execution requests. Long research tasks then ran without middleware synthesis pressure and fell through to the LangGraph `recursion_limit:160` fuse, making the product budget look like it had been ignored.

Impact: `agentIntakePolicy` detects answered clarifications separately from pending intake, `generationService` rebuilds execution context from `resumeContext`, and `agentBackendRunner` applies the same execution marker for direct runner inputs. Gateway run records preserve original `body.context` in `kwargs.context` so post-failure diagnostics can verify whether `facetwrite_recursion_limit:80` and related budget fields were present. The 2026-07-05 intake isolation decision still applies to pending or under-scoped clarification, but not to answered requests that are ready to execute.

## 2026-07-06: Agent Budget Gates Narrow Tools Before The LangGraph Fuse

Decision: Keep the expanded LangGraph `config.recursion_limit` as the runaway-loop fuse, but make FacetWrite middleware the normal budget-stop path. When evidence, model-call, or step-reserve budgets reach synthesis territory, middleware emits `synthesis_gate`, appends a hidden synthesis notice, narrows available tools to finalization tools, and treats later exploration tool calls or internal tool protocol as budget-finalization violations. Completion evaluation treats final text, final Body, file document, committed Canvas mutation/node events, and committed Artifacts as terminal delivery; Canvas research/progress nodes and `Body draft` checkpoints remain recoverable intermediate artifacts only.

Reason: Advisory-only budget notices let the Agent continue tool loops until LangGraph raised `GraphRecursionError`, which made budget exhaustion look like a runtime crash. Checkpoint-only Canvas delivery could also be mistaken for completion even though the final deliverable was not committed.

Impact: `PlanToolChoiceMiddleware` owns budget-phase tool narrowing and exposes `budget_phase`, `allowed`, and `blocked_tool_calls` telemetry. `completionEvaluator` owns terminal-delivery classification and must not let body checkpoints complete a run by themselves. The 2026-07-04 recursion-budget decision remains valid for the larger hard guard, but its advisory-only middleware impact is superseded. Detailed ADR: `docs/decisions/ADR-2026-07-06-layer-agent-budget-gates.md`.

## 2026-07-06: First-Stage Harness Updates Use Source Git

Decision: First-stage Harness/App Shell updates use the current source checkout and the allowlisted `origin/main` channel. Electron/App Shell owns `git fetch --prune origin`, preview, fast-forward apply, dependency install, service shutdown, and restart orchestration. Express may expose update status or preview data later, but must not run Git or overwrite its own running code in-process. Renderer UI calls Shell IPC only.

Reason: OpenCanvas is currently operated as a source-development checkout rather than a packaged installer. The product needs a way to refresh Harness source, frontend/backend code, Agent Runtime source, built-in Skills, demo assets, docs, and defaults while preserving the local-first user data boundary.

Impact: Apply requires a clean worktree, non-detached HEAD, allowlisted origin remote, expected HEAD match, no protected-path changes, and a fast-forward target. It must not clone, worktree, mirror, synchronize arbitrary GitHub URLs, stash, rebase, reset, resolve conflicts, or create merge commits. Source updates may update Git-tracked application files, but must never write `.facetwrite/**`, `FACETWRITE_APP_ROOT` data, `.env*`, provider API stores, SQLite files, Thread `user-data`, Knowledge, Memory, thumbnails, dependency folders, or test/runtime temp roots. Future packaged builds may add a separate GitHub Release artifact updater with the same data boundary. Detailed ADR: `docs/decisions/ADR-2026-07-06-use-source-git-updates-for-first-stage-harness-updates.md`.

## 2026-07-05: Agent Intake Is Isolated From Execution Delivery

Decision: Split ordinary Agent clarification into an explicit `agent_intake` phase before execution. Intake exposes only side-effect-free decision tools: normal Agent intake may call `ask_clarification` or `agent_intake_complete`, while the legacy `skill_scope_guard` first pass remains ask-only for compatibility. Intake requests strip progressive Canvas delivery, Markdown file delivery, CanvasWrite policy, execution budgets, file tools, Plan execution tools, and full Canvas body content. After a user answers a LangGraph-backed clarification, FacetWrite resumes the same checkpoint with `Command(resume=...)`; the resumed checkpoint must decide whether to ask again or call `agent_intake_complete`. Only after that completion event does FacetWrite start an execution run with the full delivery tool surface.

Reason: The recurring stall was not caused by the number of questions. It happened when a user answered a clarification and the next runtime request still mixed "decide whether intake is done" with execution/canvas delivery context. That let the model see Canvas/write tools and large Canvas bodies during the clarification checkpoint, which made state transitions ambiguous and could leave the UI waiting for the next model/tool decision after a Canvas-related context leak. LangGraph resume semantics rerun the interrupted node, so side effects and delivery tools must be excluded from the intake node.

Impact: `server/services/generation/agentIntakePolicy.ts` owns phase detection, tool refs, execution promotion, and defensive Canvas sanitization. `agent_intake_complete` is an internal Agent Runtime tool that emits only `agent_backend_agent_intake_complete`; it must not write files, mutate Canvas, submit Plans, or present artifacts. Intake Canvas context is metadata-only: selected ids, node id/kind/title, workflow, and delivery ids are allowed; `content`, `body`, `markdown`, `preview`, raw text, file bodies, and reference bodies are removed before frontend submission and again before backend runtime request construction. Plan intake/revision/preflight/execution remains product-owned Plan workflow and does not enter generic Agent intake. Tests must cover intake allowed tools, resume checkpoint preservation, execution tool restoration after `agent_intake_complete`, Canvas-content stripping, and waiting-state reset when runtime emits non-waiting progress, model/token progress, intake completion, or final output.

## 2026-07-04: Markdown Preview Uses Real File Documents Before Fallback

Decision: Treat Runtime-reported `/mnt/user-data/outputs/*.md` paths from `write_file` and `present_files` as the primary Markdown delivery source. If runtime artifact archiving fails but the current Thread outputs directory already contains a readable Markdown file for the reported virtual path, FacetWrite still creates the `file_document` node for that real path. Server fallback Markdown is allowed only when no real Markdown path exists or all reported Markdown files are unreadable.

Reason: Long-form runs can produce the correct Markdown file while the artifact archive step reports failure or while a fallback summary is also generated. Letting `facetwrite-delivery-*.md` win in that state opens the wrong document, hides the actual report, and makes Claim extraction bind to the wrong source.

Impact: Progressive finalization must not let fallback files shadow readable Runtime-authored Markdown. The Markdown preview panel lists existing Canvas `file_document` nodes rather than scanning disk. Claim Review queries, extraction, and selected-text creation are scoped by Thread, `sourceNodeId`, and `sourceDocumentPath`, and switching preview documents clears local selection before loading candidates for the selected path.

## 2026-07-04: Runtime Recursion Budget Is Advisory, LangGraph Limit Is A Hard Guard

Decision: Keep `facetwrite_recursion_limit` as the FacetWrite advisory budget threshold and send a larger top-level LangGraph `config.recursion_limit` hard guard. The hard guard is `max(160, advisory recursion * 2)`. The low profile remains `80` for budget pressure, but LangGraph receives at least `160` so final Writing, `write_file`, and `present_files` delivery can finish after the advisory notice fires.

Reason: LangGraph treats `recursion_limit` as a maximum graph-step safety clamp, not as a resumable business budget. Using the low profile's `80` directly as the top-level limit caused long batch-delivery runs to fail during final file writing before hitting a normal stop condition.

Impact: The TypeScript AgentBackend adapter and Runtime Gateway must preserve `facetwrite_recursion_limit` in context/configurable fields for middleware `synthesis_gate` decisions, while expanding the top-level LangGraph limit to the hard guard. `GraphRecursionError` remains a failed but recoverable run state. The advisory-only middleware portion of this decision is superseded by `docs/decisions/ADR-2026-07-06-layer-agent-budget-gates.md`, which makes middleware tool narrowing the normal budget-stop path.

## 2026-07-03: Agent Clarification Uses LangGraph Checkpoint Resume

Decision: Treat Agent Runtime `ask_clarification` as a native LangGraph interrupt and resume the same graph thread with `Command(resume=...)` after the user answers. The runtime middleware calls `interrupt(structured_payload)` instead of ending the graph with `Command(update, goto=END)`. FacetWrite persists the structured clarification in `agent_clarifications`, stores only safe runtime resume metadata in `resume_context_json`, and maps the answer back through the AgentBackend resume path instead of turning it into a new ordinary chat instruction.

Reason: Ending the run during clarification forced the next user answer to start a fresh run. That lost the LangGraph checkpoint, made retry behavior hard to reason about, could repeat intake/clarification work, and increased the chance that progressive Canvas delivery or node state would diverge from the original task. Native checkpoint resume keeps the model/tool/Canvas flow on the same runtime thread while preserving the existing FacetWrite UI semantics.

Impact: Gateway run creation must honor `body.command.resume`; ordinary input uses `input`, resume uses `Command(resume=...)`. The Node adapter maps native runtime interrupts into the existing `agent_backend_agent_clarification_requested` event and persists the clarification as before. Answering an Agent clarification must call `resumeAgentBackendRun` when runtime resume metadata exists; missing resume metadata is a recoverable error, not a silent fallback to asking again. Plan clarification, Plan approval, and Canvas write approval remain product-owned FacetWrite flows and do not enter Runtime checkpoint resume. Blocking clarification must not commit final Canvas delivery, and any side effects around an interrupt must be after resume or explicitly idempotent.

## 2026-07-03: Agent Public Updates Are Sanitized Progress Events

Decision: Use the existing Runtime custom `agent_progress_reported` and frontend `progress_event` path for public Agent progress narration. Public updates are identified by `visibility:"public"` and `source:"agent_public_update"`, not a new SSE event type. They may include `summary`, optional `next`, and bounded `evidence` records. Runtime keeps raw lifecycle telemetry as `visibility:"raw"` and may additionally emit public narration at real execution boundaries.

Reason: Users need natural "I have done X; next I will do Y" work updates without exposing hidden chain-of-thought, prompts, raw tool arguments, raw outputs, or replayed messages. Reusing the existing progress path preserves compatibility with `status`, `tool_event`, `timeline_event`, and raw run logs while making the public-vs-raw boundary explicit.

Impact: Any public progress source must pass the Runtime, server, and frontend sanitizers. Frontend `generationClient` normalizes `progress_event` payloads before appending progress segments, and `AICollaborationDrawer` renders evidence as short chips. Tests must cover Python public payload sanitization, adapter signal mapping, frontend SSE multiline parsing, invalid or sensitive progress dropping, and raw/run-trace separation. Do not promote `run.end`, tool outputs, `reasoning_content`, `messages`, or `tool_calls.arguments` into public progress.

## 2026-07-02: Runtime Budget And Internal Output Are Completion Signals, Not Hard Stops

Decision: Treat runtime budget gates as advisory synthesis signals and internal-output blocks as redaction diagnostics. `synthesis_gate`, model-call waiting, retry, and other ordinary `run_timeline_decision` events with `status:"waiting"` must not imply pending user clarification. A valid Agent Runtime clarification requires a structured `agent_backend_agent_clarification_requested` payload with a question and at least two options, and later substantive progress clears the waiting interpretation. `internal_output_blocked` removes unsafe visible text but does not automatically create `agent_backend_runtime_failed`; completion still depends on final text, durable Canvas/file/Artifact delivery, valid clarification, or a real runtime error.

Reason: The previous hard-stop behavior made budget notices and internal-output redaction look like broken task chains. Budget gates were intended to nudge synthesis, but downstream completion logic treated generic waiting timeline entries as user clarification and treated redacted internal text as runtime failure. That caused runs to stall with "Answer the pending clarification before completion" even when the Agent was only synthesizing, waiting for a model response, or had already produced Canvas/file delivery evidence.

Impact: `completionEvaluator` owns this distinction. Tests should cover ordinary waiting timeline entries, stale clarification followed by tool/Canvas progress, budget synthesis with final text, empty assistant text with durable delivery, and internal-output blocking without runtime failure. Frontend code should render choice cards from persisted valid clarifications first and use timeline inference only as fallback. The advisory-only budget middleware behavior in this entry is superseded by `docs/decisions/ADR-2026-07-06-layer-agent-budget-gates.md`; middleware now narrows tools and blocks exploration after the budget notice while still avoiding runtime failure for redaction-only diagnostics.

## 2026-07-02: Composer Thinking UI Uses Shared Model Capability Detection

Decision: Home and Workspace chat inputs share `AIComposer` as the only maintained composer surface for per-message thinking controls. The composer must decide whether to render the thinking button through the shared model capability helper, not by provider id alone and not by the model list group label. The visible trigger uses the `thinking-mode-button` CSS contract; `thinking-mode-menu` is reserved for the popover menu.

Reason: A frontend cleanup moved Home and Workspace onto the shared composer, but old tests still inspected dead drawer markup and missed a class-name regression. The trigger was rendered with a menu class, while the CSS positioned that class as an absolute popover. Separately, some configured DeepSeek-compatible reasoning models can be grouped as `reasoning` without an explicit persisted `supportsThinking:true` flag, so strict flag-only checks hide the thinking UI even when the model id is recognizable.

Impact: `shared/modelCapabilities.ts` is the cross-layer fallback for known model thinking support. `AIComposer` is the regression-test target for thinking UI markup, model selection, Skill controls, and Plan controls. Tests must not use obsolete `AICollaborationDrawer` form remnants as evidence that the current composer UI works. Future thinking UI changes need both capability tests and rendered-component coverage.

## 2026-07-02: Canvas Stage Is Compatibility Data, Canvas Mode Drives Delivery Strategy

Decision: Retire Canvas batch Stage from the main user and runtime workflow. The top-toolbar Canvas Mode remains the user-facing strategy selector for batch delivery and diagram-oriented modes. The frontend must not render the bottom batch-step control or ordinary node stage badges. New Canvas nodes and suggestion-converted nodes must not write `metadata.workflow.stage`. Generation context may include Canvas Mode and connected Role perspectives, but must not include workflow or node stage and must not filter nodes by stage.

Reason: Stage began as a coarse delivery/context categorization, but it became weak signal once Canvas Mode and Role nodes provided more explicit strategy and targeted perspective controls. Keeping Stage visible attached stale terms such as inspiration/research/writing to nodes, encouraged users and agents to treat those labels as meaningful context, and could hide useful nodes from runtime context when historical stage metadata no longer matched the current task.

Impact: `canvas_workflows.stage/stages`, `CanvasWorkflowStage`, and compatibility routes remain so older local data and callers do not break. Existing stored `metadata.workflow.stage` values are not migrated away in this pass, but they are inert: hidden from node UI, stripped from new writes, omitted from generation context, and ignored by `buildCanvasWorkflowContext`. Role influence continues through `role` nodes plus directed `Role -> content` edges. Future delivery strategies should extend `CanvasWorkflowMode` or introduce explicit nodes/edges, not revive node-level Stage badges.

## 2026-06-30: Run Trace Is Safe Execution Narration, Not Chain-Of-Thought

Decision: Treat visible Thinking/Run Trace UI as a public execution narration layer, not as model chain-of-thought. Low-level `tool_event` records remain audit data. User-facing trace entries should be safe `timeline_event` summaries that aggregate repetitive tool lifecycle events into readable milestones, decisions, and next-step narration.

Reason: Raw tool lifecycle text explains which tool ran, but it is mechanical and lacks product intent. Exposing hidden model reasoning is not acceptable. A separate summary layer gives users useful progress context while preserving the boundary around prompts, provider reasoning, raw tool JSON, credentials, and internal context.

Impact: Frontend trace rendering should prefer summarized `timeline_event` entries over raw tool-event streams. Backend/runtime adapters may continue to persist detailed tool events for audit and debugging, but any user-visible progress copy must be sanitized and phrased as execution status, not internal thought.

## 2026-06-30: Agent Run Reporting Uses Final, Stage, And Raw Layers

Decision: Split Agent run reporting into three projections. `final` is the authoritative assistant answer, processing summary, validation outcome, and deliverable entry points. `stage` is the public in-progress Agent work report shown in the right conversation run block, backed by `agent_progress_reported` and `progressSegments`. `raw` is the diagnostic layer for model steps, tool calls, command logs, safe-point lifecycle, stdout/stderr, and trace metadata. Progress text must not be written into final assistant `text`, `reasoningText`, or Canvas deliverable bodies.

Reason: The first progress implementation proved the transport but promoted model/tool lifecycle sentences such as "Using write_file" and "Model step completed" into the main conversation. That recreated the old Thinking problem in a different slot: users saw a tool-event ledger rather than task-level work narration. The product needs the Codex-like shape where the completed answer is calm, the expandable run report explains what the Agent was doing and where a user could intervene, and raw command/tool details remain available only when explicitly expanded.

Impact: Runtime `ProgressReportingMiddleware` must treat model/tool lifecycle and ordinary safe points as `visibility:"raw"` telemetry by default. Only semantic milestones, deliverable checkpoints, failure recovery, final synthesis, and explicit user-intervention hints may become `visibility:"stage"` reports. The Node generation service may aggregate raw runtime, tool, timeline, and Canvas facts into stage summaries as a fallback, but it must dedupe repeated events and never mirror the same low-level event as main progress and raw trace copy. The frontend renders stage reports inside the assistant run block and keeps raw logs behind the run details entry.

## 2026-06-28: Runtime Budget Defaults Are Low-First

Decision: Keep the low runtime budget at `8 evidence / 2 body drafts / 18 model calls / 80 recursion / 16 reserve`, make it the persisted Project default, set medium to `12 / 3 / 24 / 110 / 22`, and make high equal the previous medium cap, `16 / 4 / 32 / 140 / 28`.

Reason: The latest long-task tests showed the old low profile was sufficient for normal progressive Canvas delivery, while the old medium profile was already large enough for the expanded run. The previous high profile made mixed stalls harder to reason about because it allowed too much waiting and tool-loop depth before synthesis.

Impact: New Projects and invalid runtime settings fall back to `low`. The composer budget selector remains a one-run override unless Project runtime settings are saved. Existing Projects with saved numeric runtime settings keep those values until the user reselects or saves a profile.

## 2026-06-28: Invalid Clarification Options Are Repaired By The Agent

Decision: When Agent Runtime emits a structured `ask_clarification` payload with too many options, FacetWrite does not truncate the options. The generation service performs one clarification-only repair pass with the same Agent context and asks Runtime to regenerate a valid 2-3 option question. Only a second invalid result is exposed as an `agent_backend_agent_clarification_invalid` diagnostic.

Reason: Truncating model-authored choices would silently change the Agent's intended decision space and could hide the option the user actually needed. Pausing immediately on a four-option payload made the task look stuck even though the Agent could usually repair its own protocol output.

Impact: The composer still renders only valid persisted `agent_clarifications`. Frontend code must not infer buttons from Markdown or truncate option arrays. Run diagnostics should distinguish the first invalid payload, the repair attempt, and a final unrepaired invalid payload.

## 2026-06-28: Thinking And Forced Tool Choice Are Model-Capability Gated

Decision: Treat provider thinking/reasoning controls and forced `tool_choice` as a model-capability-gated combination. Model config now carries `supports_tool_choice_with_thinking` as `true`, `false`, or `"unknown"`. DeepSeek starts as `false`; Kimi, Qwen, and Moonshot-style providers remain `"unknown"` until they pass local smoke tests. When a Plan, clarification, Canvas, or Skill guard phase requires a specific tool and the selected model is known incompatible, FacetWrite disables thinking only for that forced-tool model call, clears provider reasoning effort, preserves the forced tool protocol, and emits `thinking_disabled_for_tool_choice_compatibility`.

Reason: DeepSeek-compatible thinking endpoints can reject requests that combine thinking mode with explicit `tool_choice`, producing a 400 before Plan clarification or other forced-tool phases can persist recovery state. The product cannot relax forced tools for Plan intake, Plan revision, approved Plan execution, Canvas write protocols, or structured clarification, because those phases depend on deterministic tool output rather than ordinary prose.

Impact: Forced tool contracts remain the priority. Ordinary non-forced tool search can keep thinking enabled, and any provider-level incompatibility discovered later should update the model capability matrix instead of removing tools. `PatchedChatDeepSeek` also strips `tool_choice` as a provider-level safety net whenever thinking is still enabled, but orchestrated forced-tool phases should avoid that path by disabling thinking before the call. User-facing errors for this class must explain that the current model does not support thinking with forced tool calls and should suggest disabling thinking for the phase or switching models, not surface a generic internal runtime output.

## 2026-06-24: Agent Runtime Uses Split LLM Timeout Controls

Decision: Agent Runtime provider calls keep the total request timeout and the stream chunk timeout as separate controls. The validated local runtime baseline is `timeout:300.0`, `stream_chunk_timeout:45.0`, and unchanged `max_retries:2`.

Reason: Progressive Canvas delivery was not the blocking component in the repeated post-node stalls. After nodes such as Body draft or Progress note were committed, the Runtime entered the next model decision and the provider stream could remain open without yielding effective chunks. With `timeout:600.0`, that looked like near 10-minute silence; with `timeout:180.0`, the same symptom shortened to about three minutes. Adding a 45-second stream chunk timeout while keeping a 300-second total request stop completed the full workflow in about five minutes without observed negative impact.

Impact: Future silent-gap debugging should inspect `llm_call_start`, `llm_call_error`, `llm_retry`, `llm_call_end`, `timeout_s`, and `stream_chunk_timeout_s` before changing Canvas delivery or WebSearch behavior. WebSearch loop limits, tool event payloads, progressive delivery policy, and Agent clarification contracts are not timeout tuning levers. If long synthesis is cut off too aggressively, try `stream_chunk_timeout:60.0` or `90.0` with measured evidence before returning to 120/180/600-second waits.

## 2026-06-24: Agent Clarifications Are Durable Run State

Decision: Agent Runtime `ask_clarification` is persisted as thread/run/question state in `agent_clarifications`, with explicit `pending` and `answered` statuses, stable clarification ids, structured options, selected answer metadata, and `resumeContext`. A run that emits a valid Agent clarification without final deliverable content is recorded as waiting/`clarification_required`; it must not append a misleading final `run_completed` lifecycle event. Runtime events from live streaming and normalized final output are deduplicated by stable event shape, including event type, tool call id, clarification id, and question.

Reason: The `New conversation222` reproduction showed that clarification was still partly inferred from timeline side effects. Repeated clarification events could reuse `toolCallId`, the frontend could locally hide an already-answered id, and the backend could record the run as completed even though the trace said more information was required. That combination made the composer choice UI disappear while the run stayed stuck in a waiting trace.

Impact: Thread state now includes persisted Agent clarifications. The collaboration drawer derives the actionable choice card from pending persisted clarification state first, with timeline inference only as fallback. Answering a choice marks the stored clarification answered and resumes with the original instruction, Skill refs, disabled Skill refs, runtime budget, and Canvas/progressive delivery context. Manual composer submit is blocked while an actionable Agent clarification is pending, so "continue" cannot silently become ordinary chat. A waiting trace without a valid payload shows a recovery draft affordance instead of a dead state.

## 2026-06-24: Progressive CanvasWrite Is Scoped To Short Nodes

Decision: Progressive long-task delivery exposes `canvas_write` as a scoped short-node tool instead of disabling it completely. The runtime context carries `facetwrite_canvas_write_scope:"short_progress_nodes"` plus a policy contract. In that scope, `canvas_write` may create or append only short summaries, overviews, progress/research notes, and references. Full Body, Final Body, full reports, full documents, and oversized content must go through `write_file` followed by `present_files`, which creates or updates the server-owned `file_document` preview node.

Reason: Disabling `canvas_write` in progressive runs removed the Agent's ability to write useful intermediate Canvas nodes. Leaving it unrestricted caused a different failure: models could try to write long report bodies into ordinary Canvas nodes, compete with server-owned progressive delivery, repeat Canvas writes, and hit runtime recursion limits before final file delivery.

Impact: `server/services/generation/canvasWriteScopePolicy.ts` is the shared policy source for AgentBackend request exposure and local bridge enforcement. `agentBackendRunner` and `agentBackendAdapter` must not maintain separate CanvasWrite allow/deny rules. `toolRuntime` enforces the scope at execution time: invalid operations, `file_document` node kinds, long-form titles, and content over the short-node limit fail with guidance to use file delivery. Low-risk commit paths use stable ids for scoped short nodes so repeated same-title writes update instead of duplicating cards. Skill scope guard remains stricter: its first phase exposes only `ask_clarification` and carries no CanvasWrite scope.

## 2026-06-24: Skill Clarification Continuation Preserves Runtime Budget

Decision: Skill scope clarification continuation must carry an effective runtime budget and Canvas workflow across the two-phase guard. The guard `resumeContext` records the resolved `runtimeBudgetProfile` from either the request override or Project runtime settings, plus the original Canvas workflow. If Runtime returns a partial `resumeContext`, the Node generation service fills missing original instruction, Skill refs, disabled Skill refs, runtime budget, and Canvas workflow instead of trusting the partial payload as complete.

Reason: The composer may display the default medium budget without sending an explicit `runtimeBudgetProfile`, and Runtime may emit a structured clarification event with only partial resume metadata. If the selected clarification answer resumes without `batch_delivery` Canvas workflow or effective budget, progressive delivery can fail to set FacetWrite's advisory budget context and the run falls back to the Gateway hard guard without the intended synthesis pressure signals.

Impact: The adapter and Gateway must keep FacetWrite budget context and LangGraph's enforced `config.recursion_limit` related but distinct. `facetwrite_recursion_limit` from progressive delivery context stays available to middleware, and the top-level run config is expanded to the larger hard guard when the top-level value is still the default. A recursion-limit failure remains a real failed run with recoverable Canvas progress; the composer may offer a "continue" draft action, but that recovery path must preserve the same clarification answer, Skills, Canvas workflow, and budget semantics.

## 2026-06-24: Skill Scope Guard Uses Two-Phase Clarification And Structured Runtime Artifacts

Decision: Research-scope Skill guard runs as a two-phase protocol. Phase one is a clarification-only Runtime pass: FacetWrite exposes only `ask_clarification`, disables provider thinking/reasoning controls for this forced-tool call, removes Canvas/progressive/file/evidence delivery context, and requires a structured `agent_backend_agent_clarification_requested` event. After the user answers, phase two sends the original task plus the selected answer, restores normal Skill tools, thinking settings, runtime budget, and long-task progressive delivery eligibility.

Reason: DeepSeek reasoning/thinking paths can reject forced `tool_choice`, but disabling thinking alone did not cover the full failure. Runtime can successfully intercept `ask_clarification` while LangGraph streams partial `AIMessageChunk.tool_calls` with empty or incomplete args; if the adapter validates those chunks too early, the UI sees `missing_question` and the guard fails despite a successful Runtime run. The stable bridge is the middleware-owned structured payload carried on the `ask_clarification` `ToolMessage` artifact/additional kwargs, plus complete tool-call args when available.

Impact: The adapter must ignore empty/partial streamed `ask_clarification` args, accept JSON-string tool args, and map only structured Runtime artifacts or complete structured args into the public clarification event. It must not parse formatted ToolMessage content, Markdown lists, or ordinary assistant prose into buttons. Guard phase success still creates no Canvas nodes; continuation after a selected answer may resume progressive Canvas/file delivery.

## 2026-06-23: Skill Scope Clarification Is A Strict Runtime Protocol

Decision: Under-scoped research-scope Skill requests use a guarded Agent Runtime pass that exposes only `ask_clarification` and accepts only a structured clarification event. The valid contract is a non-empty `question` plus 2-3 structured `options` with `id`, `label`, and `detail` or `description`; Runtime may fall back to a single JSON object with the same shape only when a provider cannot emit the tool call.

Reason: Fixed server option templates made the clarification feel shallow and detached from the loaded Skill, while plain assistant prose such as "I need to clarify a few directions:" cannot reliably drive the composer choice UI or resume the original Skill task. A strict protocol gives the Agent the authorship of the question while keeping frontend rendering and Canvas delivery deterministic.

Impact: `agent_backend_agent_clarification_requested` is the only event that creates the Agent clarification choice card. Invalid protocol output becomes a diagnostic event and must not create buttons, Canvas nodes, final Body content, or Markdown files. The event carries `resumeContext` so the selected answer preserves the original instruction, transient Skills, disabled Skills, runtime budget, and Canvas workflow. The first guarded run creates no Canvas nodes; after a valid answer, long Skill tasks can resume progressive delivery.

Known provider/protocol issue: DeepSeek reasoning paths can reject explicit `tool_choice="ask_clarification"` unless the guard request disables thinking/reasoning for phase one. A later `missing_question` failure usually means the provider call succeeded but the adapter consumed partial streamed tool-call args or missed the middleware-owned ToolMessage artifact. Debug the Runtime/provider/adapter contract before relaxing the protocol or parsing prose as buttons.

## 2026-06-23: Agent Runtime Clarifications Use Composer State

Decision: Treat Agent Runtime `ask_clarification` as pending conversation input, not Canvas delivery. The AgentBackend adapter emits `agent_backend_agent_clarification_requested`, the run timeline mirrors it as `status:"waiting"`, and the right composer renders the existing choice-card UI from that structured timeline payload.

Reason: Blocking clarification asks the user for missing information before work can continue. Writing that prompt as a Canvas node made process UI look like deliverable content and could leave the Agent apparently stopped without an actionable composer choice.

Impact: Structured Agent clarification events must not create `kind:"clarification"` Canvas nodes or `canvas_delivery_clarification_committed` events. The frontend tracks answered Agent clarifications by `clarificationId` / `toolCallId` and continues the run with `requestContext.agentClarification`. The existing Canvas `clarification` node kind remains renderable for historical/manual nodes only.

Update 2026-06-24: Timeline rendering remains the fallback, but the maintained source of truth is now `agent_clarifications`. Frontend-local hiding by raw `toolCallId` is no longer allowed because Runtime may reuse a tool-call id across distinct clarification questions.

## 2026-06-23: Progressive Body Drafts Use Separate Canvas Nodes

Decision: Progressive long-task checkpoints update a stable `正文草稿` / `Body draft` document node instead of reusing the final `正文` / `Body` node. Final synthesis writes to the separate final Body node only when a real deliverable is available. `canvas_delivery_body_checkpoint_committed` carries draft-node live hints, not full node content.

Reason: The timeline can show `正文草稿 N` while the Canvas node title and content remain `正文`, which makes users think no draft node exists or that the final Body node is stale. Separating draft and final nodes makes recoverable work visible without blurring it with final deliverables.

Impact: Debugging progressive delivery should inspect the stable Body draft node for intermediate checkpoints and the final Body node for completed output. `bodyDraftWriteLimit` is a hard cap on checkpoint writes; research/progress nodes can continue until the evidence budget triggers final synthesis. Frontend refresh logic treats checkpoint payloads as `nodeId`/`contentPreview`/`contentHash` hints and reconciles full content through thread state refresh.

## 2026-06-23: Long Markdown Deliverables Use File Document Nodes

Decision: Represent long Markdown outputs from Agent Runtime as `file_document` Canvas nodes backed by `/mnt/user-data/outputs/*.md`, rather than storing the full Markdown in ordinary `document` node content. `write_file` and `present_files` events create or update one stable node per virtual path, and the frontend opens the full content through a read-only Markdown preview API.

Reason: Research and review tasks can produce long reports that make the Canvas crowded, expensive to include in follow-up context, and hard to scan. The Canvas should preserve the collaboration structure: overview, progress/source notes, final answer summary, references, and a compact document entry point.

Impact: `file_document` is a separate node kind, not a `document` renderer variant. It stores only short file metadata and defaults to `includeInProjectContext:false`. The preview endpoint accepts only current-thread output Markdown paths, rejects traversal and non-Markdown files, and limits read size. Medium/long tasks with two or more web-search rounds or complex long-form Skills should prefer `write_file` plus `present_files`; if Runtime omits file delivery, Node finalization writes a fallback Markdown file and creates the same document entry. Lightweight Canvas output continues to use ordinary `document` nodes.

## 2026-06-23: Progressive References Prefer Authored Document Links

Decision: Progressive Canvas finalization collects sources from final Canvas content, committed `canvas_write` content, and tool events, then prefers authored Markdown links from the final document before broad `web_search` result links.

Reason: Long research tasks may perform several web searches, but the useful bibliography is often assembled in the final Markdown report. Filling the `References` node from the first search page hides the curated arXiv/DOI links the user expects to see.

Impact: `canvas_mutation_committed` preserves extracted content sources, and final progressive delivery creates or refreshes a dedicated reference node when sources exist. Search progress nodes can still show intermediate search results, but the final reference node should prioritize the authored bibliography.

## 2026-06-23: Task Handling Policy Gates Canvas Delivery

Decision: Add a server-owned `TaskHandlingPolicy` before Agent Runtime context is sent. The policy classifies each request as `simple_chat`, `plan_intake`, `long_task`, `explicit_canvas`, or `plan_execution`, and only Canvas-eligible classes may create or update Canvas nodes. Skills and thinking mode are complexity signals, not standalone authorization for Canvas writes.

Reason: Skill-assisted Plan intake could return process text such as "I need to confirm a few key points" and the progressive Canvas finalizer treated it as deliverable body content. Short Q&A also should remain ordinary conversation even if runtime controls are enabled.

Impact: `simple_chat` and `plan_intake` are conversation-only. `long_task` and `plan_execution` can use progressive Canvas delivery, while `explicit_canvas` keeps the direct delivery planner. Final Canvas writeback rejects process clarification text and internal Runtime protocol output, preserving safe progress nodes on failure without pretending the run succeeded.

## 2026-06-21: Long Agent Runs Use Explicit Runtime Budgets And Body Checkpoints

Decision: Add a per-request `runtimeBudgetProfile` (`low`, `medium`, `high`, now default `low`) and keep long-task Canvas progress server-owned. The profile maps to an advisory recursion budget, model-call budget, evidence-tool budget, body-draft checkpoint budget, and synthesis reserve steps. During batch-delivery runs the server updates a stable `正文草稿` / `Body draft` node with working checkpoints as evidence arrives, then writes final content to the separate `正文` / `Body` node only when the runtime succeeds.

Reason: Increasing LangGraph `recursion_limit` alone hides the symptom but does not force the Agent to stop searching and write. The observed failure mode was a long tool loop that produced many reference nodes, then hit `GRAPH_RECURSION_LIMIT` before final synthesis, leaving `正文` empty. Users need visible control over run depth and recoverable body progress even when the final Agent run fails.

Impact: The composer exposes `低 / 中 / 高` as a compact run-budget control independent of thinking mode. The AgentBackend adapter forwards `facetwrite_*` budget context as advisory pressure signals and sends a larger top-level `config.recursion_limit` hard guard. Python middleware emits `synthesis_gate` and injects a final-synthesis instruction near the budget boundary without turning the budget into a tool kill switch. `canvas_delivery_body_checkpoint_committed` is a live Canvas-refresh event with a committed draft-node snapshot, not a success condition; runs with only progress/checkpoint events still fail if no final assistant text or final structured lifecycle outcome exists.

## 2026-06-21: Project Skill Folders Are Managed Through The Catalog API

Decision: Keep Skill folder management inside the existing Skill catalog surface. The bottom Canvas Skills panel can create, rename, delete empty project folders, move project Skills, and show details, while the right composer remains a compact per-message enable/disable selector.

Reason: Users need organization and one-message Skill control without turning Agent settings into a filesystem editor. Project Skills are local workspace assets, but Agent Runtime Skills belong to the runtime package and should not be mutated from the product UI.

Impact: `server/skillLoader.ts` is the only filesystem write boundary for project Skill folders. Management APIs always return a refreshed `{ skills, folders }` catalog, folder ids are restricted to lowercase letters, numbers, and dashes, `default` is protected, Runtime Skills are read-only, and Skill bodies remain private runtime context.

## 2026-06-06: Visual Board Objects Stay Separate From Semantic Nodes And Edges

Decision: Store free arrows, shapes, lightweight tables, and local asset cards in `canvas_objects`, while preserving `canvas_nodes` for writing/workflow nodes and `canvas_edges` for mind-chain and Role relationships.

Reason: FigJam-style visual annotations must not silently affect Agent context, Role influence, or directed mind-chain ordering.

Impact: The floating toolbar can create saved visual objects, but Agent selection actions remain proposal-oriented and Agent-originated content writes continue through the existing approval boundary.

## 2026-06-15: Canvas Mode Is The User-Facing Workflow Layer
Status: Superseded for Stage behavior by "2026-07-02: Canvas Stage Is Compatibility Data, Canvas Mode Drives Delivery Strategy".

Decision: Add `CanvasWorkflowMode` and expose `batch_delivery` as the first Canvas Mode. The existing writing stage remains as mode-specific batch-step state instead of the primary workspace concept.

Reason: The product centers on text nodes, batch delivery, and the canvas. Presenting inspiration/research/writing as the top-level control made the workspace look like a linear writing-stage product, while the stage data is still valuable for context filtering and node inheritance.

Impact: `canvas_workflows` stores `mode` with a default of `batch_delivery`. Existing `stage`, node `metadata.workflow.stage`, Role nodes, Role edges, suggestions, and context filtering remain compatible. Future modes can add their own behavior without deleting the current batch-delivery stage contract.

## 2026-06-15: AgentBackend Bridge Config Must Match FacetWrite Tools
Decision: Treat AgentBackend bridge tool configuration as a tested FacetWrite connection contract. The active bridge set is `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`; stale `quick_messages` references are invalid.

Reason: A FacetWrite request reached AgentBackend `/api/runs/stream` successfully, but Lead Agent startup failed when AgentBackend tried to load an obsolete `deerflow.tools.facetwrite_bridge:quick_messages_tool` target. The UI symptom looked like "AgentBackend empty response", while the actual failure was tool configuration drift between Agent Runtime YAML, the Python bridge module, and FacetWrite `ToolRef` contracts.

Impact: `modules/agent-runtime/config.yaml` and `config.example.yaml` must stay aligned with `facetwrite_bridge.py`, `server/tools/catalog.ts`, and frontend tool types. `server/agentRuntimeConfig.test.ts` loads both YAML files and verifies every configured `tools[*].use` target resolves to a real exported LangChain tool. Runtime/model failures remain visible failures and must not be converted into fake Canvas delivery nodes or Mock assistant output.

## 2026-05-30: Canvas Role Controls Are Function Nodes
Status: Superseded for Stage filtering and node-stage preservation by "2026-07-02: Canvas Stage Is Compatibility Data, Canvas Mode Drives Delivery Strategy".

Decision: Model Canvas Workflow Roles as first-class `role` Canvas nodes that apply only through directed `Role -> content` edges. Stage remains a single project/thread state and does not become a normal duplicable node.

Reason: Role is an influence relationship, not another property to pile onto every document, note, and reference node. Keeping Role as a function node preserves Canvas spatial reuse, drag/resize/delete/undo behavior, and prevents ordinary content nodes from becoming large containers for workflow controls.

Impact: Role data lives in `canvas_nodes.metadata.workflowRole`; Role effect is computed from `canvas_edges`; suggestions are anchored to the Role node while retaining `targetNodeId`; Agent context filtering reads connected Role prompts only after chain and stage filtering. New Workflow control capabilities should follow the same nodeized/relationship-driven bias when they need targeted influence, rather than adding more controls to content-node UI. Legacy `metadata.workflow.roles` is migrated into Role nodes and edges, then removed from content node metadata while preserving node stage.

## 2026-05-28: Canvas Workflow Is A Separate Layer Over Canvas V2
Status: Superseded for Stage filtering and node-stage metadata by "2026-07-02: Canvas Stage Is Compatibility Data, Canvas Mode Drives Delivery Strategy".

Decision: Add Canvas Workflow as a project-level writing-stage, node-stage, Role, and suggestion layer over the existing Canvas V2 spatial model, without adding new node kinds in v1.

Reason: The Canvas needs writing-process awareness so Agents can work on the relevant chain, stage, and Role perspective without reading the entire board. Keeping Workflow separate from React Flow spatial behavior prevents the Canvas UI, Agent orchestration, and suggestion lifecycle from becoming one tangled module.

Impact: Project stage and Role library live in `canvas_workflows`, node stage/Role membership lives in `canvas_nodes.metadata.workflow`, and suggestions live in `canvas_workflow_suggestions`. Pure vocabulary and filters live in `shared/canvasWorkflow.ts`. Agent runtime context must be filtered by selected/specified chain, workflow stage, and Role ids before execution; destructive writes still use the existing approval boundary.

Update 2026-05-30: Role membership moved out of ordinary content-node metadata. Role is now a first-class `role` Canvas node and applies through directed `Role -> content` edges only. Content nodes keep stage metadata; legacy Role arrays are migration input, not the new source of truth.

## 2026-05-20: AgentBackend Is An Internal Agent Runtime Module
Decision: Treat AgentBackend as the current implementation of FacetWrite's internal Agent Runtime subsystem. Its source is tracked under `modules/agent-runtime/`, while the FacetWrite backend talks to it through `server/runtime/agentRuntimePort.ts` and the `server/runtime/agentBackendAdapter/` implementation.

Reason: AgentBackend had already been tracked in the main repository and was no longer just reference material. Making it an explicit internal module preserves the useful runtime capability while preventing frontend, generation, storage, and documentation from depending on its historical top-level path or implementation details.

Impact: New code should use `/api/agent-runtime/*`, `npm run agent-runtime:*`, and the runtime port. `/api/agent-backend/*`, `npm run agent-backend:*`, and `server/agentBackend/*` remain compatibility aliases during migration. The Python/LangGraph runtime remains an independent process/container; it is not merged into the Node/Express service process.

## 2026-05-20: AgentBackend Rename Requires New Runtime Env Keys
Decision: Treat `AGENT_BACKEND_*` as the only active FacetWrite runtime configuration namespace after the AgentBackend rename.

Reason: Keeping `DEERFLOW_*` as live aliases would blur the boundary between FacetWrite-owned AgentBackend runtime code and the upstream/reference project identity. During live testing, stale `DEERFLOW_*` entries caused `/api/agent-backend/status` to report `enabled:false` and the UI to fall back to Mock output.

Impact: Local `.env.local` must use `AGENT_BACKEND_ENABLED`, `AGENT_BACKEND_BASE_URL`, `AGENT_BACKEND_ASSISTANT_ID`, and AgentBackend auth keys. After changing these values, restart the FacetWrite API process so dotenv reloads. Historical references may still mention DeerFlow only as upstream source context.

## 2026-05-20: AgentBackend Dev Compose Uses A Safe Acceptance Profile
Decision: Run the local AgentBackend acceptance sidecar with `agent-backend-*` container names, Docker-managed networking, and no default host Docker socket or local CLI credential mounts.

Reason: The original upstream compose shape can expose broad host control and local credential directories. FacetWrite's default local validation only needs nginx, frontend, gateway, auth, and run streaming, so the acceptance profile should reduce local blast radius.

Impact: `npm run agent-runtime:up/status/down` injects `AGENT_RUNTIME_ROOT` and manages the `facetwrite-agent-runtime` compose project. The historical `agent-backend:*` commands remain aliases. Sandbox execution or CLI auto-auth experiments must explicitly reintroduce sensitive mounts in an isolated environment. The 2026-05-20 smoke test confirmed `provider:"agent-backend"`, `usedMock:false`, and `finishReason:"agent_backend_completed"` with this profile.

## 2026-05-18: Right-side AI Chat Uses Real Streaming Preview
Decision: The collaboration drawer uses `/api/generate/stream` as a real streaming channel for AI chat replies, with transient status events and temporary assistant messages reconciled against persisted thread state after `final`.

Reason: Waiting for the complete model result creates a visible empty period. A temporary assistant avatar/status plus token/typewriter output gives users immediate feedback while keeping SQLite messages, Canvas write requests, and output versions behind the existing normalization and approval boundaries.

Impact: Provider and AgentBackend runtimes may forward assistant token/message deltas through SSE, but final recorded text still passes through `normalizeAgentRunOutput`. Obvious internal prompt or ToolUse payload leaks are buffered/blocked before initial streaming. This does not change Canvas write approval semantics.

## 2026-05-18: FacetWrite Uses A Lightweight In-Repo UI Primitive Layer
Decision: Build shared frontend primitives in `src/shared/ui/` instead of introducing AntD, MUI, Mantine, shadcn, or another large component library.

Reason: FacetWrite already has a product-specific workspace visual language in `docs/DESIGN.md`. A small in-repo primitive layer preserves that language, keeps Canvas hit-testing and approval flows under FacetWrite control, and avoids large third-party styling/runtime assumptions.

Impact: Shared UI components may standardize buttons, fields, panels, tabs, drawers, dialogs, badges, and empty states. They must not own provider, AgentBackend, Canvas approval, or storage behavior; business logic remains in feature components and hooks.

## 2026-05-18: Canvas V2 Uses React Flow With FacetWrite-Owned Persistence
Decision: Use `@xyflow/react` as the Canvas V2 viewport and node interaction engine while keeping FacetWrite's Canvas API, SQLite tables, and write-request approval boundary as the source of truth.

Reason: Node editors need reliable pan, zoom, selection, dragging, and future extensibility. React Flow provides that interaction layer without requiring backend schema changes.

Impact: `DocumentCanvas.tsx` maps persisted `CanvasNode` records into React Flow nodes. Dragging and resizing persist through `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`. Current node kinds remain `document`, `note`, and `reference`; future node types should extend the kind renderer and backend validation deliberately. AI-originated writes still go through `canvas_write_requests` and approval.

## 2026-05-18: Canvas Resize Handles Stay Inside Node Hit Areas
Decision: Use a custom eight-point resize frame rendered just outside the selected node boundary instead of relying on React Flow's default handles.

Reason: Users need a clear separation between the content box and the selection controls. The outer frame makes resize affordances visually obvious, while enlarged transparent hit targets, `nodrag nopan`, and capture-phase pointer handling keep Figma-like resize reliable.

Impact: Resize handles use enlarged transparent hit targets so users do not need pixel-perfect pointer placement. Resize changes update React Flow `style`, `width`, and `height` during pointer drag and persist `x/y/width/height` once on pointer release. While a resize gesture is active, Canvas V2 disables React Flow node/pane dragging and filters position changes for that node so resize cannot also translate the node. Future selection boxes, alignment guides, or resize affordances must preserve handle hit testing, drag locking, and live visual updates.

## 2026-05-18: Canvas Text Nodes Auto-Expand Until Manually Resized
Decision: Treat text Canvas nodes as full information blocks by default. The frontend measures persisted text content and grows node height automatically until the user manually resizes the node.

Reason: Canvas content is expected to arrive as complete material, not as a truncated preview card. Users should be able to read the full generated or approved content first, then adjust the frame like a design canvas object.

Impact: Auto-expansion is a frontend layout behavior and does not alter the Canvas schema. Manual resize writes `metadata.canvasLayout.sizeMode = "manual"` so future auto-height updates do not override the user's chosen dimensions.

## 2026-05-16: Canvas Visual Layers Must Not Block Background Drag
Decision: Keep Canvas decorative and layout layers out of pointer hit testing unless they are intentionally interactive.

Reason: The Canvas viewport owns background pan and context-menu behavior. A transparent full-size grid layer can visually look harmless while intercepting pointer events and making the center of the board feel blocked.

Impact: `.canvas-grid` is visual-only and uses `pointer-events:none`; `.canvas-node` restores `pointer-events:auto` for selection, editing, and node dragging. Future overlays such as grids, guides, empty states, selection marquees, or alignment helpers must be browser-verified so they do not block viewport drag.

## 2026-05-16: Direct Canvas Write Intent Auto-Approves Same-Run Requests
Decision: Treat explicit user write commands as confirmation for newly created Canvas write requests from the same generation run.

Reason: Users expect "写入" / "save to canvas" to apply the content, while the Agent must still be unable to mutate Canvas silently.

Impact: `canvas_write` and fallback write-intent detection still create `canvas_write_requests` first. The frontend records pending request ids before the run, refreshes thread state after the run, and auto-approves only new pending requests. Existing stale requests remain pending. Model-requested `replace` operations are honored only when the user explicitly asks to replace/overwrite; otherwise they become append/create.

## 2026-05-16: CanvasWriter Uses Proposal Plus User Confirmation
Decision: Reframe `canvas_write` from a hard approval card into a Canvas write proposal that the user can confirm from the collaboration drawer.

Reason: The Agent should be allowed to suggest useful Canvas writes, but product data must still require user intent. The UI can make confirmation lightweight without granting silent write access.

Impact: `canvas_write` still creates `canvas_write_requests` and keeps `requiresApproval:true`. The frontend may show "write all", "write annotated snippets", and "cancel"; confirmation calls the backend approve/apply flow. Temporary selected-response annotations and highlights are client-only and are not persisted.

## 2026-05-16: Threads Are The Current Project Rename Boundary
Decision: Treat local project rename as `threads.title` rename rather than introducing a separate project title table.

Reason: Current project rows, recent project cards, open behavior, trash behavior, and Canvas assets are all keyed by thread id.

Impact: `PATCH /api/threads/:threadId` updates active thread titles only. Home and Projects use the custom title as the primary label and keep AgentCard title as secondary metadata. Trash entries cannot be renamed.

## 2026-05-16: Project Bulk Operations Stay Thread-scoped
Decision: Add batch move-to-trash and batch hard-delete as thread-scoped operations.

Reason: Projects currently represent local threads. Batch management should reuse existing trash/delete semantics instead of introducing a parallel project lifecycle.

Impact: `POST /api/threads/batch-trash` works on active threads; `POST /api/threads/batch-delete` permanently deletes only threads already in trash. The Projects UI exposes selection state and a context-aware batch action.

## 2026-05-15: AgentBackend Is The AI Execution Plane
Decision: Treat FacetWrite as the workspace/control plane and AgentBackend as the AI execution/runtime plane.

Reason: The product goal is to reuse AgentBackend's mature Lead Agent, subagent, ToolUse, and MCP framework instead of maintaining a competing FacetWrite Agent runtime.

Impact: Agent settings remain the user configuration surface, while the AI Dashboard shows runtime health, Skills/MCP, Agent mapping, and ToolUse bridge progress. FacetWrite capabilities such as CanvasWrite should be progressively bridged into AgentBackend ToolUse while preserving FacetWrite approval and data boundaries.

## 2026-05-15: AI Dashboard Is Read-only Runtime Observability
Decision: Add an AI Dashboard as a read-only control-plane view rather than another Agent editor.

Reason: Users need to see whether AgentBackend is actually online, authenticated, mapped, and ready for ToolUse/MCP execution, without mixing runtime observability into per-Agent prompt/model settings.

Impact: `/api/agent-backend/dashboard` aggregates runtime status, AgentBackend config overview, AgentCard-to-subagent mapping, ToolUse bridge status, and integration maturity. Writing AgentBackend config remains out of scope.

Update 2026-05-25: FacetWrite-managed Memory is an explicit exception to the read-only dashboard rule. The AI Dashboard may show, edit, and clear `.facetwrite/memory/` content because users need a visible control for what Agents may remember. AgentBackend legacy global memory remains outside the active FacetWrite run path unless FacetWrite passes explicit managed memory content.

## 2026-05-15: Docker Is The Preferred Local AgentBackend Runtime
Status: Superseded by `2026-06-12: Project-Managed Local Gateway Is The Default Runtime`.

Decision: Run AgentBackend as a Docker sidecar through its Compose nginx entrypoint at `http://127.0.0.1:2026` for local FacetWrite integration work.

Reason: AgentBackend is a Python/LangGraph runtime with its own dependency and service boundary. Docker avoids the Windows-native `uv` cache permission failure previously seen during local setup and matches the intended sidecar architecture.

Impact: FacetWrite uses `AGENT_BACKEND_ENABLED=true`, `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`, and `AGENT_BACKEND_ASSISTANT_ID=lead_agent` for local sidecar validation. Docker config is kept in workspace-local `.docker-codex/` and ignored by git.

## 2026-05-15: Do Not Bypass AgentBackend Auth
Decision: Treat AgentBackend protected endpoints as an integration contract instead of bypassing auth in FacetWrite.

Reason: Docker validation confirmed `/health` is public, but `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` require AgentBackend auth. Disabling or bypassing that boundary would hide the real production contract and weaken the runtime split.

Impact: FacetWrite now uses a backend-managed AgentBackend local session for protected APIs. Session cookies and CSRF tokens stay server-side, and the frontend only sees `authState`.

## 2026-05-15: FacetWrite Uses One Local AgentBackend Service Session
Decision: Use one backend-managed local AgentBackend session for the current sidecar integration instead of per-user AgentBackend account mapping.

Reason: FacetWrite is still local-first and owns product users, Canvas approvals, and SQLite data. A single local AgentBackend session is enough to validate runtime orchestration without prematurely designing cross-system identity mapping.

Impact: `AGENT_BACKEND_AUTH_EMAIL` and `AGENT_BACKEND_AUTH_PASSWORD` configure the local session. Multi-user AgentBackend identity mapping remains out of scope until the runtime path is stable.

## 2026-05-15: AgentBackend Is The Primary Agent Runtime Foundation
Decision: Integrate AgentBackend as a sidecar Agent runtime and use its Lead Agent as the main orchestration Agent when `AGENT_BACKEND_ENABLED=true`.

Reason: FacetWrite needs mature Agent runtime capability without rebuilding LangGraph-style orchestration, subagents, skill/tool filtering, and streaming semantics from scratch.

Impact: FacetWrite keeps ownership of product data, frontend interaction, SQLite persistence, Canvas writes, and approval flows. AgentBackend runtime events are adapted into FacetWrite run records, and the TypeScript run loop remains as compatibility code during migration.

Update 2026-07-06: Superseded for fallback semantics by the Agent Runtime-only decisions from 2026-06-11 and later. Normal runtime/model failure returns explicit diagnostics; Mock output requires `FACETWRITE_MOCK_FALLBACK_ENABLED=true`.

## 2026-05-15: AgentBackend Config Visibility Is Read-only First
Decision: Expose AgentBackend runtime status, skills, and MCP server overview through FacetWrite as read-only observability before adding write controls.

Reason: FacetWrite needs to show whether AgentBackend is active and what intelligent-runtime capabilities are visible, while avoiding premature MCP/Skill mutation paths.

Impact: `/api/agent-backend/config` redacts secret-like values and the frontend displays only overview information. Writing AgentBackend skills/MCP settings remains out of scope for this phase.

## 2026-05-15: Maintain Seven Project Fact Documents
Decision: Use `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `AGENT.md`, `DECISIONS.md`, and `REFACTOR_LOG.md` as the maintained technical documentation set.

Reason: The project has moved beyond a single MVP note. AI assistants need concise current facts instead of repeatedly interpreting historical plans.

Impact: Archived research and historical plans are references only. Current implementation truth lives in code plus the maintained docs.

## 2026-05-15: Archive Research Separately From Current Facts
Decision: Move PRD, competitor research, AgentBackend analysis, and old plans under `docs/reference/`.

Reason: These files are valuable context but can conflict with the current implementation state.

Impact: Implementation work should read `docs/reference/` only when background or rationale is needed.

## 2026-05-15: Tool Catalog Is The Tool Source Of Truth
Decision: Tool names, schemas, descriptions, prompt hints, default enablement, risk levels, and approval requirements live in `server/tools/catalog.ts` and `server/tools/policies.ts`.

Reason: Duplicating Tool definitions across UI, runtime, and prompt code causes drift.

Impact: New tools must update catalog/policy docs and Agent runtime config behavior.

## 2026-05-15: Canvas Writes Require User Approval
Status: Superseded by `2026-06-13: Canvas Writes Use Operation-Level Risk`.

Decision: The `canvas_write` tool can create pending write requests only. It cannot directly change Canvas nodes. This decision is preserved by the 2026-05-16 proposal UI: user confirmation may auto-call approval, but the Agent still cannot write silently.

Reason: Canvas mutation is a user-visible data write and should not happen solely because a model produced a tool call.

Impact: UI must collect explicit user confirmation. Backend approval is the only path that applies write requests.

## 2026-05-15: Chat Completions Is The Provider Baseline
Decision: Provider runtime uses Chat Completions-style messages, tools, tool calls, and tool result messages as the common baseline.

Reason: This fits current DeepSeek, OpenAI, and OpenAI-compatible integration needs.

Impact: Provider-specific features should be normalized behind provider runtime capabilities.

## 2026-05-15: Local Secrets Stay Out Of Tracked Docs
Decision: Real API keys belong only in `.env.local` or the shell environment and must never be committed or shown by status APIs.

Reason: FacetWrite is local-first but provider keys are production secrets.

Impact: Settings save requires explicit confirmation for local key writes, and docs must avoid pasted secrets.

# 2026-06-08: Electron Owns The Windows Source-Development Shell

Status: Partially superseded by `2026-06-12: Project-Managed Local Gateway Is The Default Runtime`. Electron ownership remains current; mandatory Docker startup does not.

Decision: Use Electron as a Windows source-development application shell around the existing Vite, Express, and Docker Agent Runtime services.

Reason: The immediate goal is an independent application window with startup feedback, Vite HMR, and window-bound service lifecycle without prematurely designing an installer or native Agent Runtime.

Impact: The shell uses fixed development ports `17776` and `17777`, starts Docker Desktop when available, owns only services it starts, and preserves complete compatible pre-existing Agent Runtime services. The planned Vite port `3100` was rejected because Windows dynamically reserved `3007-3106`. Docker Desktop remains required. Packaging, automatic updates, and a no-Docker local Runtime are deferred.

Update 2026-07-06: Superseded for Runtime startup by `2026-06-12: Project-Managed Local Gateway Is The Default Runtime`. The double-click App Shell now forces local mode, does not start Docker, and uses launcher-managed dynamic Gateway ports unless explicitly pinned.

## 2026-06-12: Project-Managed Local Gateway Is The Default Runtime

Decision: Default to `AGENT_RUNTIME_MODE=local`, running the Agent Runtime Gateway with project-managed Python 3.12 and `uv`; retain Docker Compose as an explicit isolation/deployment mode and support user-managed external Gateways.

Reason: Core Agent capabilities live in the Python Gateway, not the Runtime Next.js frontend or nginx. Managing that Gateway directly removes the mandatory Docker Desktop startup dependency without rewriting the Agent protocol or dropping Skills, MCP, Memory, subagents, auth, SSE, or the FacetWrite bridge.

Impact: Local mode uses a launcher-managed `127.0.0.1` Gateway port, shared `.deer-flow` state, `LocalSandboxProvider`, and `allow_host_bash:false`. Direct low-level debugging may still pin `AGENT_RUNTIME_PORT` or fall back to `127.0.0.1:8001`. Docker remains required for `AioSandboxProvider`, Kubernetes provisioning, Docker socket workflows, and Linux-container Bash Skills. Status surfaces expose deployment mode and sandbox provider.

The Windows double-click entry `start-opencanvas-shell.vbs` is a stricter local-only contract: it overrides stale parent mode variables, never invokes Docker, and is covered by `npm.cmd run acceptance:local-runtime`. The acceptance must start from that VBS, perform five real no-Mock generations, execute Skill/Web Search, observe Memory persistence, preserve Canvas approval, and reclaim owned processes.

# 2026-06-11: Project-First Context And Explicit Model Selection

- Project is the strict workspace and shared-context boundary.
- Thread is a conversation inside a Project and does not bind an Agent.
- Agent is selected per run and begins with no personal or cross-project context.
- Project Agent input values are keyed by Project and Agent, then immediately become Project shared context.
- Model Config backend storage is the sole generation model source.
- Threads select directly from valid chat Model Config entries and inherit a persisted default; Project bindings remain compatibility data.
- Existing legacy workspace data is cleared instead of migrated from the shared `local-project` design.

## 2026-06-11: Complete Physical Project Boundary And Runtime Sync Gate

- Schema version 3 clears workspace data again and rebuilds Canvas storage with physical `project_id` ownership.
- Project Agent inputs are shared by default and protected by monotonically increasing revisions.
- Canvas nodes and output versions enter Project shared context only after explicit user inclusion; shared context uses deterministic category budgets totaling 24,000 characters.
- Model Config remains saved when AgentBackend synchronization fails, but the model is marked degraded and cannot generate until synchronized.
- New Threads resolve a valid chat model from recent/active configured Model Configs. Project model bindings remain compatibility data only.
- Agent Runtime is the only real generation runtime. Runtime failure returns explicit errors and never calls the local Provider runner or records Mock output by default.

## 2026-06-12: Direct Conversation Models, Private Context, And Explicit Failures

- Threads select directly from enabled, keyed chat Model Configs grouped as reasoning, chat, or other chat.
- Context assembly is private and bounded: explicit mind chains/selections, selected and directed-related nodes, Workflow/Role state, structured inputs, post-reset Thread history, then Knowledge.
- `threads.context_reset_at` is a soft boundary that preserves visible history. The `clear_context` bridge tool uses the same persisted reset operation.
- Mock fallback requires explicit `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; normal runtime/model failures use stable error codes.

## 2026-06-12: Plan Runtime Owns Orchestration

- Superpowers-inspired brainstorming and plan writing are adapted as project-local skills.
- Persisted Plan state, approval, step isolation, Artifact ownership, and Canvas safety remain server-owned.
- A new Plan always requests one structured clarification before producing an approval-ready task board.
- Approved execution is sequential and pauses on interruption or failure.
## 2026-06-13: Product Runtime Owns Plan Lifecycle

Plan state transitions and execution scheduling are server-owned. Models receive one phase-scoped structured contract and cannot mark steps or Plans complete. Safe activities are persisted separately from private reasoning and raw tool payloads. Canvas Plan nodes are disposable read-only projections, not authoritative state.

## 2026-06-13: Canvas Writes Use Operation-Level Risk

Explicit Canvas actions are recognized and scheduled by product services instead of relying on model tool selection. Create and append are low-risk direct commits with stable action IDs and authoritative node results. Replace, range replacement, and delete remain destructive approval-gated operations. Runtime-supplied Project IDs are never trusted over Thread ownership.
## 2026-06-13: Product Server Owns Plan Attempts And Execution

Decision: The server creates Plan intake state, injects one phase-specific model contract, and runs approved steps through a leased persistent executor. React renders state and activities but does not initiate execution steps.

Reason: Model-selected lifecycle actions and frontend-memory loops caused repeated clarification calls, silent stalls, and unrecoverable execution after refresh.

## 2026-06-29: Claim Review Uses Create/Delete Selection Instead Of Accept/Reject Review Flow

Decision: The Markdown Claim review queue presents candidates as selectable work items with `Create selected` and `Delete selected`. `Accept selected`, `Reject selected`, and `Create nodes from accepted` are no longer the primary UI flow. A real `DELETE /api/threads/:threadId/claims/:claimId` endpoint removes unwanted persisted candidates.

Reason: The intermediate accepted/rejected state made the UI feel like a separate moderation workflow when the user intent is simpler: keep useful extracted summaries by creating nodes, or remove the candidates that should not continue. The existing source highlight interaction is the evidence inspection path, so the queue should not show large evidence blocks by default.

Impact: Extraction remains non-mutating for Canvas. Creating nodes is an explicit user action from selected candidates. Candidate cards and created nodes use stable `摘要 N` display names; visible node bodies contain only `claimText`. `evidenceText`, source paths, and anchors remain persisted provenance/highlight data rather than default visible node content. Deleting a Claim candidate removes only the `claim_candidates` row and does not cascade to already-created Canvas nodes, because those nodes may have been edited, connected, or reused independently after creation. Legacy accepted-Claim create-node endpoints remain documented for compatibility and follow the same compact title/content policy.
