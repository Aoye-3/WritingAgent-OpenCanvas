# AgentBackend Runtime Runbook

## Plan Stream Diagnostics

FacetWrite requests `messages-tuple`, `custom`, and `values`; the Gateway may emit LangGraph `messages` after normalizing `messages-tuple`. The adapter accepts both names, subgraph tuples, text blocks, and final `values`. Deltas are accumulated per message id and only the final visible AI message is returned.

Plan/Artifact bridge results preserve structured payloads through the private `__FACETWRITE_EVENT__` envelope. A run with no assistant text but a valid Plan/Artifact event is successful. A run with neither reports that it completed without visible text or structured events instead of claiming the backend is disconnected.

`PlanToolChoiceMiddleware` enforces the runtime contract. Planning forces the first `plan_update` call. Execution allows research tools, then intercepts a text-only finish and forces `artifact_stage` until the current step has a committed Canvas artifact. FacetWrite also validates these postconditions after the stream, so unsupported provider behavior fails visibly instead of producing a false successful answer.

Middleware changes require restarting the project-owned local Gateway with `npm run agent:down` followed by `npm run agent:up`; reusing an already-running Gateway does not reload Python modules.

For a stuck Plan run, verify model sync, Gateway HTTP/run status, the bridge envelope, the final message id/`values` snapshot, and the persisted PlanRun/current step in that order.

Repository maintenance must use the current `F:\.FinalProject` checkout and a normal branch. Do not create Git worktrees or project copies on another drive.

This historical path is kept for compatibility. The maintained runbook is now [`AGENT_RUNTIME_RUNBOOK.md`](AGENT_RUNTIME_RUNBOOK.md).
# FacetWrite Model Config Synchronization (2026-06-11)

FacetWrite Model Config is the only model/API configuration source for generation.

- On API startup and after Model Config create/update/delete, FacetWrite sends enabled chat models to `PUT /api/models/runtime-sync`.
- AgentBackend replaces its in-memory model allowlist with the synchronized entries.
- The stable Model Config ID is used as AgentBackend `model_name`.
- AgentBackend must reject requests without `model_name` or with an unknown ID; it must not select the first configured model.
- Run requests include real Project and Thread IDs. Agent-owned memory is disabled; Project context is assembled by FacetWrite.
