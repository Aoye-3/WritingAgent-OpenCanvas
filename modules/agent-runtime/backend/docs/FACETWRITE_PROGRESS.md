# FacetWrite Public Progress Contract

FacetWrite consumes LangGraph `custom` stream events as a product reporting channel. This channel is separate from final assistant text and from raw tool/debug logs.

## Event Types

- `agent_progress_reported`: public or diagnostic progress emitted by Runtime middleware or workers.
- `agent_intervention_checkpoint`: a safe point where a queued user intervention may be injected before the next model step.

Both events must be plain JSON objects and must use the same field whitelist:

```text
type
event
runId
threadId
stageId
phase
status
title
summary
next
interventionHint
outputRefs
source
visibility
createdAt
```

Do not include prompts, messages, raw tool arguments, tool results, `contextValues`, secrets, provider reasoning, token payloads, system instructions, or replay state in these events.

## Visibility

`visibility:"stage"` means the event is eligible for the right-drawer stage report after FacetWrite's TypeScript whitelist filter. Stage events must describe user-meaningful work, for example "collecting evidence", "updating Canvas", "writing deliverable", "validating output", or "ready for a user constraint before the next model step".

`visibility:"raw"` means the event is telemetry. Raw events may update active run metadata, intervention binding, counters, trace details, or tool logs, but they must not create a main progress paragraph.

The default for these low-level lifecycle events is `raw`:

- run start / runtime ready housekeeping
- before model / after model
- tool start / tool complete
- ordinary safe point before or after a tool
- command start / command complete
- stdout / stderr / debug metadata

Only semantic milestones, deliverable checkpoints, failure recovery, final synthesis, and explicit `interventionHint` safe points should be promoted to `stage`.

## Consumer Invariants

FacetWrite keeps three projections:

- final assistant text: persisted assistant answer and deliverable summary
- stage reports: `progress_event` / `progressSegments` in the assistant run block
- raw logs: `tool_event`, non-progress `timeline_event`, command logs, and trace details

A single low-level event should not appear as both a stage report and a raw-log headline. If Runtime cannot provide a semantic stage event, the Node generation service may aggregate repeated raw events into one stage fallback such as evidence collection, Canvas update, delivery, or finalization.
