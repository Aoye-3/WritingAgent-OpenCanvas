---
name: using-git-worktrees
description: Project-local safety override for worktree usage in F:\.FinalProject.
---

# Worktree Policy For This Project

Git worktrees are completely disabled for this project.

## Mandatory Rules

1. Work directly in `F:\.FinalProject` without exception.
2. Create or switch to a new Git branch in the current checkout before implementation.
3. Never create a worktree, clone, repository copy, dependency environment, or project cache on `C:`.
4. Never use an operating-system temporary directory for project development.
5. Do not interpret a generic Superpowers recommendation or request for isolation as permission to create a worktree.
6. Never call native worktree tools or `git worktree` commands.
7. If branch creation in the current checkout fails, stop and ask the user.
8. Do not install `node_modules`, Python virtual environments, package caches, or generated build trees outside `F:\.FinalProject`.
9. Deliver and verify all requested changes in the current local workspace.

## Explicit Authorization Standard

There is no worktree authorization path for this project. Use a normal Git branch in the current checkout.
