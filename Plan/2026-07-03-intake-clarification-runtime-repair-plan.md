# Intake Clarification Runtime Repair Plan

> **For agentic workers:** Implement task-by-task in the opened workspace `F:\.FinalProject` only. Do not use git worktrees, cloned repositories, copied repositories, temp directories, or C: drive caches. Before implementation, create or switch to an in-place branch in this repository. This plan is intentionally conservative: first stabilize the current clarification path, then introduce stable intake contracts only where the existing code can absorb them safely.

## Goal

Stop repeated similar clarification loops and reduce post-clarification stalls without breaking plan approval, progressive Canvas delivery, or AgentRuntime streaming.

The first repair should **converge the existing `skill_scope_guard` clarification system**. A full structured multi-question intake form and LangGraph-native resume are later migrations, not the first cut.

## Implementation Status

**2026-07-03:** First repair batch completed on branch `codex/intake-clarification-plan`.

- Frontend stream failures now return a typed chat send result so caller-side optimistic clarification state can roll back.
- `AICollaborationDrawer` rolls back submitted clarification keys and optimistic answered records when `onSend` returns `{ ok: false }`.
- AgentBackend runtime context now carries `facetwrite_intake_phase`, using `"intake"` for `skill_scope_guard` and `"execution"` for ordinary runs.
- Adapter waiting-state tests cover clarification followed by ordinary text versus clarification followed by real tool progress.
- Service regression covers equivalent answered clarification suppression without relying on runtime-provided `slotId`.

Verified with:

```powershell
npm.cmd run test -- server/runtime/agentBackendAdapter/client.test.ts
npm.cmd run test:frontend
npm.cmd run typecheck
```

## Current Codebase Facts

The repository already has a partial intake/clarification guard. Do not treat the implementation as a blank slate.

- `server/services/generation/generationService.ts` already has `withSkillClarificationGuard`, `skillScopeIntake`, `withAgentClarificationResumeContext`, and `repeatedAnsweredIntakeSlots`.
- `skillScopeIntake` is heuristic. It applies only to clarification-sensitive transient skills and scope-sensitive tasks, allows up to three rounds, and infers answered/missing slots from text patterns.
- Repeated clarification suppression already exists through `agent_backend_duplicate_clarification_suppressed`, but it depends on inferred slot fingerprints, not runtime-provided stable `slotId`s.
- `server/services/generationService.facade.test.ts` already covers several skill-intake and duplicate-suppression cases. New tests should extend those facts, not assume the feature is absent.
- `server/db/schema.ts` has `agent_clarifications.resume_context_json`, but `threads` does not have a generic metadata JSON column. Do not store answered intake in nonexistent thread metadata.
- `src/features/agents/types.ts` exposes `agentClarifications?: AgentClarification[]` on `ThreadStateResponse`; there is no `answeredIntake` field today.
- `src/features/workspace/components/AICollaborationDrawer.tsx` has separate plan clarification and agent clarification paths, but they share panel layout and CSS. Preserve the plan path.
- `src/app/hooks/useGenerationRun.ts` catches stream errors, shows an assistant error, refreshes thread state if possible, and then returns normally. This prevents `AICollaborationDrawer` from rolling back optimistic clarification answers.
- `src/features/generation/generationClient.ts` already throws on SSE `event: error`; the swallowed-failure problem is in `handleChatSend`, not the SSE parser.
- Python `ask_clarification` currently returns `Command(update=..., goto=END)`, not LangGraph `interrupt()`.
- The runtime `ask_clarification` tool schema has no `slotId`. It currently accepts `question`, `clarification_type`, `context`, and `options`.
- `server/runtime/agentBackendAdapter/client.ts` posts to `/api/runs/stream`; there is no working `Command(resume=...)` chain yet.
- Adapter waiting state is driven by `sawWaitingForUser`. Real tool or Canvas progress clears it; ordinary assistant text does not.
- `PlanToolChoiceMiddleware` forces `ask_clarification` only for `skill_scope_guard`; execution is not broadly forced to ask clarification, though the tool may still be available to the model.

## Non-Goals

