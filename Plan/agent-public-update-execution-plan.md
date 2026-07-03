# Agent Public Update Execution Plan

## Goal

Make the frontend conversation stream show natural, useful Agent work updates such as:

> 我已经确认需求是外部调研 + 本地链路梳理，现在先并行派出两个子代理。
> 下一步我会检查这些事件怎么进入前端对话流。

The feature should not expose raw chain-of-thought, raw prompts, full tool arguments, full tool outputs, compressed conversation summaries, or internal runtime protocol payloads.

## Core Assumption

The desired product behavior is not "show real hidden reasoning." It is "show public work narration produced during real execution and backed by structured runtime events."

The safe architecture is:

1. Runtime emits factual structured events.
2. Agent or runtime emits short public narration events.
3. Deterministic filters decide what can reach the conversation UI.
4. Raw logs remain available only in the diagnostic panel.

## Success Criteria

1. During long Agent runs, the chat stream can show natural public progress updates in the assistant message.
2. The public updates are not fixed labels only; they can include "I have done X, next I will do Y."
3. Public updates are emitted through an explicit event type, not guessed from raw `run.end / outputs`.
4. Existing `status`, `tool_event`, `timeline_event`, and raw run log behavior continues to work.
5. Tests cover event sanitization and stream parsing for the new public update path.

## Non-Goals

1. Do not expose raw chain-of-thought.
2. Do not display raw `reasoning_content`, `messages`, `prompt`, `tool_calls.arguments`, or full tool result content in the normal conversation stream.
3. Do not rely on a supervisor Agent as the security boundary.
4. Do not replace the existing debug/raw run log panel.

## Proposed Event Model

Add or standardize a public update event shaped like this:

```ts
type AgentPublicUpdateEvent = {
  id: string;
  threadId?: string;
  runId?: string;
  phase?: "intake" | "context" | "research" | "inspect" | "act" | "observe" | "synthesize" | "verify" | "complete" | "blocked";
  status?: "running" | "completed" | "failed" | "waiting";
  summary: string;
  next?: string;
  evidence?: Array<{
    kind: "tool" | "subagent" | "codegraph" | "search" | "file" | "runtime";
    label: string;
    ref?: string;
  }>;
  visibility: "public";
  source: "agent_runtime" | "agent_public_update" | "system_projection";
  createdAt: string;
};
```

Map this into the existing frontend `AgentProgressEvent` / `ProgressSegment` path instead of creating a parallel UI system at first.

## Backend And Runtime Plan

### 1. Keep the current safe progress foundation

Relevant current files:

- `modules/agent-runtime/backend/packages/harness/deerflow/runtime/progress.py`
- `modules/agent-runtime/backend/packages/harness/deerflow/agents/middlewares/progress_reporting_middleware.py`
- `server/runtime/agentBackendAdapter/client.ts`
- `server/services/generation/generationService.ts`
- `server/routes/generationRoutes.ts`

Current state:

- `public_progress_payload` already has an allowlist and blocked-key filtering.
- `ProgressReportingMiddleware` already emits progress events, but many messages are rigid and marked `visibility: "raw"`.
- `/api/generate/stream` already supports `progress_event`.

Action:

- Extend the public progress payload to support `evidence`.
- Keep all values bounded and string-only except small typed arrays.
- Continue blocking keys related to prompt, reasoning, chain, token, secret, context, argument, and message.

### 2. Add a public narration event path

Preferred event names:

- Python/runtime custom event: `agent_public_update`
- TypeScript normalized event: `progress_event` with `source: "agent_public_update"` and `visibility: "public"`
- Timeline event payload: `{ kind: "progress_report", visibility: "public" }`

Action:

- Add a helper beside `public_progress_payload`, for example `public_update_payload(...)`.
- The helper should reuse the same sanitizer.
- The helper should require a non-empty `summary`.
- The helper should reject or drop overly long text.

### 3. Emit richer public updates at real execution boundaries

Start with deterministic points already known to be real:

- Run accepted / task interpreted.
- Subagent invoked.
- Search or CodeGraph/tool call started.
- Tool result observed.
- Evidence collection complete.
- Synthesis started.
- Verification started/completed.

Do not infer from raw `run.end / outputs` unless the content is already a public update event.

Example public messages:

- `我已经把任务拆成外部实践调研和本地链路梳理两路并行。`
- `我发现后端已有 progress_event 管道，下一步检查前端如何合并到对话消息。`
- `我已完成外部调研，正在把它和本地 CodeGraph 结果合并成方案。`

### 4. Optional later: Agent-authored updates

After the deterministic path is safe, allow the lead Agent to call a narrow internal tool such as `publish_public_update`.

Tool contract:

