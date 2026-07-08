# Agent Runtime Runbook

Agent Runtime is the primary AI execution subsystem when `AGENT_BACKEND_ENABLED=true`. The same Gateway, auth, SSE, Lead Agent/subagent, Skills, MCP, Memory, ACP, provider, and FacetWrite ToolUse bridge code runs in all deployment modes.

## Modes

- `local` (default): managed launchers choose an available `127.0.0.1` port and record it in ownership metadata; direct low-level calls can pin a port with `AGENT_RUNTIME_PORT`.
- `docker`: explicit Compose isolation/deployment mode through nginx on `127.0.0.1:2026`.
- `external`: FacetWrite connects to `AGENT_BACKEND_BASE_URL` and does not manage lifecycle.

The default local path does not start the Runtime Next.js frontend or nginx because neither carries core Agent capability.

## Requirements

- Node.js 22+, including `npm` and `npx` for JavaScript Skills, stdio MCP, and ACP adapters.
- `uv`; the launcher installs managed Python 3.12 into `modules/agent-runtime/backend/.uv-python`, syncs `uv.lock` into `.venv`, and launches only `.venv/Scripts/python.exe`. Both the managed interpreter and virtual environment must resolve inside the workspace.
- Docker Desktop/Engine only for `docker` mode.

## Configuration

```env
AGENT_RUNTIME_MODE=local
AGENT_BACKEND_ENABLED=true
AGENT_RUNTIME_PORT=0
AGENT_BACKEND_ASSISTANT_ID=lead_agent
AGENT_BACKEND_AUTH_EMAIL=admin@example.com
AGENT_BACKEND_AUTH_PASSWORD=<local password>
```

The local launcher reads process environment first, then `modules/agent-runtime/.env`, then root `.env.local`. Managed local startup ignores a stale `.env.local` `AGENT_BACKEND_BASE_URL`; use `AGENT_RUNTIME_PORT=<port>` or a process-level `AGENT_BACKEND_BASE_URL` when a fixed local port is required. App Shell and `npm run dev` are managed local dynamic-port flows. If the Express API/server config is run directly without launcher-injected `AGENT_BACKEND_BASE_URL`, it keeps `http://127.0.0.1:8001` only as a low-level debugging fallback. It sets project, home, config, extensions, Skills, and FacetWrite bridge paths explicitly. Secrets are never printed. Runtime state remains in `modules/agent-runtime/backend/.deer-flow` in both local and Docker modes.

## Lifecycle

```powershell
npm.cmd run agent-runtime:doctor
npm.cmd run agent-runtime:up
npm.cmd run agent-runtime:status
npm.cmd run agent-runtime:down
```

Logs and ownership metadata are written under `modules/agent-runtime/logs/`. The metadata includes the actual local port, PID, Bridge URL, source fingerprint, and token fingerprint. A healthy compatible project-owned process is reused only while its source fingerprint still matches; changed Python/config sources trigger a managed restart. An unmanaged or incompatible process on the configured port blocks startup. Shutdown only terminates the process recorded as project-owned. `status` and `down` read the actual port from ownership metadata.

Docker remains available explicitly:

```powershell
npm.cmd run agent-runtime:docker:up
npm.cmd run agent-runtime:docker:status
npm.cmd run agent-runtime:docker:down
```

## Security And Capability Boundary

Local mode uses `deerflow.sandbox.local:LocalSandboxProvider` with `allow_host_bash: false`. It preserves Gateway auth/cookies/CSRF, `/api/runs/stream`, Skills and hot reload, stdio/HTTP/SSE MCP, Memory/SQLite/uploads/events, web search, providers, ACP, subagents, and the FacetWrite bridge tools `knowledge_base`, `clear_context`, `plan_clarification_submit`, `plan_revision_submit`, `artifact_stage`, and `canvas_write`.

`canvas_write` directly commits low-risk create and append operations with stable IDs. New low-risk create nodes are placed by FacetWrite near the selected/target Canvas node, or near the current node group center when no anchor exists, while avoiding persisted node-rectangle overlap. Replace, range replacement, delete, and other destructive operations remain approval-gated.

The local sandbox tool surface also exposes file tools used by long-form deliverables: `read_file`, `list_directory`, `write_file`, and `present_files`. Keep argument aliases compatible with model/tool-call variants: `file_path` maps to `path`, and `file_paths` maps to `filepaths`.