- Do not redesign Canvas node rendering outside clarification/intake surfaces.
- Do not replace the AgentRuntime, model provider stack, or plan orchestrator.
- Do not remove existing plan approval or plan clarification flows.
- Do not require LangGraph-native resume in the first implementation checkpoint.
- Do not introduce broad new persistence surfaces before verifying the existing `agent_clarifications` and run recording lifecycle.
- Do not start progressive Canvas delivery during blocking clarification/intake.

## Key Existing Files

- `src/features/workspace/components/AICollaborationDrawer.tsx` - current plan and agent clarification UI, optimistic answer state, answer submission.
- `src/app/hooks/useGenerationRun.ts` - chat send, stream state, optimistic assistant message, thread state refresh.
- `src/features/generation/generationClient.ts` - browser SSE parser for `/api/generate/stream`.
- `src/features/generation/types.ts` - frontend generation contracts.
- `src/features/agents/types.ts` - thread state and agent clarification types.
- `server/contracts/generation.ts` - request/response contract.
- `server/services/generation/generationService.ts` - generation orchestration, current skill clarification guard, run recording.
- `server/services/generation/promptRunBuilder.ts` - prompt/context assembly.
- `server/services/generation/agentBackendRunner.ts` - runtime request construction from generation service.
- `server/runtime/agentBackendAdapter/client.ts` - AgentBackend `/api/runs/stream` request and runtime SSE parser.
- `server/repositories/runRepository.ts` - run status lifecycle and `agent_clarifications` persistence.
- `server/storage.ts` - storage facade for run and clarification persistence.
- `server/db/schema.ts` - current table surfaces.
- `modules/agent-runtime/backend/packages/harness/deerflow/tools/builtins/clarification_tool.py` - current `ask_clarification` schema.
- `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py` - current `ask_clarification` `goto=END` behavior.
- `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/plan_tool_choice_middleware.py` - forced tool choice behavior.
- `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/llm_error_handling_middleware.py` - model retry events.

## Success Criteria

- Answering an agent clarification does not leave fake optimistic answered state after a stream failure.
- Existing `skill_scope_guard` tests still pass.
- Similar answered clarification slots are suppressed server-side without recording a second pending clarification.
- A runtime clarification followed only by ordinary assistant text still ends as `finishReason: "clarification_required"`.
- A runtime clarification followed by real tool or Canvas progress clears waiting and completes normally.
- Existing plan clarification, plan approval, and Canvas delivery flows continue to pass targeted tests.
- Intake-related status labels do not mislabel model retry or plan retry as user waiting.
- Optional stable `slotId` work is introduced only after the current heuristic guard is covered by tests.

---

## Phase 0: Baseline Reality Tests

### Task 0.1: Audit and extend service-level duplicate clarification tests

**Files:**
- Modify: `server/services/generationService.facade.test.ts`

**Acceptance criteria:**
- Existing tests for skill intake and duplicate suppression remain intact.
- A new or adjusted test covers the current no-`slotId` reality: first run emits `agent_backend_agent_clarification_requested`; second run answers through `contextValues.agentClarification`; runtime then emits an equivalent repeated question; service suppresses it as `agent_backend_duplicate_clarification_suppressed`.
- The test asserts no second pending `agent_clarifications` record is created.
- The test does not assume runtime-provided `slotId` exists.

**Steps:**
- [ ] Locate existing tests around skill intake and duplicate suppression.
- [ ] Add a regression named `agent intake suppresses equivalent answered clarification without runtime slot id`.
- [ ] Stub first and second AgentBackend runs using current event shape: `question`, `options`, `resumeContext`, `clarificationId`.
- [ ] Assert duplicate event suppression and persisted clarification state.
- [ ] Run:

```powershell
npm run test -- server/services/generationService.facade.test.ts
```

### Task 0.2: Add frontend regression for observable stream failure

**Files:**
- Prefer creating or modifying a focused hook/caller test for `useGenerationRun`.
- Modify only if needed: `tests/frontend/generationClient.test.ts`
- Modify later: `src/app/hooks/useGenerationRun.ts`
- Modify later: `src/features/workspace/components/AICollaborationDrawer.tsx`

