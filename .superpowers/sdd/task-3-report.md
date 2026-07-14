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

## Review-fix pass

The follow-up review identified six ownership and restoration gaps. Each behavior change was reproduced with a failing test before the production fix:

- Claimed ownership: repository and resolver tests failed because an unconditional upsert erased a claim and substantive requests could pass a claimed row. `upsertReady` now conditionally rejects claimed rows, all claimed requests fail before Runtime, and incomplete owned work requeues only through the matching claim token. A transaction test proves generic recording cannot replace the claim, while the owner can requeue; a facade race proves a substantive request cannot steal a blocked claimant and the original claimant still completes.
- Authoritative Canvas: the resolver test first returned the client snapshot, and a facade-level test then showed server node `content` was stripped before Runtime. Continuation restoration now builds a narrow nodes/edges/objects/workflow snapshot from storage, explicitly restores the stored delivery ID and selected target, and uses a server-only internal flag to preserve that authoritative content through AgentBackend request construction. Client Canvas fields are never merged.
- Delivery-scoped evidence: conflicting tool, file, and output events initially leaked into restored evidence. Any safe event carrying a nonempty delivery ID that differs from the descriptor is now rejected; Canvas delivery events still require an exact target delivery ID.
- Exact resolved budget: after disabling auto-preflight in the test to exercise progressive delivery, the stored custom limits were replaced by the current profile defaults. Symbol-backed claimed payloads now retain the exact persisted progressive profile, limits, evidence tools, and trigger instead of recomputing them from changed project settings.
- Post-claim restoration failure: an injected authoritative Canvas read failure initially left the claim owned. Restoration now catches every exception after claim, token-fails the row immediately, and rethrows.
- Protected/request contracts: explicit tests verify agent clarification, Plan clarification/intake, Plan revision, and queued intervention never activate durable continuation. An adapter-level test verifies manual continuation uses ordinary `input` with no `command`, while runtime-backed clarification uses `command.resume` with no ordinary input.

### Review-fix verification

- `node --import tsx --test server/db/durableContinuationSchema.test.ts server/repositories/durableContinuationRepository.test.ts server/services/generation/durableContinuation.test.ts server/services/generationService.facade.test.ts server/routes/generationRoutes.test.ts` — 109 passed, 0 failed.
- `node --import tsx --test server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts server/storageFacade.test.ts` — 98 passed, 0 failed.
- `npm.cmd run typecheck` — passed.
- The first combined verification encountered one unrelated WHATWG `bad port` local-fetch flake in `generationRoutes.test.ts`; the route suite passed 3/3 immediately when rerun, and the final combined suite passed 109/109.

## Final review pass

The final review findings were addressed through three additional RED-to-GREEN checks:

- Typed safe context: an adversarial descriptor test first retained forged `agentIntake`, nested Plan option data, arbitrary object keys, and client-shaped policy values. Descriptor creation now uses explicit per-section typed pickers for only the required task policy, progressive delivery, ordinary clarification, and skill clarification primitives. Invalid types and enums are dropped; Plan state remains in the descriptor's typed top-level Plan reference.
- Server provenance: a valid-looking forged task/progressive policy initially survived the typed picker. Server policy producers now mark their computed values in symbol-backed metadata, and descriptor creation reads safe context only from that metadata or an already claimed server descriptor. Raw client context cannot become persisted continuation policy.
- Plan execution eligibility: a standalone typed Plan execution continuation initially bypassed durable claim and reached Runtime with the literal `continue` request and regenerated Plan attempt data. Execution-phase requests with typed Plan references can now claim ready/failed work and restore the descriptor's exact Plan ID, step ID, attempt ID, and execution version. Clarification, intake, revision, and queued-intervention flows remain protected.

### Final review verification

- `node --import tsx --test server/db/durableContinuationSchema.test.ts server/repositories/durableContinuationRepository.test.ts server/services/generation/durableContinuation.test.ts server/services/generationService.facade.test.ts server/routes/generationRoutes.test.ts` - 110 passed, 0 failed.
- `node --import tsx --test server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts server/storageFacade.test.ts` - 98 passed, 0 failed.
- `npm.cmd run typecheck` - passed.
- `git diff --check` - passed (Git reports only existing line-ending conversion warnings).

## Agent intake lifecycle review

The final lifecycle review found that a durable continuation lost the server-produced Agent intake execution marker and could therefore re-enter intake-only backend tool selection. The fix was developed with two failing assertions before production changes:

- A descriptor test proved that forged client `agentIntake` remained untrusted, then showed that the same payload still lacked `agentIntake` after the authoritative `withAgentIntakeExecutionPhase` producer ran.
- A facade continuation round-trip showed the persisted descriptor lacked the execution marker. After restoration, the backend could no longer prove it was in execution mode.

`withAgentIntakeExecutionPhase` now records a server-only continuation marker. The descriptor picker accepts that marker only when both fields exactly identify execution, and emits only `{ phase: "execution", completed: true }`; all pre-existing client keys are discarded. The round-trip test verifies `isAgentIntakeExecution` remains true and that the backend receives `write_file` and `present_files` rather than the intake-only tool pair.

### Agent intake lifecycle verification

- `node --import tsx --test server/db/durableContinuationSchema.test.ts server/repositories/durableContinuationRepository.test.ts server/services/generation/durableContinuation.test.ts server/services/generationService.facade.test.ts server/routes/generationRoutes.test.ts` - 110 passed, 0 failed.
- `node --import tsx --test server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts server/storageFacade.test.ts` - 98 passed, 0 failed.
- `npm.cmd run typecheck` - passed.
- `git diff --check` - passed (Git reports only existing line-ending conversion warnings).

## Effective execution payload review

The remaining ordinary-intake lifecycle gap was reproduced before implementation at two levels:

- The AgentBackend runner's two-stage ordinary intake test reached execution with the correct in-memory marker, but its returned result exposed no effective payload and therefore could not communicate the execution transition to its caller.
- An end-to-end ordinary-intake test emitted `agent_intake_complete`, ran an incomplete execution stage, and showed that the persisted descriptor still reflected the outer collecting payload and lacked trusted `agentIntake` execution state.

Runtime results now propagate the payload actually used by the backend. The ordinary two-stage path returns its `executionPayload`; single-stage backend results return their input payload; and the generic runtime runner supplies its input payload for compatible runtime ports that do not provide one. Both synchronous and streaming generation replace their outer payload with this normalized effective payload before readiness checks, Canvas finalization, completion recording, and durable descriptor construction. When the execution producer completes an ordinary intake, it also refreshes the trusted ordinary-intake continuation marker to `state: "completed"`.

The end-to-end regression proves an incomplete ordinary execution persists both `{ agentIntake: { phase: "execution", completed: true } }` and a non-collecting ordinary intake state. A literal `continue` claims that descriptor, preserves the literal user message in history, and reaches the backend with execution tools instead of the intake-only tool pair.

### Effective execution payload verification

- `node --import tsx --test server/db/durableContinuationSchema.test.ts server/repositories/durableContinuationRepository.test.ts server/services/generation/durableContinuation.test.ts server/services/generationService.facade.test.ts server/routes/generationRoutes.test.ts` - 111 passed, 0 failed.
- `node --import tsx --test server/runtime/agentBackendAdapter/client.test.ts server/services/generation/agentBackendRunner.test.ts server/storageFacade.test.ts` - 98 passed, 0 failed.
- `node --import tsx --test server/services/generation/agentRuntimeRunner.test.ts` - 12 passed, 0 failed.
- `npm.cmd run typecheck` - passed.
- `git diff --check` - passed (Git reports only existing line-ending conversion warnings).