- Inputs: `summary`, optional `next`, optional `phase`.
- No arbitrary metadata.
- No raw observations.
- Server sanitizes again before streaming.

This gives us the natural "Agent says: I have..." feel without exposing hidden reasoning.

## Frontend Plan

Relevant current files:

- `src/features/generation/types.ts`
- `src/features/generation/generationClient.ts`
- `src/app/hooks/useGenerationRun.ts`
- `src/features/workspace/components/AICollaborationDrawer.tsx`
- `src/features/workspace/components/AssistantRunTrace.tsx`

### 1. Normalize stream events with a shared schema

Current risk:

- `generationClient.ts` casts parsed SSE payloads directly, for example `as AgentProgressEvent`.

Action:

- Add a discriminated union for stream events.
- Validate `progress_event` before handing it to `useGenerationRun`.
- Drop invalid public updates silently or route them to debug logging.

### 2. Make public updates feel like conversation flow

Current behavior:

- `progressSegments` are shown as rigid progress blocks.

Action:

- For `source: "agent_public_update"`, render a compact assistant-side activity line in the conversation message.
- Prefer natural text:
  - summary as the main line
  - next as a subtle second line if present
  - evidence as optional small chips or hidden details

Avoid labeling it as "thinking" or "chain of thought." Use "工作进展", "执行进展", or no visible label.

### 3. Keep raw logs separate

Action:

- Preserve `RawRunLogDetails`.
- Do not promote `run.end / outputs` content into the public conversation stream.
- Only show raw events in the diagnostic disclosure area.

## Filtering Rules

Default deny.

Allow only:

- `visibility: "public"` or existing `visibility: "stage"` after migration.
- `summary`, `next`, `phase`, `status`, `source`, `createdAt`, bounded `evidence`.
- Tool names and high-level statuses.
- Search result title/URL/snippet when already short and source-like.

Always block:

- `prompt`
- `system`
- `developer`
- `reasoning`
- `reasoning_content`
- `chain_of_thought`
- `messages`
- `tool_calls`
- `arguments`
- `context`
- `authorization`
- `secret`
- `password`
- raw file contents
- full webpage contents

## Testing Plan

### Unit Tests

1. Python sanitizer:
   - accepts a valid public update.
   - drops blocked keys.
   - truncates long fields.
   - rejects empty summary.

2. TypeScript event normalization:
   - accepts valid `progress_event`.
   - rejects missing `summary`.
   - rejects `visibility: "raw"` for conversation display.
   - preserves existing `tool_event` and `timeline_event` behavior.

3. SSE parser:
   - supports existing one-line `data:`.
   - supports multi-line `data:` blocks.

### Integration Tests

1. `/api/generate/stream` can stream:
   - `status`
   - `token`
   - `reasoning_token`
   - `tool_event`
   - `timeline_event`
   - `progress_event`
   - new public update payload

2. `useGenerationRun` attaches valid public updates to the active assistant message.

3. `AICollaborationDrawer` renders public updates while raw events stay in the raw log details.

### Manual QA

Run a long research task and verify:

1. The conversation stream shows natural progress updates.
2. Updates correspond to real execution boundaries.
3. No prompt/tool args/raw summaries appear in the visible conversation.
4. Debug panel still shows raw diagnostics when expanded.

## Rollout Plan

### Phase 1: Schema And Sanitizer

Implement the shared public update schema and sanitizer.

Verify:

- Unit tests pass.
- Existing stream events are unchanged.

### Phase 2: Deterministic Public Updates

Emit public updates from real runtime boundaries.

Verify:

- Long runs show natural updates.
- No raw fields leak.

### Phase 3: Frontend Presentation

Render public updates as conversational activity lines.

Verify:

- The UI feels alive but not noisy.
- Raw log remains separate.

### Phase 4: Optional Agent-Authored Updates

Add a narrow `publish_public_update` internal tool or middleware hook.

Verify:

- Output is schema-constrained.
- Server-side sanitizer remains the final gate.
- Agent-authored updates are useful enough to keep.

## Open Decisions

1. UI wording: "工作进展", "执行进展", or no label.
2. Whether public updates should appear as separate small assistant messages or nested inside the active assistant message.
3. Whether to show `next` by default or only on hover/expand.
4. Whether `evidence` should be visible chips or only diagnostic metadata.
5. Whether Agent-authored updates are enabled by default or behind a project/runtime flag.

## Recommended First Implementation Slice

1. Add public update schema and sanitizer.
2. Emit two deterministic public updates:
   - run started / task framed
   - synthesis started or tool observation completed
3. Render these updates inside the existing `progressSegments` path.
4. Add focused tests for sanitizer, SSE parsing, and frontend event attachment.

This slice is small enough to verify quickly and will prove whether the UX direction feels substantially better than fixed status labels.