**Acceptance criteria:**
- `generateTextStream` throwing on SSE `event: error` remains covered.
- A stream error after an agent clarification answer is observable by the caller of `handleChatSend`.
- The visible assistant error message behavior remains.
- Drawer-level optimistic clarification state can be rolled back when the send result is failure.

**Steps:**
- [ ] Do not add only a `generationClient` test; the parser already throws.
- [ ] Add a test at the `handleChatSend` caller boundary or extract a small testable send-result helper if the hook is hard to test.
- [ ] Simulate `generateTextStream` throwing after an agent clarification submission.
- [ ] Assert the caller gets `{ ok: false, error }` or an intentionally typed thrown error.
- [ ] Run:

```powershell
npm run test:frontend
```

### Task 0.3: Add adapter regression for waiting-state clearing

**Files:**
- Modify: `server/runtime/agentBackendAdapter/client.test.ts`

**Acceptance criteria:**
- A stream with `agent_clarification_requested -> ordinary assistant text -> end` returns `finishReason: "clarification_required"`.
- A stream with `agent_clarification_requested -> web_search/tool/canvas progress -> end` returns completed.
- Existing test coverage for post-clarification tool progress remains.

**Steps:**
- [ ] Add the missing ordinary-text-only waiting test.
- [ ] Keep or extend the existing post-tool-progress completion test.
- [ ] Run:

```powershell
npm run test -- server/runtime/agentBackendAdapter/client.test.ts
```

---

## Phase 1: Frontend Failure Contract

This phase is the lowest-risk user-visible repair. It does not require new runtime contracts.

### Task 1.1: Return a typed send outcome from `handleChatSend`

**Files:**
- Modify: `src/app/hooks/useGenerationRun.ts`
- Update call sites in `src/app/App.tsx` only if TypeScript requires it.

**Acceptance criteria:**
- Success returns `{ ok: true, state }`.
- Abort returns `{ ok: false, aborted: true }` or an equivalent explicit outcome.
- Recoverable stream failure returns `{ ok: false, error, threadId? }`.
- Existing visible assistant error message remains.
- Existing refresh-on-error behavior remains best-effort.
- Queued input behavior still drains as before.

**Implementation outline:**

```ts
type ChatSendResult =
  | { ok: true; state: ThreadStateResponse }
  | { ok: false; error: string; threadId?: string; aborted?: boolean };
```

**Steps:**
- [ ] Add a local or exported `ChatSendResult` type.
- [ ] Return `{ ok: true, state }` at the current success return.
- [ ] Return an explicit failure object in the catch branch after updating the assistant error message.
- [ ] Preserve `finally` cleanup exactly.
- [ ] Run:

```powershell
npm run test:frontend
npm run typecheck
```

### Task 1.2: Roll back optimistic agent clarification on failed send

**Files:**
- Modify: `src/features/workspace/components/AICollaborationDrawer.tsx`

**Acceptance criteria:**
- `answerAgentClarification` rolls back `submittedAgentClarificationKeys` and `optimisticAgentClarifications` when `onSend` returns `ok: false`.
- Existing catch rollback remains for actual thrown errors.
- Plan clarification submission is not changed.
- Existing `buildAgentClarificationSubmission` behavior is preserved.

**Steps:**
- [ ] Capture the result of `await onSend(...)`.
- [ ] If result is an explicit failure, roll back the same optimistic state currently rolled back in catch.
- [ ] Do not change `answerPlan`.
- [ ] Run:

```powershell
npm run test:frontend
npm run typecheck
```

---

## Phase 2: Converge Existing Service Guard

Do this before adding a new intake service. The current production path already has a guard and persisted clarification records.

### Task 2.1: Extract current slot inference into a tested helper

**Files:**
- Create: `server/services/generation/intakeSlots.ts`
- Modify: `server/services/generation/generationService.ts`
- Test: `server/services/generation/intakeSlots.test.ts`

**Acceptance criteria:**
- Current slot fingerprints are preserved: `topic_subdomain`, `time_range`, `paper_count_depth`, `citation_format`, `output_structure`.
- Text-based inference remains backward-compatible with existing `skillScopeIntake`.
- Empty and sentinel values return no slots.
- This extraction does not introduce a required runtime `slotId`.