These remain Docker-specific and are not claimed as local equivalents: `AioSandboxProvider`, Kubernetes Provisioner, Docker socket/Docker-out-of-Docker, and Bash Skills that require Linux containers.

## Smoke Checks

```powershell
Invoke-RestMethod http://127.0.0.1:<metadata-port>/health
Invoke-RestMethod http://127.0.0.1:8837/api/agent-runtime/status
```

Expected FacetWrite status includes `reachable:true`, authenticated runtime state, `runtimeProvider:"agent-backend"`, `deploymentMode:"local"`, and the LocalSandbox provider. Acceptance should also execute Python and Node Skills, a temporary stdio MCP, built-in tools, the active FacetWrite bridge tool set, repeated no-Mock generations, and verify Canvas approval.

The maintained end-to-end local acceptance is:

```powershell
npm.cmd run acceptance:local-runtime
```

It starts from `start-opencanvas-shell.vbs`, requires Docker and port `2026` to remain absent, and verifies five UI generations with `provider:"agent-backend"` and `usedMock:false`. It then verifies a Skill-driven `read_file` followed by live `web_search`, Agent Runtime `memory.json` persistence, visible tool start/completion events, low-risk Canvas commits, and destructive Canvas approval.

## LLM Timeout And Silent Gap Diagnostics

Progressive Canvas delivery can update `Body draft` or `Progress note` nodes before the next model decision. If the right trace then shows no new tool call for minutes, first inspect the LLM timeout path rather than WebSearch limits or Canvas writes.

The validated local runtime split is:

```yaml
timeout: 300.0
stream_chunk_timeout: 45.0
max_retries: 2
```

`timeout` is the total provider request safety stop. `stream_chunk_timeout` is the no-effective-model-chunk recovery threshold and is the main control for the post-Canvas silent gap. The previous `timeout: 600.0` allowed near 10-minute waits when the provider stream stayed open without useful chunks. A `timeout: 300.0` plus `stream_chunk_timeout: 45.0` completed the observed full progressive research workflow in about five minutes without negative regression.

Runtime status and timeline events should expose `llm_call_start`, `llm_call_end`, `llm_call_error`, and `llm_retry`. Safe timeout metadata includes `model`, `provider_class`, `base_url_host`, `timeout_s`, `stream_chunk_timeout_s`, and `max_retries`; it must not include prompts, tool results, generated content, or API keys. A `stream_chunk_timeout` should appear to users as a model stream timeout followed by retry, not as unexplained silence.

Do not fix this class of stall by reducing WebSearch loop limits, changing `agent_backend_tool_started` or `agent_backend_tool_completed` payloads, disabling progressive Canvas delivery, or relaxing Agent clarification contracts. If `45.0` interrupts legitimate long synthesis, test `60.0` or `90.0` next; do not jump back to 120/180/600 without measured evidence.

After changing timeout config or AgentBackend middleware, restart the Runtime with `npm.cmd run agent-runtime:up` or restart the app shell so the source/config fingerprint can refresh the managed Gateway.

## Run Reporting Diagnostics

Agent run reporting has three projections: final assistant text, stage reports, and raw logs. The Runtime custom-event field contract and `visibility` rules live in `modules/agent-runtime/backend/docs/FACETWRITE_PROGRESS.md`.

Stage reports are the only progress copy that belongs in the main right-drawer assistant run block. Raw model/tool lifecycle, ordinary safe points, command output, and debug metadata must stay in Run Trace/tool details. Final assistant `text` remains the persisted answer and must not be used as a progress transport.

## Thinking And Tool Choice Compatibility

Forced tool phases must keep the tool protocol deterministic even when the selected model supports a thinking or reasoning mode. The maintained capability field is:

```yaml
supports_tool_choice_with_thinking: false # true | false | "unknown"
```

Use `false` for DeepSeek-compatible models until a provider proves otherwise. Keep Kimi, Qwen, and other OpenAI-compatible thinking models as `"unknown"` until they pass local smoke tests for forced Plan clarification, Plan revision, Canvas write, Skill clarification, and long tool chains. Do not mark a provider `true` based only on public model claims.

