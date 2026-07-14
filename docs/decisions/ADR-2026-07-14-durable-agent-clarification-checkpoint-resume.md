# ADR: Persist Agent Clarification Answers Before Checkpoint Resume

## Status

Accepted

## Date

2026-07-14

## Context

LangGraph clarification is an interrupted execution, not a new chat turn. A valid continuation must resume the same Runtime thread and interrupt/checkpoint. The earlier path could lose this distinction in several ways:

- Python serialization could reduce an `Interrupt` to an opaque string;
- an earlier `ask_clarification` tool-call event could overwrite the authoritative Runtime interrupt;
- the frontend could become the only source of resume metadata;
- a missing resume credential could silently fall back to a fresh Runtime `input` run;
- an answer could be lost when Runtime I/O failed after submission;
- replayed tool-call events could be mistaken for a new clarification after resume.

These failures produced repeated intake, dangling waiting UI, false `Tool recovery` progress, or a task that appeared to restart after every answer.

## Decision

Treat Agent clarification as a durable server-owned state machine.

Runtime emits a structured interrupt whose payload includes:

- `runtimeThreadId`;
- `runtimeRunId`;
- `interruptId`;
- optional `checkpointId`;
- a structured `agent_clarification_requested` value.

The native Runtime interrupt is authoritative. FacetWrite may merge it with an earlier matching `ask_clarification` tool-call event, but the tool-call event cannot remove or replace `runtimeResume`. String or incomplete native interrupts fail closed and never create `waiting` without an actionable pending clarification.

`agent_clarifications` persists the answer and resume lifecycle:

```text
pending / awaiting_answer
-> answered / queued
-> resuming
-> succeeded | failed
```

Non-resumable rows use `not_resumable`. The row also stores `resume_attempts`, `last_resume_error`, and `resumed_runtime_run_id`.

Answer submission follows these rules:

- save option id, label, custom answer, and timestamp in SQLite before Runtime I/O;
- read `runtimeResume` only from the persisted server row;
- accept an identical repeated answer without changing it, but reject a different answer with `clarification_answer_conflict`;
- atomically claim the queued retry before calling Runtime so concurrent requests cannot resume twice;
- fail with `clarification_resume_metadata_missing` when the stored credential is incomplete;
- never call the normal fresh-run path for a resumable clarification answer;
- preserve the answer and checkpoint on failure so an explicit retry resumes the same point.

FacetWrite continues to use `/api/generate/stream`; it does not add a parallel clarification-answer endpoint. Runtime resume uses `command.resume`. Runtime may assign a new invocation run id, but the stable thread plus interrupt/checkpoint means execution did not restart from the original user input.

Automatic retry is allowed once only when FacetWrite knows Runtime rejected the request before accepting the stream. After HTTP acceptance, any token/tool/runtime event, or an ambiguous connection result, the row becomes `failed` and requires explicit retry to avoid duplicate execution.

The frontend derives recovery UI from persisted rows. `queued` and `resuming` may be shown after refresh when no local generation stream is active. While `isSending` is true, transitional resume cards are hidden because the normal run progress and composer controls are authoritative. A `failed` card remains visible during any local state so **Retry resume** is always actionable and reuses the saved answer.

Once intake enters `agentIntake.phase:"execution"`, `ask_clarification` is removed from the Runtime tool allowlist. This prevents a completed slot guard from starting an extra clarification instead of executing research. LangGraph `GraphBubbleUp`/interrupt exceptions also bypass generic progress recovery reporting, so normal waiting does not appear as `Tool recovery`.

## Alternatives Considered

### Trust frontend `resumeContext`

Rejected. Browser state can be stale, missing after refresh, or client-modified. Resume credentials belong to the persisted server record.

### Fall back to a fresh Runtime input

Rejected. It violates checkpoint semantics, can repeat side effects and research, and hides protocol corruption behind apparently successful execution.

### Add a dedicated clarification-answer endpoint

Rejected. The existing generation stream already owns progress, timeline, Canvas delivery, and run recording. A second endpoint would duplicate orchestration without improving the persistence boundary.

### Retry every resume transport failure automatically

Rejected. Once Runtime might have accepted execution, retrying can duplicate tools and writes. Only provably pre-acceptance failures are safe for one automatic retry.

### Backfill historical rows without `runtimeResume`

Rejected. The missing thread/interrupt/checkpoint cannot be reconstructed reliably. The durable guarantee applies to newly persisted clarifications after this migration.

## Consequences

- User answers survive Runtime outages and page refreshes.
- Multi-round clarification resumes one checkpoint chain instead of silently starting fresh tasks.
- Concurrent or repeated submissions do not cause duplicate Runtime resume calls.
- Protocol corruption is visible as a specific failure rather than an empty waiting state.
- Failed resumes remain recoverable without asking the same question again.
- Historical clarifications missing resume metadata remain non-resumable by design.
- Cross-layer fixture tests must keep Python interrupt serialization and the TypeScript adapter contract aligned.
