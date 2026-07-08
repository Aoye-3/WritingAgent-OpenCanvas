# ADR: Layer Agent Budget Gates Before LangGraph Recursion Fuse

## Status

Accepted

## Date

2026-07-06

## Context

Long-task Agent Runtime runs use FacetWrite budget profiles to keep evidence gathering, model calls, progressive Canvas checkpoints, and final delivery bounded. Earlier budget behavior treated `facetwrite_recursion_limit` as an advisory synthesis signal and expanded the top-level LangGraph `config.recursion_limit` to a larger hard guard so final `write_file` / `present_files` delivery could finish.

That protected final file delivery, but it left the normal Agent loop too soft. When the model ignored the hidden budget notice and continued calling exploration tools, the run could keep looping until LangGraph raised `GraphRecursionError`. The visible failure looked like a runtime crash even though FacetWrite had already collected recoverable Canvas progress.

Canvas delivery also needs a stricter terminal-delivery boundary. Research/progress nodes and `Body draft` checkpoints are useful recoverable artifacts, but they are not the final deliverable. Treating them as durable completion can make a budget-stopped run look completed before final Body, file document, Canvas mutation, Artifact, or user-facing final text exists.

## Decision

Keep the larger LangGraph `config.recursion_limit` as a runaway-loop fuse, but move normal budget stopping into FacetWrite-owned middleware and completion evaluation.

Budget handling is layered:

1. The runtime budget profile remains the product budget source: `low`, `medium`, or `high`.
2. `facetwrite_recursion_limit`, model-call budget, evidence-tool budget, and synthesis reserve remain available in runtime context for middleware decisions.
3. Middleware emits `synthesis_gate` telemetry and appends a hidden budget notice when evidence, model, or step reserve thresholds enter synthesis territory.
4. After the gate, middleware narrows tools to finalization only.
5. File-delivery runs may continue with `write_file` and `present_files`.
6. Non-file runs may continue only with explicit final Canvas write tools.
7. Model attempts to continue exploration tool calls or emit internal tool protocol after the budget notice enter a bounded finalization retry loop instead of being treated as immediate final output.
8. The retry loop uses a 1+3+1 policy: the first violation gets a strong hidden finalization prompt, the next three violations get stricter finalization prompts, and the fifth violation emits `finalization_retry_exhausted` telemetry and a recoverable partial result.
9. LangGraph `GraphRecursionError` remains recoverable failure telemetry, not the expected budget-stop path.

Completion evaluation now treats only terminal delivery as durable completion:

- final assistant text;
- `canvas_delivery_body_final_committed`;
- `canvas_delivery_file_document_committed`;
- committed Canvas mutation/node events;
- committed Artifact events.

Canvas research/progress nodes, outline events, and `canvas_delivery_body_checkpoint_committed` are recoverable intermediate artifacts only.

When the finalization retry limit is exhausted, completion evaluation must mark the run `partial` even if the fallback status text is present. The frontend should treat this as a resumable budget-continuation state and offer "continue finalization" rather than showing it as a completed answer or a generic unfinished-tool wait.

## Alternatives Considered

### Use LangGraph `recursion_limit` as the business budget

Rejected. LangGraph uses recursion limit as a graph-step safety clamp. Letting it be the normal stop condition produces failure-shaped user experiences and can interrupt final delivery.

### Keep budget gates advisory only

Rejected. Advisory-only gates depend on the model choosing to stop tool calls. In practice, the Agent can continue exploration until the hard recursion fuse fires.

### Replace `create_agent` with a custom StateGraph

Deferred. A custom graph could model explicit evidence, synthesis, finalization, and validation nodes, but the current fix needs to preserve the existing AgentBackend harness and tool bridge. Middleware tool narrowing is the smallest compatible control point.

## Consequences

- Budgeted runs should enter final synthesis before hitting the LangGraph recursion fuse.
- File delivery remains possible after the synthesis gate because `write_file` and `present_files` stay exposed for file-delivery runs.
- Exploration tools such as search, fetch, file read, shell, grep, glob, ls, and knowledge lookup are no longer available after the synthesis gate.
- Budget-notice violations now get up to five finalization attempts before being downgraded to a resumable partial state.
- Canvas checkpoints remain visible and recoverable, but do not mark a run complete by themselves.
- Runtime custom `synthesis_gate` payloads expose budget phase, blocked/allowed tool-call metadata, `finalization_retry_count`, `finalization_retry_limit`, and `finalization_retry_exhausted` for diagnostics.
- The earlier 2026-07-04 decision remains valid for the expanded hard guard, but its advisory-only middleware impact is superseded by this ADR.