**Steps:**
- [ ] Move the current `INTAKE_SLOT_DEFINITIONS`, `intakeSlotIds`, `intakeSlotLabel`, and `missingIntakeSlots` logic into the helper.
- [ ] Keep exported names conservative and local to generation service.
- [ ] Add tests for English, Chinese, empty/sentinel, and duplicate inferred slots.
- [ ] Run:

```powershell
npm run test -- server/services/generation/intakeSlots.test.ts server/services/generationService.facade.test.ts
```

### Task 2.2: Harden duplicate clarification suppression

**Files:**
- Modify: `server/services/generation/generationService.ts`
- Test: `server/services/generationService.facade.test.ts`

**Acceptance criteria:**
- Repeated answered clarification is suppressed when inferred slots are equivalent.
- New unanswered clarification still records as pending.
- Suppression emits a clear protocol event: `agent_backend_duplicate_clarification_suppressed`.
- Suppression never runs for plan clarification events.
- Suppression never triggers Canvas finalization.

**Steps:**
- [ ] Keep changes near `withAgentClarificationResumeContext` and `repeatedAnsweredIntakeSlots`.
- [ ] Avoid broad changes to `generateAndRecordStream`.
- [ ] Add tests for answered slot, unanswered slot, and plan clarification isolation.
- [ ] Run:

```powershell
npm run test -- server/services/generationService.facade.test.ts
```

### Task 2.3: Preserve blocking clarification lifecycle

**Files:**
- Modify only if tests expose a bug: `server/services/generation/generationService.ts`
- Test: `server/services/generationService.facade.test.ts`
- Test: `server/runtime/agentBackendAdapter/client.test.ts`

**Acceptance criteria:**
- Blocking clarification returns no final Canvas delivery.
- `finishReason: "clarification_required"` records run status as waiting.
- If post-clarification tool or Canvas progress appears, final finish reason becomes completed.
- Existing progressive Canvas delivery tests still pass.

**Steps:**
- [ ] Add targeted tests before changing service logic.
- [ ] Keep `isBlockingAgentClarificationRun` and `finalFinishReason` behavior explicit.
- [ ] Run:

```powershell
npm run test -- server/services/generationService.facade.test.ts server/runtime/agentBackendAdapter/client.test.ts
```

---

## Phase 3: Runtime Phase Signaling Without Resume

This phase should label intent and tool choice more clearly. It should not attempt LangGraph resume.

### Task 3.1: Add explicit runtime intake phase context

**Files:**
- Modify: `server/runtime/agentBackendAdapter/client.ts`
- Modify: `server/services/generation/agentBackendRunner.ts`
- Modify only if needed: `server/services/generation/generationService.ts`
- Test: `server/runtime/agentBackendAdapter/client.test.ts`

**Acceptance criteria:**
- Runtime context can carry `facetwrite_intake_phase: "intake" | "execution"`.
- Existing `facetwrite_clarification_phase: "clarification_guard"` remains supported.
- Current `skill_scope_guard` requests mark intake phase as `intake`.
- Non-guard execution requests mark phase as `execution` or omit it without changing behavior.

**Steps:**
- [ ] Add the context field in TypeScript adapter types.
- [ ] Populate it from existing `facetwrite_clarification_policy` mode where possible.
- [ ] Add adapter request-building tests.
- [ ] Run:

```powershell
npm run test -- server/runtime/agentBackendAdapter/client.test.ts
npm run typecheck
```

### Task 3.2: Keep forced `ask_clarification` scoped to intake guard

**Files:**
- Modify only if needed: `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/plan_tool_choice_middleware.py`
- Test: `modules/agent-runtime/backend/tests/test_plan_tool_choice_middleware.py`

**Acceptance criteria:**
- `skill_scope_guard` can still force `ask_clarification`.
- Ordinary execution does not force `ask_clarification`.
- Planning contracts still force the correct plan tools.
- Canvas write action still forces `canvas_write` when required.

**Steps:**
- [ ] Add tests first if the current tests do not already cover these cases.
- [ ] Only change middleware if tests expose ambiguity.
- [ ] Run from the runtime backend directory:

```powershell
Set-Location modules/agent-runtime/backend
uv run pytest tests/test_plan_tool_choice_middleware.py
```