When `thinking` is enabled and a phase must force a specific tool, the Lead Agent checks the model capability before the provider call. If the model is known incompatible, the runtime disables thinking for that model call only, clears `reasoning_effort`, keeps the forced `tool_choice`, and emits `thinking_disabled_for_tool_choice_compatibility`. This is expected for DeepSeek during Plan/clarification/Canvas guard phases; it is not a reason to remove the forced tool or relax the structured protocol.

Ordinary non-forced tool search can keep thinking enabled. If a provider still returns a 400 that mentions `thinking` and `tool_choice`, update the capability matrix and add a smoke fixture before changing orchestration logic.

User-facing errors should say that the current model does not support thinking with forced tool calls and recommend disabling thinking for the phase or switching models. A stream catch should refresh Thread state so persisted Plan recovery, failed timeline events, and pending clarifications remain visible after the provider error.

## Troubleshooting

- `uv`/Node/npm/npx missing: run `npm.cmd run agent-runtime:doctor` and install the reported prerequisite.
- Need a stable local Runtime port: set `AGENT_RUNTIME_PORT=<port>` before starting, or use process-level `AGENT_BACKEND_BASE_URL=http://127.0.0.1:<port>`.
- Gateway startup failure: inspect `modules/agent-runtime/logs/gateway-local.err.log`; the launcher rolls back its owned process.
- Missing model variables: configure `.env.local` or `modules/agent-runtime/.env` without committing secrets.
- Protected endpoints return 401/403: verify Agent Runtime setup/login credentials; do not bypass auth.
- stdio MCP cannot find `npx`: confirm Node is on PATH; the launcher prepends discovered Node/npm/npx directories.
- Docker bridge failure: use `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:<api-port>`.
- Local bridge failure: use `http://127.0.0.1:<api-port>`.
- If the right drawer shows model/tool lifecycle spam as main progress, inspect the `agent_progress_reported` and `agent_intervention_checkpoint` payloads first. Model steps, tool start/end, ordinary safe points, command logs, and stdout/stderr should be `visibility:"raw"` and stay behind Run Trace/tool details. Only semantic milestones and explicit intervention hints should be `visibility:"stage"`.
- If no useful stage report appears during a run, confirm that Runtime emits at least one semantic stage payload or that the Node `createStageProgressEmitter` fallback is grouping raw runtime/tool/Canvas events into phases such as preparation, evidence collection, delivery, or finalization. Do not fix missing stage narration by appending progress text to final assistant `text` or `reasoningText`.
- If "intervene in current run" does not reach Runtime, verify that raw progress/checkpoint events still carry `runId` and `threadId`. Raw events may be hidden from the main progress UI, but the frontend still uses them to bind queued user input to the active run and to request safe-point injection.
- If a run fails with `BadRequestError`, `Thinking mode does not support this tool_choice`, or a generic `AgentBackend returned internal runtime output`, first check whether the timeline contains `thinking_disabled_for_tool_choice_compatibility`. If it does, the runtime intentionally preserved the forced tool protocol and disabled thinking for that call. If it does not, inspect the selected model's `supports_tool_choice_with_thinking` value and the forced-tool phase that set `tool_choice`.
- If the Agent asks a blocking clarification but the right composer shows Markdown text instead of buttons, verify that the stream contains `agent_backend_agent_clarification_requested` and that the run timeline mirrors it with `status:"waiting"`. The expected path is Runtime `ask_clarification` -> structured ToolMessage artifact or complete tool-call args -> FacetWrite structured Agent clarification event -> waiting run timeline event -> composer choice card. Plain assistant prose with numbered options is not upgraded into buttons, and structured Agent clarification must not create a Canvas node.
- If a research-scope Skill clarification fails with `AgentBackend skill scope guard requires a structured ask_clarification response`, inspect `modules/agent-runtime/logs/gateway-local.err.log` before debugging the frontend. If the provider error is `Thinking mode does not support this tool_choice`, the phase-one guard did not disable provider thinking/reasoning before forcing `tool_choice="ask_clarification"`. If the Runtime log instead shows `HTTP/1.1 200 OK`, `ClarificationMiddleware - Intercepted clarification request`, and the UI reports `Agent clarification payload was invalid: missing_question`, the provider call succeeded and the failure is the Runtime-to-Node protocol bridge: check whether the adapter ignored partial streamed `AIMessageChunk.tool_calls`, parsed JSON-string `args`, and consumed the `ask_clarification` ToolMessage `artifact` or `additional_kwargs.facetwrite_clarification`. If the UI reports `too_many_options`, verify that the Node generation service attempted the one allowed clarification-only repair pass before surfacing the diagnostic. Keep the strict protocol intact; do not truncate options, parse formatted ToolMessage content, Markdown option lists, or ordinary prose into buttons.
- The Skill scope guard is a two-phase run. Phase one must expose only `ask_clarification`, set `facetwrite_clarification_phase:"clarification_guard"`, disable thinking/reasoning controls for provider compatibility, and remove Canvas/progressive/file/evidence delivery context. After `requestContext.agentClarification` is present, the server may either ask another focused question when slots are still missing or promote the answered request to `agentIntake.phase:"execution"` when the scope is sufficient or max rounds are reached. Execution restores normal Skills, provider thinking settings, runtime budget, and long-task progressive delivery eligibility.
- Long runs that call `write_file` or `present_files` for `/mnt/user-data/outputs/*.md` must produce a `file_document` Canvas node. If Runtime does not call file tools but the run is a medium/long progressive Canvas delivery, Node finalization writes a fallback Markdown file under `.facetwrite/threads/<threadId>/user-data/outputs/` and creates the same document node. If artifact archiving fails but that thread output directory already contains the reported Markdown file, the real Runtime file should still become the preview document and fallback must not shadow it. If the timeline shows completed file tools but no document node, inspect the safe tool args in the AgentBackend adapter, the local archived output path, the `canvas_delivery_file_document_committed` event, and `metadata.fileDocument.path`. The node should contain only a short file summary; the full Markdown is loaded through `/api/threads/:threadId/canvas/document-preview`.
- If `List Directory` fails, confirm the Agent Runtime config exposes `list_directory` and that the Python tool delegates to the existing `ls` implementation. The UI label is only a timeline label; the compatibility contract is the tool name plus safe `path` argument.
- Long batch-delivery runs that end with `GraphRecursionError` or a fixed Gateway recursion-limit value are usually tool-loop or budget-planning failures, not missing UI rendering. Seeing top-level `recursion_limit:160` on a low profile is expected because 160 is the LangGraph fuse; the low product budget should still appear as `facetwrite_recursion_limit:80`, `facetwrite_model_call_limit:18`, and `facetwrite_evidence_tool_limit:8` in `body.context`, `config.context`, or `config.configurable`. If those `facetwrite_*` fields are absent, debug TypeScript continuation/context reconstruction before raising Runtime limits. Inspect `modules/agent-runtime/logs/gateway-local.err.log` for the original runtime error, then confirm the stream emitted `agent_backend_tool_completed`, `canvas_delivery_research_committed`, `canvas_delivery_body_checkpoint_committed`, and on failure `canvas_delivery_failed_summary_committed` events. Progressive `研究摘录 N` / `Research note N` or `进度摘录 N` / `Progress note N` nodes and the latest `正文草稿` / `Body draft` checkpoint should remain as recoverable work. Checkpoint events carry only live hints such as `nodeId`, `contentPreview`, and `contentHash`; refresh Thread state for full draft content. The final `正文` / `Body` node is updated only after final synthesis succeeds. The run must still fail if no final assistant text or final structured lifecycle outcome exists.
- If a short answer, Plan clarification, or process acknowledgement appears as a Canvas node, inspect `contextValues.taskHandlingPolicy` before checking model output. `simple_chat` and `plan_intake` must be conversation-only; only `long_task`, `plan_execution`, and `explicit_canvas` may enable progressive or direct Canvas delivery. Finalization also blocks process clarification text and internal Runtime protocol text, so DSML/tool-call leakage should produce a runtime failure with preserved safe progress rather than a final Canvas body.
- Generation failures: inspect stable `model_required`, `model_not_ready`, `runtime_unavailable`, or `runtime_auth_failed` diagnostics. Do not enable Mock fallback for acceptance testing.
- Deliberate local Mock demonstration only: set `FACETWRITE_MOCK_FALLBACK_ENABLED=true`; unset it before real Runtime verification.

