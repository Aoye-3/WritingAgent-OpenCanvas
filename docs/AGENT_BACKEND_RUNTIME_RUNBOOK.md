# AgentBackend Runtime Runbook

Compatibility note: this file is retained for historical AgentBackend diagnostics. The maintained runtime entry point is [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md); use `/api/agent-runtime/*` and `npm run agent-runtime:*` commands for current work.

## Plan Stream Diagnostics

FacetWrite requests `messages-tuple`, `custom`, and `values`; the Gateway may emit LangGraph `messages` after normalizing `messages-tuple`. The adapter accepts both names, subgraph tuples, text blocks, and final `values`. Deltas are accumulated per message id and only the final visible AI message is returned.

Plan/Artifact bridge results preserve structured payloads through the private `__FACETWRITE_EVENT__` envelope. A run with no assistant text but a valid Plan/Artifact event is successful. A run with neither reports that it completed without visible text or structured events instead of claiming the backend is disconnected.

`PlanToolChoiceMiddleware` enforces one stage-specific submission per stable phase attempt. Intake exposes `plan_clarification_submit`, revision exposes `plan_revision_submit`, and approved execution exposes `artifact_stage` for the current step. The product `PlanOrchestrator` owns lifecycle state; the model never calls the legacy broad `plan_update` path. FacetWrite validates stage postconditions after the stream, so unsupported provider behavior pauses visibly instead of producing a false successful answer.

Middleware changes require restarting the project-owned local Gateway with `npm run agent-runtime:down` followed by `npm run agent-runtime:up`; reusing an already-running Gateway does not reload Python modules.

For a stuck Plan run, verify model sync, Gateway HTTP/run status, the bridge envelope, persisted PlanRun/current step, `plan_executions` lease, and `run_activities` in that order. A new server process clears stale execution leases before waking running Plans.

Repository maintenance must use the current `F:\.FinalProject` checkout and a normal branch. Do not create Git worktrees or project copies on another drive.

## Agent Clarification Stall Diagnostics

Agent Runtime clarification is a durable conversation state, not just a timeline rendering side effect. A valid `ask_clarification` event with no final deliverable should leave:

- a `runs.status` value of `waiting` with finish reason `clarification_required`;
- one pending row in `agent_clarifications` for the Thread/run/question;
- a structured `agent_backend_agent_clarification_requested` tool event for audit and timeline fallback;
- no final `run_completed` timeline event unless final assistant content or a final structured deliverable exists.

If the UI trace says clarification is waiting but no option card appears, inspect `agent_clarifications` before inspecting frontend state. A pending row with 2-3 options should render the composer card even when Runtime reused a previous `toolCallId`. Do not reintroduce frontend-local "already answered" filtering by raw `toolCallId`; use the persisted `pending`/`answered` status and question-specific stable id instead.

If no pending row exists, verify that the Runtime payload has `type:"agent_clarification_requested"`, a non-empty `question`, and 2-3 structured `options`. When the only violation is too many options, the generation service should perform one clarification-only repair pass and ask the Agent to regenerate 2-3 options. Do not truncate model-authored options in Node or the frontend; if the repair also fails, surface the invalid payload as a diagnostic rather than hidden buttons. A waiting trace without an actionable payload should show a recovery draft affordance so the user is not trapped in a dead composer state.

When a clarification answer resumes a task, confirm `requestContext.agentClarification` includes the stored clarification id and selected option, and that the next runtime request restores the original instruction, transient Skills, disabled Skills, runtime budget, and Canvas workflow metadata from `resumeContext`. A resumed request is ask-only only while the server scope guard still needs more slots. Once the guard is satisfied or its round limit is reached, the answered request must be marked `agentIntake.phase:"execution"` and may expose progressive Canvas delivery, file delivery, CanvasWrite, evidence tools, and the runtime budget context. If the runtime asks another valid `ask_clarification`, the run stays waiting. If it emits `agent_backend_agent_intake_complete`, FacetWrite immediately starts the execution run with the full delivery surface restored.

