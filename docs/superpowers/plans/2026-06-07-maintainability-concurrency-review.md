# Project-First Architecture Hardening Plan

## Goal

Keep Project as the physical and logical workspace boundary, Model Config as the only model source, and AgentBackend as the only real generation runtime.

## Implemented Guarantees

- Schema v3 clears legacy workspace data, removes Thread Agent/input ownership, and stores Canvas resources by `project_id`.
- Canvas Thread routes explicitly resolve the owning Project before calling the Project-owned Canvas domain.
- Project Agent input autosave uses monotonically increasing revisions.
- Canvas nodes and output versions join Project shared context only through explicit inclusion.
- Project shared context uses deterministic category budgets totaling 24,000 characters.
- New Projects have no bound or selected default model.
- AgentBackend model synchronization exposes `synced`, `failed`, `unsupported`, and `disabled` states; unsynchronized models cannot generate.
- Generation has no Provider, default-model, environment-model, or test compatibility fallback.
- Frontend generation and Thread restoration reject stale asynchronous results through operation ownership.

## Verification

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- AgentBackend Python tests and syntax checks
- Live `/api/agent-runtime/status`
- Live `/api/settings/model-runtime-sync-status`

## Deferred Risks

- Project filesystem paths still reuse the historical thread-directory helper name.
- Full browser automation for rapid Project switching and context-inclusion controls remains useful as a future regression suite.