### LangGraph Resume Clarifications

Blocking Agent clarification can arrive twice for the same question: first as an `ask_clarification` tool call from streamed messages, then as a native LangGraph `runtime_interrupt`. Treat the interrupt as authoritative because it carries the durable resume address. The final stored `agent_backend_agent_clarification_requested` event and `agent_clarifications.resume_context_json` should preserve:

- `resumeContext.runtimeResume.runtimeThreadId`
- `resumeContext.runtimeResume.runtimeRunId`
- `resumeContext.runtimeResume.interruptId`
- `resumeContext.runtimeResume.checkpointId` when Runtime provides it

`finishReason:"clarification_required"` means the run is waiting; it does not mean the next answer can use LangGraph resume. The frontend should set `requiresRuntimeResume:true` only when the stored clarification contains the complete `runtimeThreadId` + `runtimeRunId` + `interruptId` triple. If that metadata is absent, the answer is a fallback ordinary run and diagnostics should show that it was not a LangGraph resume.

When debugging "answering a clarification starts a new run", inspect the persisted clarification before the frontend queue. A correct resume continuation posts to Runtime with `command: { resume: ... }`, `metadata.resumeOfRunId`, and the interrupt/checkpoint ids. A broken path posts a normal run with `command:null`. If the stream contains both `source:"ask_clarification"` and `source:"runtime_interrupt"` for the same question/options, adapter, generation-service, and repository dedupe must keep or merge the interrupt version rather than letting the earlier tool-call event win.