### Task 3.3: Clarify model retry and waiting labels

**Files:**
- Modify: `server/runtime/agentBackendAdapter/client.ts`
- Modify only if needed: `src/features/generation/generationClient.ts`
- Modify only if needed: timeline/progress mapping in generation service
- Test: `server/runtime/agentBackendAdapter/client.test.ts`
- Test: frontend stream/progress tests if present

**Acceptance criteria:**
- `llm_retry` remains a model retry signal, not an intake waiting state.
- User waiting is emitted only for actual clarification/intervention waiting.
- Frontend `StreamStatus.phase` is not expanded to fake `waiting` unless the UI type system is updated intentionally.

**Steps:**
- [ ] Trace where `llm_retry` becomes visible timeline/progress state.
- [ ] Add tests for `llm_retry` and clarification waiting separation.
- [ ] Run:

```powershell
npm run test -- server/runtime/agentBackendAdapter/client.test.ts
npm run test:frontend
```

---

## Phase 4: Stable Slot Contract, Optional First Slice

Do this only after Phases 1-3 are stable. Stable slots need runtime support; TypeScript cannot invent reliable runtime slot IDs after the fact.

### Task 4.1: Add optional runtime `slotId`

**Files:**
- Modify: `modules/agent-runtime/backend/packages/harness/deerflow/tools/builtins/clarification_tool.py`
- Modify: `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py`
- Test: runtime clarification middleware tests

**Acceptance criteria:**
- `AskClarificationArgs` accepts optional `slotId`.
- `slotId` is normalized or validated before entering structured payload.
- Existing callers that omit `slotId` keep working.
- Adapter still parses old and new payloads.

**Steps:**
- [ ] Add optional `slotId` to the Pydantic model.
- [ ] Include `slotId` in `structured_payload` when valid.
- [ ] Add tests for omitted, valid, and invalid slot IDs.
- [ ] Run relevant runtime tests.

### Task 4.2: Teach the adapter and service to prefer stable `slotId`

**Files:**
- Modify: `server/runtime/agentBackendAdapter/client.ts`
- Modify: `server/services/generation/generationService.ts`
- Test: `server/runtime/agentBackendAdapter/client.test.ts`
- Test: `server/services/generationService.facade.test.ts`

**Acceptance criteria:**
- If runtime provides `slotId`, duplicate suppression uses it.
- If runtime omits `slotId`, existing text inference fallback still works.
- Invalid `slotId` never persists as trusted state.

**Steps:**
- [ ] Parse optional `slotId` into the tool event payload.
- [ ] Extend duplicate suppression to prefer normalized stable slot IDs.
- [ ] Keep heuristic fallback for old events.
- [ ] Run:

```powershell
npm run test -- server/runtime/agentBackendAdapter/client.test.ts server/services/generationService.facade.test.ts
npm run typecheck
```

### Task 4.3: Decide persistence surface for structured answered intake

**Files:**
- Investigate: `server/db/schema.ts`
- Investigate: `server/repositories/runRepository.ts`
- Investigate: `server/storage.ts`
- Modify only after decision: migration/schema/repository files

**Acceptance criteria:**
- The decision explicitly chooses one of:
  - keep answered intake in `agent_clarifications.resume_context_json`,
  - add a dedicated answered-intake table,
  - defer persistence and continue deriving from answered clarifications.
- The decision does not use nonexistent `threads.metadata`.
- `ThreadStateResponse` remains backward-compatible.

**Steps:**
- [ ] Write the decision in this Plan or a small ADR before schema changes.
- [ ] Add repository tests before adding a new table.
- [ ] Run storage/repository tests.

---

## Phase 5: Multi-Question Intake UI, Optional Later Slice

Only start this phase after stable slot IDs or an explicit persistence decision exists. The current production UI is single-question agent clarification.

### Task 5.1: Add `AgentIntakeForm` behind a separate branch path

**Files:**
- Create: `src/features/workspace/components/AgentIntakeForm.tsx`
- Modify: `src/features/workspace/components/AICollaborationDrawer.tsx`
- Test: `tests/frontend/AgentIntakeForm.test.tsx`

