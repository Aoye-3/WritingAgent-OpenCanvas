# AgentBackend Runtime Runbook

This historical path is kept for compatibility. The maintained runbook is now [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md).
# FacetWrite Model Config Synchronization (2026-06-11)

FacetWrite Model Config is the only model/API configuration source for generation.

- On API startup and after Model Config create/update/delete, FacetWrite sends enabled chat models to `PUT /api/models/runtime-sync`.
- AgentBackend replaces its in-memory model allowlist with the synchronized entries.
- The stable Model Config ID is used as AgentBackend `model_name`.
- AgentBackend must reject requests without `model_name` or with an unknown ID; it must not select the first configured model.
- Run requests include real Project and Thread IDs. Agent-owned memory is disabled; Project context is assembled by FacetWrite.