For LangGraph-backed clarification, `finishReason:"clarification_required"` is not a resume credential. The stored clarification must include a complete `resumeContext.runtimeResume` with `runtimeThreadId`, `runtimeRunId`, and `interruptId`; `checkpointId` should be preserved when present. If the stream contains both `ask_clarification` and `runtime_interrupt` events for the same question, the Runtime interrupt version must win. See the maintained details in [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md#langgraph-resume-clarifications).

## Progressive CanvasWrite Diagnostics

Progressive long-task runs should expose all three delivery surfaces together:

- `canvas_write` with `facetwrite_canvas_write_scope:"short_progress_nodes"` for short summary, overview, progress/reference, and references nodes.
- `write_file` for the full Markdown deliverable under `/mnt/user-data/outputs/*.md`.
- `present_files` so FacetWrite can mark the matching `file_document` node as preview-ready.

Do not debug missing final documents by removing `canvas_write`; that also removes the Agent's short-node delivery path. Instead, confirm the request context includes `facetwrite_canvas_write_policy`, and inspect bridge failures for `short_progress_content_too_long`, `short_progress_long_form_title`, or `short_progress_node_kind_not_allowed`. Those failures mean the Agent tried to use CanvasWrite for long-form or file-document content and must switch to `write_file` plus `present_files`.

Agent intake is the exception to progressive delivery. Before execution begins, intake must expose no progressive delivery, file tools, evidence tools, or CanvasWrite scope. Ordinary intake uses dynamic side-effect-free tools: before any ordinary clarification, `ask_clarification` and `agent_intake_complete` are both available so the Agent can skip intake when the task is already clear; after one answered ordinary clarification, only `ask_clarification` is available; after two answered ordinary clarifications, `agent_intake_complete` is available again; after the three-round limit, ordinary `ask_clarification` must not be exposed. The historical `skill_scope_guard` first pass remains ask-only. After `agent_intake_complete`, the execution run restores progressive delivery and the short-node CanvasWrite scope. For answered persisted clarifications, `skill_scope_guard` uses the server slot assessment instead of `agent_intake_complete`: unanswered required slots keep the next request ask-only, while sufficient answers or max rounds promote the request directly to execution.

If a post-clarification run appears stuck, check for these boundaries before tuning Canvas delivery:

- `facetwrite_clarification_phase:"agent_intake"` or `"clarification_guard"` means the model is still deciding whether intake is complete.
- `facetwrite_intake_phase:"intake"` means CanvasWrite, `write_file`, `present_files`, evidence tools, and execution budgets should be absent.
- `facetwrite_intake_phase:"execution"` or `agentIntake.phase:"execution"` after an answered clarification means the budget/profile and delivery surface should be present again; if they are absent, inspect clarification `resumeContext` preservation and `withAnsweredAgentClarificationExecutionContext`.
- `agent_backend_agent_intake_complete` should clear UI waiting state and be followed by a new execution run.
- `agentIntake.phase:"execution"` or `agentIntake.completed:true` means the request may restore progressive Canvas delivery, file delivery, and CanvasWrite.
- Canvas context in intake should contain only metadata such as selected node id, node id/kind/title, workflow, and delivery id. If `selectedNode.content`, reference body text, Markdown bodies, previews, or file text appear in intake context, the sanitizer boundary has regressed.

When diagnosing perceived stalls after Canvas updates, separate progress commits from terminal commits. `canvas_delivery_research_committed` and `canvas_delivery_body_checkpoint_committed` are lightweight progress events: the frontend applies their node snapshot immediately and debounces the expensive Thread-state refresh. Their payload should include `evidenceCount`, `bodyDraftWriteCount`, delivery limits, and `nextPhaseHint` so the drawer can show a phase-specific message. `canvas_delivery_body_final_committed`, `canvas_delivery_file_document_committed`, `canvas_delivery_sources_committed`, and `canvas_delivery_failed_summary_committed` are terminal/strong-sync events and should refresh immediately. If the UI still feels idle after a progress commit, inspect the next Runtime event or model call before treating the debounce as a Runtime stall.

This historical path is kept for compatibility. The maintained runbook is now [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md).
# FacetWrite Model Config Synchronization (2026-06-11)

FacetWrite Model Config is the only model/API configuration source for generation.

- On API startup and after Model Config create/update/delete, FacetWrite sends enabled chat models to `PUT /api/models/runtime-sync`.
- AgentBackend replaces its in-memory model allowlist with the synchronized entries.
- The stable Model Config ID is used as AgentBackend `model_name`.
- AgentBackend must reject requests without `model_name` or with an unknown ID; it must not select the first configured model.
- Run requests include real Project and Thread IDs. Agent-owned memory is disabled; Project context is assembled by FacetWrite.
