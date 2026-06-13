---
name: writing-plans
description: Turn a confirmed OpenCanvas intent into a short approval-ready sequential plan.
---

# OpenCanvas Plan Writing

Use this skill after the user answers the intake clarification or explicitly requests `/plan revise`.

1. Reuse the existing Plan ID.
2. Call `plan_revision_submit` exactly once with short ordered steps.
3. Each step must be independently executable and verifiable.
4. Stop after producing the approval-ready Plan.

Do not execute steps, write Canvas artifacts, create files, branches, worktrees, or commits. One user approval starts execution.
