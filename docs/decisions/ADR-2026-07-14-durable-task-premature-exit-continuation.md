# ADR: Protect Durable Tasks From Premature Exit With Persisted Continuation

## Status

Accepted

## Date

2026-07-14

## Context

A durable task can end with a process promise such as “I will search next” even though the run has not produced the required tool or delivery evidence. The assistant text is useful context, but treating that turn as completed loses the task boundary and can leave Canvas delivery unfinished. Browser-only recovery is insufficient because refresh, stream failure, or another client can discard transient state.

This recovery path is separate from blocking Agent clarification. Clarification resumes a LangGraph interrupt with stored `command.resume` metadata; premature-exit continuation starts an explicit subsequent run from a server-owned task descriptor.

## Decision

Use two guard layers and one persisted continuation state machine.

Runtime first performs same-graph auto-continuation. For a durable execution, `DurableTaskGuardMiddleware` detects an action-only assistant reply with no run evidence and injects a hidden internal continuation message. The graph may make up to two additional model turns. If the graph still lacks evidence, Runtime emits the public-safe `durable_task_incomplete` signal and returns the visible process reply.

FacetWrite then applies its server readiness gate. `evaluateRunCompletion` returns `status:"continue"` when required evidence or delivery is still missing. Recording the run and creating or requeueing its continuation happen in the same SQLite transaction. The visible assistant text remains persisted, but the run lifecycle is `run_incomplete`, never completed.

`durable_task_continuations` stores one continuation per thread with these states:

```text
ready | failed -> claimed -> completed
                    |
                    +-> ready
                    +-> failed

ready | failed -> superseded
```

- `ready` and `failed` can be explicitly continued.
- `claimed` prevents concurrent execution.
- another incomplete result requeues the claimed record as `ready`.
- a completed claimed run moves to `completed`.
- an unrelated new instruction moves an unclaimed recovery to `superseded`.
- a claimed row left by process restart is recovered as `failed`.

The user continues through the existing composer by sending an explicit standalone continuation instruction such as `continue`. The server atomically claims the persisted record, reconstructs the trusted instruction, Skills, budget, Plan position, safe Canvas context, and model overrides, and reuses the stored `deliveryId` so retries do not fork the delivery. No automatic retry button or additional endpoint is introduced.

Clarification remains a different protocol. An answered persisted clarification resumes the Runtime checkpoint with `command.resume`; it must not claim a durable task continuation or reconstruct a fresh task descriptor. Conversely, an explicit durable `continue` is normal Runtime input and never fabricates clarification resume metadata.

The public API exposes only `DurableContinuationSummary`: `state`, derived `canContinue`, `attempts`, and an optional sanitized `lastError`. Descriptor JSON, claim token/time, source run id, Skills, budget, `deliveryId`, and policy fields remain server-only. The same summary is returned after the run transaction and from thread state, making refresh and stream-error recovery database-backed.

Failure is conservative. A Runtime or recording failure after claim moves the row to `failed` and preserves the prior answer/task context for another explicit `continue`. A concurrent claim returns `durable_continuation_in_progress`. Completed and superseded rows may remain visible in diagnostics but do not produce an actionable recovery card.

## Alternatives Considered

### Treat a process reply as completed

Rejected. It reports success without the required evidence or delivery and discards the recovery boundary.

### Keep continuation state only in React

Rejected. Refresh and stream failure would lose the descriptor, and the browser is not a trusted provenance boundary.

### Reuse clarification `command.resume`

Rejected. Premature exit is not a LangGraph interrupt and has no valid interrupt/checkpoint credential.

### Retry automatically

Rejected. Automatic replay can duplicate tools or writes. Continuation remains an explicit user action through the existing composer.

## Consequences

- Durable process replies stay visible while the task remains unmistakably unfinished.
- Refresh and stream failures recover presentation from SQLite.
- Claims prevent concurrent continuation and stable `deliveryId` reuse prevents delivery forks.
- Internal task provenance is not exposed to clients.
- Ordinary chat, Plan, clarification, final supplement, and completed-message behavior remain on their existing paths.
