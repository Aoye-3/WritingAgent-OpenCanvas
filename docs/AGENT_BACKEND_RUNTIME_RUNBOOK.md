# AgentBackend Runtime Runbook

## Plan Stream Diagnostics

FacetWrite requests `messages-tuple`, `custom`, and `values`; the Gateway may emit LangGraph `messages` after normalizing `messages-tuple`. The adapter accepts both names, subgraph tuples, text blocks, and final `values`. Deltas are accumulated per message id and only the final visible AI message is returned.

Plan/Artifact bridge results preserve structured payloads through the private `__FACETWRITE_EVENT__` envelope. A run with no assistant text but a valid Plan/Artifact event is successful. A run with neither reports that it completed without visible text or structured events instead of claiming the backend is disconnected.

`PlanToolChoiceMiddleware` enforces one stage-specific submission per stable phase attempt. Intake exposes `plan_clarification_submit`, revision exposes `plan_revision_submit`, and approved execution exposes `artifact_stage` for the current step. The product `PlanOrchestrator` owns lifecycle state; the model never calls the legacy broad `plan_update` path. FacetWrite validates stage postconditions after the stream, so unsupported provider behavior pauses visibly instead of producing a false successful answer.

Middleware changes require restarting the project-owned local Gateway with `npm run agent:down` followed by `npm run agent:up`; reusing an already-running Gateway does not reload Python modules.

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

When a clarification answer resumes a task, confirm `requestContext.agentClarification` includes the stored clarification id and selected option, and that the next runtime request restores the original instruction, transient Skills, disabled Skills, runtime budget, and Canvas workflow from `resumeContext`. For long Skill tasks, the resumed run should re-enter progressive Canvas delivery and emit/update progress, outline, or body-draft nodes before finalization when evidence tools run.

## Progressive CanvasWrite Diagnostics

Progressive long-task runs should expose all three delivery surfaces together:

- `canvas_write` with `facetwrite_canvas_write_scope:"short_progress_nodes"` for short summary, overview, progress/reference, and references nodes.
- `write_file` for the full Markdown deliverable under `/mnt/user-data/outputs/*.md`.
- `present_files` so FacetWrite can mark the matching `file_document` node as preview-ready.

Do not debug missing final documents by removing `canvas_write`; that also removes the Agent's short-node delivery path. Instead, confirm the request context includes `facetwrite_canvas_write_policy`, and inspect bridge failures for `short_progress_content_too_long`, `short_progress_long_form_title`, or `short_progress_node_kind_not_allowed`. Those failures mean the Agent tried to use CanvasWrite for long-form or file-document content and must switch to `write_file` plus `present_files`.

Skill scope guard is the exception: its first pass must expose only `ask_clarification`, with no progressive delivery, file tools, evidence tools, or CanvasWrite scope. After the user answers, the resumed run restores progressive delivery and the short-node CanvasWrite scope.

This historical path is kept for compatibility. The maintained runbook is now [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md).
# FacetWrite Model Config Synchronization (2026-06-11)

FacetWrite Model Config is the only model/API configuration source for generation.

- On API startup and after Model Config create/update/delete, FacetWrite sends enabled chat models to `PUT /api/models/runtime-sync`.
- AgentBackend replaces its in-memory model allowlist with the synchronized entries.
- The stable Model Config ID is used as AgentBackend `model_name`.
- AgentBackend must reject requests without `model_name` or with an unknown ID; it must not select the first configured model.
- Run requests include real Project and Thread IDs. Agent-owned memory is disabled; Project context is assembled by FacetWrite.