**Acceptance criteria:**
- Multiple intake questions render in one form.
- Recommended/default options are preselected.
- Submit produces `IntakeAnswer[]`.
- Required questions gate submit.
- Plan clarification cards remain untouched.

**Steps:**
- [ ] Add the component without replacing `PlanClarificationCard`.
- [ ] Add a new `pendingIntake` branch only when a real intake payload exists.
- [ ] Keep current `AgentClarificationChoiceCard` for legacy single-question events.
- [ ] Run:

```powershell
npm run test:frontend
npm run typecheck
```

### Task 5.2: Submit answered intake once

**Files:**
- Modify: `src/features/workspace/components/AICollaborationDrawer.tsx`
- Modify: `src/app/hooks/useGenerationRun.ts`
- Modify: `src/features/generation/types.ts`

**Acceptance criteria:**
- Submitting intake sends one execution request with explicit answered intake context.
- The original instruction is taken from a reliable source, preferably runtime resume context or a persisted intake payload.
- Stream failure rolls back optimistic intake state through the Phase 1 send outcome.
- Existing plan and single-question agent clarification flows still work.

**Steps:**
- [ ] Build `intakeSummary` from question and selected option labels.
- [ ] Do not assume `originalInstruction` exists for timeline fallback records.
- [ ] Call `onSend` with explicit execution context only when all required data is present.
- [ ] Run:

```powershell
npm run test:frontend
npm run typecheck
```

---

## Phase 6: End-to-End Verification

### Task 6.1: Add or update one-shot intake/clarification flow

**Files:**
- Create or modify: `tests/e2e/agent-intake.spec.ts`

**Acceptance criteria:**
- A deterministic literature/database-style task shows clarification once.
- User answers once.
- Execution starts or completes without showing an equivalent repeated question.
- No Canvas placeholder/final delivery is created during blocking clarification.

**Steps:**
- [ ] Use existing service/test utilities if available before adding new mocking infrastructure.
- [ ] Assert the UI state after answer is execution progress or completion, not another same-slot question.
- [ ] Run:

```powershell
npm run test:e2e -- tests/e2e/agent-intake.spec.ts
```

### Task 6.2: Full regression checkpoint

**Acceptance criteria:**
- Unit, frontend, typecheck, and targeted e2e pass.
- Manual scenario no longer repeats equivalent clarification.
- Existing plan approval and Canvas delivery flows still work.

**Steps:**
- [ ] Run:

```powershell
npm run test
npm run typecheck
npm run test:frontend
npm run test:e2e -- tests/e2e/agent-intake.spec.ts
```

- [ ] Manually run a literature/database-style request.
- [ ] Confirm clarification appears once.
- [ ] Answer once.
- [ ] Confirm execution begins.
- [ ] Confirm no repeated equivalent question appears.

---

## Phase 7: Optional LangGraph-Native Resume Migration

This phase starts only after the lower-risk intake/clarification repairs are stable. It is not required to solve repeated clarification loops.

### Task 7.1: Prototype runtime interrupt behind a feature flag

**Files:**
- Modify: `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py`
- Modify: `modules/agent-runtime/backend/app/gateway/routers/thread_runs.py`
- Modify: `modules/agent-runtime/backend/app/gateway/services.py`
- Modify likely: `modules/agent-runtime/backend/packages/harness/deerflow/runtime/runs/worker.py`
- Test: runtime run manager/checkpoint tests

**Acceptance criteria:**
- Feature flag off keeps current `Command(update=..., goto=END)` behavior.
- Feature flag on uses a real LangGraph interrupt/resume path.
- The worker passes `Command(resume=...)` or equivalent resume input into graph execution.
- Existing `/interventions` behavior remains separate and intact.

**Steps:**
- [ ] Confirm exact LangGraph resume API in current runtime dependency before coding.
- [ ] Add a runtime config flag such as `facetwrite_langgraph_resume_clarification`.
- [ ] Wire request schema, service, and worker execution together.
- [ ] Add tests for feature flag off and on.

### Task 7.2: Adapter support for resume streams

**Files:**
- Modify: `server/runtime/agentBackendAdapter/client.ts`
- Modify: `server/services/generation/generationService.ts`
- Test: `server/runtime/agentBackendAdapter/client.test.ts`
- Test: `server/services/generationService.facade.test.ts`

