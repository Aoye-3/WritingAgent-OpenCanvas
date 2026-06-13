---
name: brainstorming
description: Clarify a new OpenCanvas Plan with one structured multiple-choice question.
---

# OpenCanvas Plan Brainstorming

Use this skill only for the first turn of a new `/plan`.

1. Identify the single uncertainty that most affects the plan.
2. Call `plan_clarification_submit` exactly once with the structured question.
3. Provide 2-3 mutually exclusive options. Mark exactly one recommended option.
4. Keep labels short and descriptions focused on the tradeoff.
5. Stop after the tool call.

Do not create a Git branch, worktree, specification file, commit, Canvas write, task artifact, or executable task step. Do not ask for section-by-section approval. The UI supplies the "Other" free-text entry.
