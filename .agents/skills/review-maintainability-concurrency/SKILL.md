---
name: review-maintainability-concurrency
description: Review a codebase for maintainability, extensibility, decoupling, test gaps, and concurrency risks; produce or update an executable review plan and maintained technical documentation. Use for code-health reviews, architecture reviews, test supplementation plans, race-condition prevention, concurrency audits, or the project review shortcut.
---

# Maintainability And Concurrency Review

Review existing code before proposing changes. Prefer current architecture and APIs over new abstractions.

## Workflow

1. State scope, assumptions, and verifiable success criteria.
2. Map mutable workflows to owners, sources of truth, write boundaries, idempotency keys, and current tests.
3. Inspect architecture boundaries, responsibility hotspots, async flows, state machines, persistence, retries, cancellation, and external side effects.
4. Prioritize confirmed risks. Distinguish evidence from hypotheses.
5. Design deterministic tests before fixes. Use deferred promises, explicit operation ordering, atomic state assertions, and persisted-state checks instead of timing sleeps.
6. Prefer keyed coordination, transactions, compare-and-set updates, revisions, and idempotency. Avoid global locks and speculative abstractions.
7. Keep unrelated refactors out of scope.
8. Update maintained technical docs and the refactor/review log.
9. Run the repository's typecheck, unit/integration tests, and focused browser tests. Report baseline failures separately from new failures.

## Project Entry Points

- `docs/superpowers/plans/2026-06-07-maintainability-concurrency-review.md`
- `docs/ARCHITECTURE.md`
- `docs/README.md`
- `docs/REFACTOR_LOG.md`
- `package.json`

Treat `modules/agent-runtime/` as a separate subsystem unless the user explicitly requests a combined review.
