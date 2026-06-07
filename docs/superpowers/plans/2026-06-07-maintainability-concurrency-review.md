# Maintainability And Concurrency Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish repeatable architecture review and test coverage that keeps FacetWrite maintainable, extensible, decoupled, and resistant to stale-write and concurrent-operation bugs.

**Architecture:** Preserve the current frontend feature/hooks, backend domain/service/repository, SQLite transaction, and Agent Runtime port boundaries. Add tests before changing behavior; introduce small coordination primitives only at confirmed race boundaries, and keep optimistic concurrency rules close to the owning repository or service.

**Tech Stack:** TypeScript 5.9, React 19, Express 5, Node test runner, `node:sqlite` WAL mode, Playwright, Python Agent Runtime.

---

## Scope And Success Criteria

Review `src/`, `server/`, `shared/`, and root `tests/` first. Review `modules/agent-runtime/` separately because it has its own Python/Next.js architecture and test commands.

Success means:

- Every mutable workflow has an explicit owner, source of truth, state transition, and idempotency rule.
- Writes that can race are transactional, serialized by key, or protected by revision/compare-and-set.
- Frontend async work cannot apply a response to the wrong thread, run, or newer local state.
- Route modules depend on domain APIs; Agent Runtime cannot write FacetWrite product data directly.
- Critical transitions have deterministic unit/integration tests and focused browser coverage.
- `npm.cmd run typecheck`, `npm.cmd test`, and selected Playwright suites pass.

## Current Baseline

Strengths:

- SQLite uses WAL mode and `BEGIN IMMEDIATE` transactions in `server/db/sqlite.ts`.
- Route, domain, service, repository, runtime adapter, and frontend feature boundaries exist.
- Agent Runtime auth deduplicates concurrent session setup with `pendingSession`.
- Canvas writes are approval-gated and normal approve/reject paths are tested.
- Architecture boundary, output sanitization, storage facade, and Canvas browser tests exist.
- The current baseline passes typecheck, 181 server/frontend tests, the production build, and all 7 Canvas Playwright tests.

Priority risks:

| Priority | Risk | Hotspot | Required proof |
| --- | --- | --- | --- |
| P0 | Duplicate/conflicting Canvas approval can apply content more than once | `server/repositories/canvasRepository.ts` | Concurrent approve/approve and approve/reject tests; atomic claim before mutation |
| P0 | Old frontend responses can overwrite a newer thread/run | `src/app/App.tsx`, `src/app/hooks/useGenerationRun.ts`, Canvas hooks | Deferred-promise tests proving stale responses are ignored |
| P1 | Provider config read-modify-write can lose an update or leave partial JSON | `server/domains/model-config/providerApiConfigService.ts` | Concurrent mutation tests; serialized mutation and atomic rename |
| P1 | Knowledge reindex/search/index can overlap on one base | `server/knowledge/service.ts` | Same-base serialization and different-base parallelism tests |
| P1 | Thread input autosave can persist an older payload after a newer edit | `src/app/App.tsx`, thread API/storage | Out-of-order save test; revision or latest-write coordination |
| P1 | Stream/typewriter work lacks explicit cancellation ownership | `src/app/hooks/useGenerationRun.ts`, generation runtime | Abort-on-new-run/unmount tests; no late final-state application |
| P2 | Large files hide ownership and transition rules | Canvas repository, Knowledge service, DocumentCanvas, AgentSettingsTabs | Responsibility inventory; evidence-driven extraction only |

## Review Rules

- Coordinate by the smallest ownership key such as `threadId`, `baseId`, or store path. Do not add a global mutex.
- Prefer integer revisions, operation ids, or atomic status predicates over timestamps.
- Keep database invariants in repository/service transactions, not routes or React components.
- Make side effects idempotent before adding retries.
- Test races with controlled deferred promises or explicit operation ordering, not timing sleeps.
- Split files only when the split clarifies ownership or a state-transition rule.

### Task 1: Stabilize Baseline And Inventory Mutable Workflows

**Files:**
- Modify: `server/architectureBoundaries.test.ts`
- Create: `docs/reviews/maintainability-concurrency-inventory.md`
- Modify: `docs/REFACTOR_LOG.md`

- [x] Normalize `.gitignore` line endings in the architecture test before matching.
- [x] Run `npm.cmd run typecheck` and `npm.cmd test`; require both to pass.
- [ ] Inventory each mutable workflow: owner, source of truth, write boundary, idempotency key, concurrency policy, current tests, and missing tests.
- [ ] Commit as `test: stabilize maintainability review baseline`.

### Task 2: Make Canvas Approval Transitions Atomic

**Files:**
- Modify: `server/repositories/canvasRepository.ts`
- Modify: `server/canvasStorage.test.ts`
- Modify: `docs/CANVAS.md`
- Modify: `docs/DATABASE.md`

- [ ] Add failing approve/approve, approve/reject, and deleted-target race tests.
- [ ] In one transaction, claim a pending request using `UPDATE ... WHERE status = 'pending'`.
- [ ] Mutate Canvas content only when the claim changes exactly one row.
- [ ] Apply the same compare-and-set rule to rejection.
- [ ] Run `node --import tsx --test server/canvasStorage.test.ts server/storageFacade.test.ts`, then `npm.cmd test`.
- [ ] Document Canvas write requests as single-consumer state transitions.

