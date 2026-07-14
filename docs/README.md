# FacetWrite Technical Docs

This directory contains the maintained technical memory for FacetWrite. Treat these files as current project facts. Historical plans and research belong in `docs/reference/` or `docs/plans/`.

## Core Documents
- `PROJECT_BRIEF.md`: product goal, current capabilities including App Updates, MVP boundaries, and non-goals.
- `DESIGN.md`: maintained product design system, left-navigation information architecture, layout rules, interaction rules, and component guardrails.
- `ARCHITECTURE.md`: frontend, backend, internal Agent Runtime module, storage, and boundary rules.
- `CANVAS.md`: Canvas V2 frontend architecture, React Flow mapping, node geometry, resize behavior, and write-safety boundary.
- `AGENT.md`: AgentCard, Agent settings, Agent Runtime mapping, Tool catalog, and ToolUse safety.
- `SKILL_MANAGEMENT.md`: Skill catalog shape, folder management API, per-message enable/disable behavior, and safety rules.
- `API.md`: HTTP API contracts, runtime environment variables, and response shape.
- `AGENT_RUNTIME_RUNBOOK.md`: project-managed local Agent Runtime Gateway, explicit Docker mode, dependencies, dynamic ports, env, smoke checks, LangGraph clarification resume, and troubleshooting.
- `APP_SHELL_RUNBOOK.md`: Windows Electron development shell startup, ports, ownership, source updates, shutdown, HMR, and troubleshooting.
- `plans/CLOUDFLARE_TUNNEL_REMOTE_TEST_PLAN.md`: temporary Cloudflare Tunnel remote-test architecture, startup flow, Worker proxy fallback, validation, security boundary, and rollback notes.
- `DATABASE.md`: SQLite location, tables, Canvas write semantics, and migration notes.
- `DATA_STORAGE_SYSTEM.md`: user/runtime storage, development/sample data, configuration storage, and Harness source-update data boundaries.
- `SECURITY.md`: local secret handling, tool permissions, Agent Runtime auth, source update boundary, and runtime redaction rules.
- `DECISIONS.md`: dated technical decisions and their impacts.
- `decisions/ADR-2026-07-06-layer-agent-budget-gates.md`: ADR for layered Agent Runtime budget gates, finalization tool narrowing, and Canvas terminal-delivery semantics.
- `decisions/ADR-2026-07-06-use-source-git-updates-for-first-stage-harness-updates.md`: ADR for first-stage source Git Harness updates and protected local user data.
- `decisions/ADR-2026-07-14-durable-agent-clarification-checkpoint-resume.md`: ADR for answer-first persistence and LangGraph checkpoint resume.
- `decisions/ADR-2026-07-14-durable-task-premature-exit-continuation.md`: ADR for premature-exit guards, fail-closed completion, and persisted task continuation.
- `REFACTOR_LOG.md`: review results, completed work, open TODOs, and next priority checks.
- `superpowers/plans/2026-06-07-maintainability-concurrency-review.md`: executable maintainability, extensibility, decoupling, test-gap, and concurrency review plan.

## Update Rules
- Code structure changes update `ARCHITECTURE.md`.
- Product layout, navigation, component, visual-system, or interaction-design changes update `DESIGN.md`.
- Canvas interaction, geometry, node renderer, or write-safety changes update `CANVAS.md`.
- API changes update `API.md`.
- Database or storage changes update `DATABASE.md`.
- Harness/App Shell update architecture changes update `ARCHITECTURE.md`, `DATA_STORAGE_SYSTEM.md`, and an ADR under `docs/decisions/`.
- Agent, ToolUse, Skill, MCP, or Agent Runtime changes update `AGENT.md`.
- Skill folder management, Skill catalog, or per-message Skill selection changes update `SKILL_MANAGEMENT.md`.
- Security, auth, secret, approval, or side-effect changes update `SECURITY.md`.
- Important design tradeoffs update `DECISIONS.md`.
- Application-shell lifecycle or update-entry UI changes update `APP_SHELL_RUNBOOK.md`.
- Cloudflare Tunnel remote-test changes update `APP_SHELL_RUNBOOK.md`, `plans/CLOUDFLARE_TUNNEL_REMOTE_TEST_PLAN.md`, and this index.
- Every review or refactor updates `REFACTOR_LOG.md`.

## Current Runtime Position
FacetWrite is the workspace and control plane. It owns the frontend workspace, configuration surfaces, SQLite data, Canvas state, and Human-in-the-loop approval.

Agent Runtime is FacetWrite's internal AI execution subsystem. The current implementation is the AgentBackend adapter under `server/runtime/agentBackendAdapter/` plus the source module under `modules/agent-runtime/`. FacetWrite calls the project-managed LangGraph-compatible Gateway for Lead Agent, subagent, ToolUse, MCP, Memory, Knowledge, and intelligent orchestration behavior. Blocking clarification persists answers and resumes a LangGraph checkpoint with `command.resume`; a naturally ended durable task instead claims a server-owned continuation and sends normal input on the existing Runtime thread. Runtime/model failures return explicit diagnostics; Mock output is only available when `FACETWRITE_MOCK_FALLBACK_ENABLED=true` is deliberately enabled for local demonstration.
