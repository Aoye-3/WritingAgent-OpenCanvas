# Maintainability Refactor Branch Inventory

Current branch: `codex/maintainability-refactor`

## Included In Architecture Refactor Scope

- `server/agents/`
- `server/security/`
- `server/tools/toolPolicyGuard.ts`
- `server/toolRuntime.ts`
- `server/toolRuntime.test.ts`
- `server/routes/generationRoutes.ts`
- `server/services/settingsService.ts`
- `server/services/generationService.ts`
- `src/app/App.tsx`
- `src/app/hooks/`
- `src/features/generation/types.ts`
- Maintained docs: `docs/ARCHITECTURE.md`, `docs/AGENT.md`, `docs/API.md`, `docs/SECURITY.md`, `docs/REFACTOR_LOG.md`

## Existing Or Parallel Changes To Keep Separate

- `docs/plans/*`
- `开发日志`
- Any untracked planning files under `docs/plans/`

Do not revert these files in this refactor. Do not include them in architecture-stabilization commits unless the user explicitly asks.