**Acceptance criteria:**
- TypeScript can resume an existing runtime checkpoint when the backend reports one.
- Old `/api/runs/stream` path remains default when feature flag is off.
- Waiting is an intermediate runtime state, not a completed FacetWrite run, in the feature-flagged path.

**Steps:**
- [ ] Add adapter resume method only after runtime supports it end to end.
- [ ] Preserve `runAgentBackendAgent`.
- [ ] Add tests for `waiting -> resume -> final`.

### Task 7.3: Frontend resume behavior

**Files:**
- Modify: `src/app/hooks/useGenerationRun.ts`
- Modify: `src/features/workspace/components/AICollaborationDrawer.tsx`

**Acceptance criteria:**
- Answering a runtime interrupt can call resume when a resumable checkpoint exists.
- UI distinguishes paused, resuming, running, completed, and failed.
- Existing non-resume intake/clarification flow continues to work.

**Steps:**
- [ ] Add a resume path only behind backend-provided resumable metadata.
- [ ] Keep the normal clarification answer path as the default.
- [ ] Run:

```powershell
npm run test:frontend
npm run typecheck
```

---

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Replacing existing guard with a new service breaks production flow | High | First converge `skill_scope_guard`; introduce new contract only after tests pass. |
| Runtime has no stable `slotId` | High | Keep heuristic fallback; add optional runtime `slotId` before relying on stable slots. |
| Frontend optimistic state lies after stream error | High | Return typed failure from `handleChatSend`; rollback optimistic clarification/intake. |
| Plan clarification regresses | Medium | Keep `pendingClarificationPlan` and `PlanClarificationCard` path separate. |
| Canvas delivery sequence changes unexpectedly | High | Do not finalize Canvas delivery during blocking clarification/intake. |
| Persistence is placed in the wrong table | Medium | Do not use nonexistent thread metadata; decide between resume context, dedicated table, or derived state. |
| LangGraph resume breaks streaming lifecycle | High | Feature flag; implement only after runtime worker supports resume end to end. |
| Status labels confuse model retry with waiting | Medium | Preserve `llm_retry` as model status; use waiting only for actual user wait states. |

## Execution Order

1. Phase 0 baseline reality tests.
2. Phase 1 frontend failure contract.
3. Phase 2 converge existing service guard.
4. Phase 3 runtime phase signaling without resume.
5. Phase 4 optional stable slot contract.
6. Phase 5 optional multi-question intake UI.
7. Phase 6 end-to-end verification.
8. Phase 7 optional LangGraph-native resume migration.

## Checkpoints

### Checkpoint A: After Phase 2

- [ ] Stream failure is observable by `AICollaborationDrawer`.
- [ ] Optimistic agent clarification can roll back on failed send.
- [ ] Existing skill intake tests pass.
- [ ] Repeated equivalent clarification is suppressed.
- [ ] Blocking clarification does not trigger Canvas delivery.

### Checkpoint B: After Phase 3

- [ ] Runtime context distinguishes intake guard from execution.
- [ ] Forced `ask_clarification` remains scoped.
- [ ] Adapter waiting-state tests pass.
- [ ] Model retry and user waiting labels are distinct.

### Checkpoint C: After Phase 5

- [ ] Stable slot IDs are available or explicitly deferred.
- [ ] Multi-question intake form exists only behind real intake payloads.
- [ ] Plan clarification and single-question agent clarification still work.

### Checkpoint D: After Phase 6

- [ ] Full targeted regression passes.
- [ ] Manual scenario no longer repeats equivalent clarification.
- [ ] No same-slot clarification loop appears in logs.

## Notes for Implementers

- Keep changes surgical. Do not refactor unrelated Canvas, plan board, model config UI, or runtime provider code.
- Do not use worktrees. Use a normal branch in `F:\.FinalProject`.
- Prefer tests before implementation for every phase.
- Treat LangGraph-native resume as a later migration.
- Current `agentClarifications` persistence is part of the product surface; preserve it while adding new intake fields.
- If branch creation is impossible, stop and ask the user. Do not substitute a worktree or alternate checkout.
