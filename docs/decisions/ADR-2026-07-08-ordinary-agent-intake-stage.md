# ADR: Use Ordinary Intake For Multi-Round Agent Clarification

## Status

Accepted

## Date

2026-07-08

## Context

Ordinary Agent clarification already has a durable product path: Runtime emits `agent_clarification_requested`, FacetWrite stores one pending row in `agent_clarifications`, the composer renders the existing choice card, and answering the card persists the answer before resuming the same Runtime checkpoint. Missing resume metadata is a protocol failure and does not start a compatible fresh-run continuation.

The product goal is to let ordinary Agent tasks ask multiple clarifying questions when the request is under-scoped, without replacing the existing single-question UI and storage contract. Earlier prompt-only and execution-whitelist attempts were not reliable enough. After the first answer, the model often moved into execution because evidence, Canvas, file, and delivery tools were visible again; at that point another `ask_clarification` competed with doing the work.

Skill scope guard already demonstrates a safer shape: keep clarification inside an intake phase, expose only side-effect-free intake tools, and enter execution only after the intake policy says enough information has been collected.

## Decision

Use an explicit Ordinary Intake stage for ordinary Agent clarification.

The maintained protocol remains single-question:

- `ask_clarification` accepts one `question` and 2-3 structured `options`;
- there is no `questions[]` payload;
- there is no Human Interaction table;
- the existing composer clarification card and `agent_clarifications` storage remain authoritative.

The generation service injects `contextValues.ordinaryClarificationIntake` with:

- `mode:"ordinary"`;
- `state:"collecting" | "completed"`;
- `maxRounds:3`;
- `minAnsweredRoundsAfterFirstAsk:2`;
- `answeredRounds`;
- `remainingRounds`;
- `answeredSummary`.

Tool exposure is controlled by intake state:

- before any ordinary clarification answer, expose `ask_clarification` and `agent_intake_complete`;
- after one answered ordinary clarification, expose only `ask_clarification`;
- after two answered ordinary clarifications, expose `ask_clarification` and `agent_intake_complete`;
- after three answered ordinary clarifications, do not expose ordinary `ask_clarification`.

When `agent_intake_complete` is accepted, FacetWrite marks `agentIntake.phase:"execution"` and `ordinaryClarificationIntake.state:"completed"`, then enters the existing final-supplement confirmation before starting the execution run with the normal tool surface restored. Execution no longer gets ordinary clarification access through a remaining-round whitelist.

## Alternatives Considered

### Prompt-only multi-round clarification

Rejected. Prompt wording can encourage a clarification agenda, but it cannot reliably prevent a resumed run from entering execution after one answer when execution tools are already visible.

### Single interaction with multiple fields

Deferred. A multi-field Human Interaction layer is a larger architecture change touching event protocol, storage, frontend controls, and resume payloads. The current goal is to improve ordinary clarification reliability while preserving the stable single-question surface.

### Execution-stage clarification whitelist

Rejected. Allowing `ask_clarification` during execution blurs the phase boundary and makes delivery tools compete with intake. It also makes it harder to reason about when Canvas/file/evidence side effects are allowed.

### Reuse Skill scope guard slots for all ordinary tasks

Rejected. Skill scope guard has domain-specific missing-slot logic for research/search tasks. Ordinary tasks should not inherit those slot constraints; they only need phase isolation, answered-summary continuity, and a round policy.

## Consequences

- Ordinary clarification can reliably ask more than one question while keeping the old UI and storage contract.
- Once the Agent starts asking ordinary clarification questions, it normally collects at least two answered rounds before it can complete intake.
- The Agent may still complete intake immediately before asking anything when the task is already sufficiently scoped.
- Plan clarification remains product-owned Plan flow and does not enter Ordinary Intake.
- Skill scope guard remains slot-based and independent from Ordinary Intake.
- Runtime diagnostics should inspect `ordinaryClarificationIntake`, `facetwrite_intake_phase`, and `facetwrite_allowed_tool_refs` before debugging frontend rendering.
- Tests must cover dynamic intake tools, answered-summary injection, no automatic execution after one ordinary answer, execution restoration after `agent_intake_complete`, and the three-round stop condition.
- Checkpoint persistence and answer-resume semantics are defined separately by [`ADR-2026-07-14-durable-agent-clarification-checkpoint-resume.md`](ADR-2026-07-14-durable-agent-clarification-checkpoint-resume.md); Ordinary Intake controls when clarification is allowed, not how an answer is resumed.
