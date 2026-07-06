# ADR: Use Source Git Updates For First-Stage Harness Updates

## Status

Accepted

## Date

2026-07-06

## Context

OpenCanvas is currently distributed and operated as a source-development Harness/App Shell checkout. The App Shell starts the local frontend, Express backend, and Agent Runtime from this workspace. The project has not reached a packaged installer/release-artifact stage yet.

The product still needs an application update path that can refresh the Harness, frontend/backend source, Agent Runtime source, built-in Skills, demo/example assets, docs, and default examples without treating user data as repository content. User projects, Threads, Canvas state, Knowledge files, Memory, provider API keys, thumbnails, uploads, outputs, and SQLite state remain local-first runtime data.

## Decision

Use controlled source Git updates as the first-stage Harness update mechanism.

The v1 update channel is fixed to the current checkout's allowlisted `origin/main`. Electron/App Shell owns source update preview and apply. Express may expose status or preview later, but it must not run Git or overwrite its own running code in-process. Renderer UI may only call Shell IPC.

The source update flow is:

1. Preview runs `git fetch --prune origin`, resolves `origin/main` to a commit SHA, and reports current branch, HEAD, target SHA, ahead/behind counts, changed files, dependency changes, protected-path changes, and blockers.
2. Apply requires a clean worktree, non-detached HEAD, allowlisted origin remote, expected HEAD match, no protected-path changes, and a fast-forward target.
3. Apply uses `git merge --ff-only <resolvedCommit>`.
4. If root Node dependencies changed, App Shell runs `npm.cmd install` inside the current workspace.
5. App Shell restarts OpenCanvas after the update.

The updater must not clone, worktree, mirror, copy repositories, synchronize arbitrary GitHub URLs, automatically stash, rebase, reset, resolve conflicts, or create merge commits.

The updater must never write user data or local configuration:

- `.facetwrite/**` and any future unified `FACETWRITE_APP_ROOT`;
- `.env`, `.env.*`, `.env.local`, and `modules/agent-runtime/.env`;
- `.facetwrite/provider-apis.json`;
- SQLite database files, WAL, and SHM files;
- Thread `user-data/**`, Knowledge uploads/vectors, Memory, thumbnails, user uploads, and user outputs;
- dependency folders, runtime/test temp roots, and generated caches.

Database changes after an application update must run through versioned migrations. Source updates must not replace user database files.

## Alternatives Considered

### GitHub Release artifacts first

Deferred. Release artifacts are the right future path for packaged installs, but the product currently runs as a source checkout.

### `git pull`

Rejected as the product action. `git pull` combines fetch and merge/rebase semantics before preview, which makes it harder to check protected paths, expected HEAD, dirty state, and user confirmation. The implementation may use the same Git primitives internally only as an explicit fast-forward apply after preview.

### Clone, mirror, or worktree an upstream repository

Rejected. The project policy requires working in the current workspace, and a second checkout would blur update boundaries and disk ownership.

### Automatic stash/rebase/reset/conflict handling

Rejected for v1. Dirty worktrees and local source edits should block apply and require user/developer action.

## Consequences

- Source updates are available only in Shell/source-checkout mode.
- Dirty worktrees block apply, including untracked application files.
- Ignored user/runtime data remains outside the update surface.
- Future packaged installers may add a separate GitHub Release artifact updater with manifests, checksums, rollback bookkeeping, and the same protected-data boundary.