Regression coverage lives in `server/runtime/agentBackendAdapter/client.test.ts`, `server/services/generation/agentBackendRunner.test.ts`, `server/services/generationService.facade.test.ts`, `server/storageFacade.test.ts`, and `tests/frontend/agentClarification.test.ts`. Run the focused set after changing clarification handling:

```powershell
node --import tsx --test server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts server/services/generationService.facade.test.ts server/storageFacade.test.ts tests/frontend/agentClarification.test.ts
```

### Ordinary Clarification Loop

Ordinary Agent clarification is still a single-question protocol. Do not add `questions[]`, multi-field form payloads, or a new frontend interaction table for this path unless the product explicitly adopts a broader Human Interaction architecture. The maintained behavior is up to three rounds of `ask_clarification`, one structured multiple-choice question per round, scoped to the same original instruction.

On a resumed ordinary clarification, inspect `contextValues.ordinaryClarificationLoop`. It should contain `maxRounds:3`, the answered round count, remaining round count, and an answered-summary string built from prior persisted `agent_clarifications`. Skill scope guard records, Plan clarification records, and records carrying `facetwrite_clarification_policy.mode:"skill_scope_guard"` must not count toward ordinary rounds.

The Runtime prompt should say "ask one clarification at a time", not "ask exactly one clarification". If `remainingRounds` is `0`, the prompt must prohibit another `ask_clarification` call and instruct the Agent to continue with reasonable defaults or explain what remains impossible. If the same topic is asked again, first inspect whether the answered summary was injected and whether the previous clarification had the same `resumeContext.originalInstruction`.

Focused regression coverage for this policy lives in `server/runtime/agentBackendAdapter/client.test.ts`, `server/services/generation/clarificationContinuity.test.ts`, and `modules/agent-runtime/backend/tests/test_clarification_middleware.py`.

### Skill Clarification Budget Continuation

The Skill scope guard is still a strict two-phase protocol. Phase one exposes only `ask_clarification` and removes Canvas/progressive/file/evidence delivery context from the Runtime request, but the structured clarification event must carry enough `resumeContext` for phase two: original instruction, transient Skills, disabled Skills, effective `runtimeBudgetProfile`, and the original Canvas workflow. If Runtime returns only a partial `resumeContext`, the Node generation service fills missing fields from the server guard policy. Phase two is not always another ask-only checkpoint: if the selected answer completes the scope or the guard has reached its max rounds, Node marks the payload as execution and rebuilds progressive Canvas delivery before calling Runtime.

When a run resumed from Skill clarification hits `GraphRecursionError` or a fixed fallback recursion limit, inspect the continuation chain before raising global limits. Confirm `resumeContext.runtimeBudgetProfile` is `low`, `medium`, or `high`; `resumeContext.canvas.workflow.mode` remains `batch_delivery`; the answered request sets `agentIntake.phase:"execution"` when scope is complete; and the request rebuilds `contextValues.progressiveCanvasDelivery`. Runtime middleware reads `facetwrite_recursion_limit` as the advisory budget threshold, while LangGraph enforces top-level `recursion_limit` as a larger hard guard. The maintained Gateway fallback is `160`; when a FacetWrite budget profile is present, the Gateway expands the advisory context value to an equal-or-higher hard guard rather than clipping at the advisory budget. Gateway run records preserve the original `body.context` in `kwargs.context` so post-failure inspection can distinguish "low budget missing" from "low budget correctly paired with a 160 fuse."