### Task 3: Prevent Stale Frontend Async Results

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/hooks/useGenerationRun.ts`
- Modify: `src/app/hooks/useCanvasActions.ts`
- Create: `tests/frontend/asyncOwnership.test.ts`
- Modify: `docs/ARCHITECTURE.md`

- [ ] Extract a small monotonic operation-id or `{ threadId, requestId }` ownership helper.
- [ ] Add deferred-promise tests proving thread A cannot apply after switching to B, run 1 cannot replace run 2, and an old Canvas refresh cannot restore deleted state.
- [ ] Check ownership immediately before React state writes.
- [ ] Run `npm.cmd run test:frontend` and `npm.cmd run typecheck`.

### Task 4: Add Stream Cancellation And Single-Run Semantics

**Files:**
- Modify: `src/features/generation/generationClient.ts`
- Modify: `src/app/hooks/useGenerationRun.ts`
- Modify: `server/routes/generationRoutes.ts`
- Modify: `server/runtime/agentBackendAdapter/client.ts`
- Modify: `server/runtime/agentBackendAdapter/client.test.ts`
- Create: `tests/frontend/generationCancellation.test.ts`

- [ ] Add cancellation tests for a newer run, thread switch, and component disposal.
- [ ] Thread one `AbortSignal` through the existing generation boundary.
- [ ] Guard finalization by run id so error/disconnect/final events cannot finalize twice.
- [ ] Assert cancelled work cannot emit late tokens, tool events, final state, or Canvas auto-approval.
- [ ] Run focused tests and `npm.cmd test`.

### Task 5: Serialize Provider Config Mutations And Write Atomically

**Files:**
- Modify: `server/domains/model-config/providerApiConfigService.ts`
- Modify: `server/domains/model-config/providerApiConfigService.test.ts`
- Modify: `docs/SECURITY.md`

- [ ] Add concurrent save/save/delete tests against one store.
- [ ] Serialize only provider-config mutations; keep unrelated reads independent.
- [ ] Write normalized JSON to a same-directory temporary file and atomically rename it over `provider-apis.json`.
- [ ] Assert valid JSON, no unrelated provider loss, and deterministic active-config selection.
- [ ] Run the focused test and `npm.cmd test`; document atomic local secret-store writes.

### Task 6: Coordinate Knowledge Mutations By Base

**Files:**
- Modify: `server/knowledge/service.ts`
- Modify: `server/knowledge/service.test.ts`
- Modify: `docs/KNOWLEDGE.md`

- [ ] Add reindex/reindex, index/delete, reindex/search, and cache-invalidation race tests.
- [ ] Serialize mutations for the same `baseId`; allow different bases to proceed concurrently.
- [ ] Explicitly choose whether search waits for mutation completion or reads a stable snapshot.
- [ ] Run `node --import tsx --test server/knowledge/service.test.ts` and `npm.cmd test`.

### Task 7: Protect Thread Autosave From Out-Of-Order Writes

**Files:**
- Modify: `server/db/schema.ts`
- Modify: `server/storage.ts`
- Modify: `server/routes/threadRoutes.ts`
- Modify: `src/app/App.tsx`
- Modify: `server/routes/threadRoutes.test.ts`
- Create: `tests/frontend/threadAutosave.test.ts`
- Modify: `docs/API.md`
- Modify: `docs/DATABASE.md`

- [ ] Define the conflict contract. Preferred: client sends an integer revision and the server accepts only a newer revision.
- [ ] Add API/frontend tests where revision 2 arrives before delayed revision 1.
- [ ] Assert thread switching invalidates the previous thread's pending autosave.
- [ ] Add a non-breaking revision migration and preserve current payload fields.
- [ ] Run focused tests, `npm.cmd test`, and `npm.cmd run typecheck`.

### Task 8: Enforce Decoupling And Extensibility Boundaries

**Files:**
- Modify: `server/architectureBoundaries.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reviews/maintainability-concurrency-inventory.md`

- [ ] Enforce that routes do not import repositories directly.
- [ ] Enforce that runtime adapters do not import Canvas/storage repositories.
- [ ] Enforce that frontend code does not import server modules and feature clients use `src/shared/apiClient.ts`.
- [ ] Review the largest files; extract only confirmed mixed ownership, not cosmetic size.
- [ ] Run the focused architecture test and typecheck.

### Task 9: Add End-To-End Race Regression Coverage

**Files:**
- Modify: `tests/e2e/canvas.spec.ts`
- Create: `tests/e2e/concurrency.spec.ts`
- Modify: `playwright.config.ts` only if deterministic isolation requires it

- [ ] Cover rapid Canvas edits followed by navigation, double approval click, generation followed by thread switch, and autosave during rename.
- [ ] Use API interception, explicit response gates, and persisted-state assertions.
- [ ] Run `npm.cmd run test:e2e:canvas` and `npx.cmd playwright test tests/e2e/concurrency.spec.ts`.

### Task 10: Close The Review And Update Technical Memory

**Files:**
- Modify: `docs/REFACTOR_LOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATABASE.md`
- Modify: `docs/CANVAS.md`
- Modify: `docs/KNOWLEDGE.md`
- Modify: `docs/API.md`
- Modify: `docs/SECURITY.md`

- [ ] Run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run test:e2e`.
- [ ] Record unresolved risks, why they are deferred, and their trigger signals.
- [ ] Document only implemented invariants; keep proposals in this plan and inventory.
- [ ] Commit final documentation as `docs: close maintainability and concurrency review`.

## Separate Agent Runtime Review

After this plan, create a separate review for `modules/agent-runtime/` focused on Python async task ownership, LangGraph run idempotency, channel/message bus ordering, gateway retries, and frontend query-cache invalidation. Do not mix its dependency or test-tool changes into FacetWrite review commits.
