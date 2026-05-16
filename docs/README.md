# FacetWrite Technical Docs

This directory contains the maintained technical memory for FacetWrite. Treat these files as current project facts. Historical plans and research belong in `docs/reference/` or `docs/plans/`.

## Core Documents
- `PROJECT_BRIEF.md`: product goal, current capabilities, MVP boundaries, and non-goals.
- `ARCHITECTURE.md`: frontend, backend, Agent runtime, DeerFlow sidecar, storage, and boundary rules.
- `AGENT.md`: AgentCard, Agent settings, DeerFlow runtime mapping, Tool catalog, and ToolUse safety.
- `API.md`: HTTP API contracts, runtime environment variables, and response shape.
- `DEERFLOW_RUNTIME_RUNBOOK.md`: Docker Desktop/local and Linux Docker Compose runtime acceptance, dependencies, ports, env, smoke checks, and troubleshooting.
- `DATABASE.md`: SQLite location, tables, Canvas write semantics, and migration notes.
- `SECURITY.md`: local secret handling, tool permissions, DeerFlow auth, and runtime redaction rules.
- `DECISIONS.md`: dated technical decisions and their impacts.
- `REFACTOR_LOG.md`: review results, completed work, open TODOs, and next priority checks.

## Update Rules
- Code structure changes update `ARCHITECTURE.md`.
- API changes update `API.md`.
- Database or storage changes update `DATABASE.md`.
- Agent, ToolUse, Skill, MCP, or DeerFlow runtime changes update `AGENT.md`.
- Security, auth, secret, approval, or side-effect changes update `SECURITY.md`.
- Important design tradeoffs update `DECISIONS.md`.
- Every review or refactor updates `REFACTOR_LOG.md`.

## Current Runtime Position
FacetWrite is the workspace and control plane. It owns the frontend workspace, configuration surfaces, SQLite data, Canvas state, and Human-in-the-loop approval.

DeerFlow is the AI execution/runtime plane. When enabled, FacetWrite calls the DeerFlow sidecar for Lead Agent, subagent, ToolUse, MCP, and intelligent orchestration behavior. The TypeScript provider runtime remains a fallback path while DeerFlow integration matures.