Current runtime budget defaults are low `8 evidence / 2 body drafts / 18 model calls / 80 recursion / 16 reserve`, medium `12 / 3 / 24 / 110 / 22`, and high `16 / 4 / 32 / 140 / 28`. The persisted Project default profile is `low`; a composer selection is a one-run override unless Project runtime settings are saved.

The composer may show a budget-continuation prompt after a recursion-limit failure. It only drafts a user-visible continue instruction so the user can edit and resubmit; it does not convert the failed run into success, and the next request must still preserve the previous clarification answer, Skills, Canvas workflow, and budget semantics.

# Plan Runtime Enforcement

FacetWrite passes a stable Plan phase attempt in both LangGraph configurable context and runtime context. The Gateway forwards only the documented FacetWrite context fields, including top-level Plan identifiers, tool refs, tool state, and structured context values. `PlanToolChoiceMiddleware` filters model-visible tools on every call and permits at most one forced stage submission per attempt: intake exposes only `plan_clarification_submit`, revision exposes only `plan_revision_submit`, and approved execution uses the request policy for research tools plus `artifact_stage`.

The TypeScript `PlanOrchestrator` owns lifecycle state and the persistent `PlanExecutor` owns sequential execution. Repository state is the authoritative phase postcondition: intake must persist a pending clarification in `awaiting_user`, revision must persist an approval-ready Plan with steps, and execution must persist a committed current-step Artifact or a waiting/failed/paused interruption. SSE lifecycle events remain realtime UI and audit signals; a missing event does not invalidate a correct database transition, and an event cannot substitute for a missing transition. Tool failures are emitted as `agent_backend_tool_failed`; Plan contract failures also emit `agent_backend_plan_submission_failed` with a safe reason. The legacy broad `plan_update` model path is not part of the maintained Plan protocol.

A structured `plan_submission_failed` ToolMessage terminates the current AgentBackend run before another model or tool call. The Gateway records the run as an error rather than success; the user starts a new phase attempt by revising or retrying the request.

Canvas feedback is part of the maintained Plan contract. Intake remains conversation-only until the user answers the structured clarification. Revision creates or refreshes one `kind:"plan"` Canvas projection node, and later lifecycle transitions keep that same node synchronized with checklist progress, current step, committed artifact count, and failure or pause messages. The projection is derived state: deleting it must not delete or cancel the Plan, and the next refresh may recreate it.

Approved execution writes Canvas content only through `artifact_stage`. Runtime prompts should ask for `payload.sections` or `payload.items` when a text artifact contains multiple user-visible points; each section maps to one Canvas node, with pagination only for an overlong section. The artifact committer links each artifact node from the Plan projection node and commits explicit artifact links once both endpoints exist. Ordinary chat `CanvasWriteSuggestion` prompts remain for non-Plan replies only; approved Plan execution must not ask the user again before creating artifact nodes.

Clarification feedback is anchored in the composer. Intake may emit a short assistant acknowledgement, but the pending options must come from the persisted Plan clarification in thread state. After every Plan intake/revision generation and every explicit thread refresh, the frontend applies returned `plans` and `planActivities`; an `awaiting_user` Plan with a pending clarification replaces the normal textarea with a selection form. Option clicks submit through the Plan answer endpoint and the revise request includes `contextValues.awaitingPlan` with the selected option label, description, and recommendation flag. Custom answers use `customAnswer` and resume revision without a fabricated option id.

Running generations are user-stoppable from the chat composer. The frontend aborts the streaming fetch, marks the active assistant message as `stopped`, and lets AgentBackend receive the disconnect with `on_disconnect:"cancel"`. A stopped stream is not treated as a successful Plan phase and does not mutate Plan lifecycle state by itself; use the persisted Plan status and activities to decide whether the user should retry, answer a pending clarification, approve a Plan, or resume execution.

After changing AgentBackend middleware, including evidence-tool budget filtering or synthesis-reserve logic, run `agent-runtime:up`; source fingerprint comparison restarts a stale healthy Gateway because Python modules are not hot-reloaded.
