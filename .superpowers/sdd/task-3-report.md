# Task 3 Report — Durable Task Continuation

## Scope

Implemented server-side durable continuation persistence and restoration for incomplete generation runs. The change is limited to the database schema, storage/repository layer, generation service and recorder integration, route error mapping, and focused tests. No frontend or product documentation was changed.

## RED → GREEN evidence

- Added a schema test that first failed because schema version 19 and `durable_task_continuations` did not exist, then passed after the migration was added.
- Added repository lifecycle tests that first failed because the durable continuation repository did not exist, then passed after guarded claim, completion, requeue, failure, supersede, restart recovery, atomic run recording, and safe evidence lookup were implemented.
- Added descriptor and restoration tests that first failed because the server-only continuation contract did not exist, then passed after strict intent recognition, field-level whitelisting, server-only claim metadata, current Canvas restoration, and safe evidence restoration were implemented.
- Added generation facade tests that first failed because incomplete runs had no descriptor, concurrent continuation requests both reached Runtime, and runtime failures left claims in the wrong state. They passed after the recorder transaction, atomic claim flow, restoration, and claim finalization were integrated.
- Added streaming and incomplete/clarification coverage to verify streaming completion, incomplete requeue, and clarification claim completion.
- Self-review produced three additional failing tests before fixes: a new incomplete run retained stale retry attempts; an arbitrary nested context field leaked into the descriptor; and mock fallback could incorrectly complete a failed continuation. The repository now resets attempts for a new descriptor, the descriptor uses field-level context whitelists, and claimed continuation runtime errors bypass mock fallback and remain retryable failures.

## Implementation notes

- Schema version 19 creates `durable_task_continuations` without historical backfill.
- The continuation row is the mutable workflow owner. State transitions are guarded by the current state and, after claim, by a unique claim token.
- Incomplete run persistence and descriptor persistence share the existing `recordRun` transaction, so a failed claim transition rolls the transaction back.
- Abandoned `claimed` rows are recovered once per database path per process startup and become retryable.
- The persisted descriptor is versioned and contains only server-selected task, agent, project, budget, plan, delivery, workflow, target, and whitelisted context fields. Claim tokens and visible-user overrides remain server-only symbol metadata.
- Manual continuation accepts only narrow standalone continuation intents. Protected clarification/plan/intervention flows do not claim or supersede durable state; substantive ordinary requests supersede retryable state.
- Restoration uses the stored server descriptor, a freshly sanitized current Canvas snapshot, and filtered evidence from the source run. Lifecycle, completion, and error events are excluded from evidence.
- The literal user continuation message is retained in conversation history while Runtime receives the restored original task.
- Duplicate claims return the stable `durable_continuation_in_progress` error and map to HTTP 409.

## Verification

- `npm.cmd run typecheck` — passed.
- `node --import tsx --test server/db/durableContinuationSchema.test.ts server/repositories/durableContinuationRepository.test.ts server/services/generation/durableContinuation.test.ts server/services/generationService.facade.test.ts server/routes/generationRoutes.test.ts` — 101 passed, 0 failed.
- `node --import tsx --test server/storageFacade.test.ts server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts` — 97 passed, 0 failed.
- `git diff --check` — passed (Git reports only the repository's existing line-ending conversion warnings).

## Self-review

- Source of truth: `durable_task_continuations` owns retryable continuation state; run records remain immutable execution history.
- Atomic boundary: run and descriptor persistence are one transaction; claim uses a guarded update; terminal mutations require the claim token.
- Restart boundary: claimed work is recovered once when storage initializes for a database path, without repeatedly resetting live claims in the same process.
- Trust boundary: client-supplied durable continuation metadata is stripped; descriptors are built and restored from server-owned fields.
- Evidence boundary: only sanitized delivery/tool/file evidence is restored; lifecycle and error payloads are not reused as prompt context.
- No unresolved correctness or concurrency concern was found in the scoped implementation. Node emits its expected experimental SQLite warning during tests.
