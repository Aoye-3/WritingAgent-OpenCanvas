# Runtime Completion Status Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Agent run breakage where runtime budget/waiting/internal-output events are incorrectly surfaced as pending user clarification or runtime failure.

**Architecture:** Keep the Python budget middleware as the source of soft budget notices. Move the correction into the TypeScript completion/status layer by narrowing clarification detection, allowing post-clarification progress to clear waiting, and preserving completed runs when budget synthesis or Canvas/file delivery exists. Make internal-output blocking a visible-output sanitizer plus telemetry marker, not an automatic run failure.

**Tech Stack:** TypeScript, Node `node:test`, FacetWrite generation service, Agent Runtime adapter events.

---

## File Structure

- Modify `server/services/generation/completionEvaluator.ts`
  - Owns final run completion verdicts.
  - Fix pending clarification detection and budget synthesis verdicts here first.
- Modify `server/services/generation/completionEvaluator.test.ts`
  - Add regression tests for non-clarification waiting timeline events, post-clarification progress, budget synthesis completion, and durable delivery with empty assistant text.
- Modify `server/services/generation/generationService.ts`
  - Remove the remaining `internal_output_blocked` to runtime-failure conversion.
  - Keep internal text redacted and allow empty visible text to be recorded when no deliverable exists.
- Modify `server/services/generationService.facade.test.ts`
  - Add integration-level regression tests for blocked internal output without `agent_backend_runtime_failed`.

---

### Task 1: Lock Current Broken Completion Semantics With Failing Tests

**Files:**
- Modify: `server/services/generation/completionEvaluator.test.ts`

- [ ] **Step 1: Add regression tests for false clarification waiting**

Append these tests after the existing pending clarification test:

```typescript
test("completion evaluator does not treat ordinary waiting timeline decisions as clarification", () => {
  const events: ToolEventRecord[] = [{
    eventType: "run_timeline_decision",
    payload: {
      eventType: "decision",
      status: "waiting",
      signal: "synthesis_gate",
      title: "Final synthesis"
    }
  }];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Synthesized final answer.",
    events,
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator clears clarification waiting after later delivery progress", () => {
  const events: ToolEventRecord[] = [
    {
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        question: "Which scope?",
        options: [
          { id: "focused", label: "Focused", detail: "Use a narrow scope." },
          { id: "broad", label: "Broad", detail: "Use a broad scope." }
        ]
      }
    },
    {
      eventType: "agent_backend_tool_completed",
      payload: { toolName: "web_search", toolCallId: "call_search" }
    },
    {
      eventType: "canvas_delivery_body_final_committed",
      payload: { title: "Body", status: "committed" }
    }
  ];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Final answer after clarification.",
    events,
    finishReason: "clarification_required"
  });

  assert.equal(verdict.status, "completed");
});
```

- [ ] **Step 2: Update the existing real clarification test to include valid options**

Change the event payload in `completion evaluator waits for pending clarification` to:

```typescript
payload: {
  type: "agent_clarification_requested",
  question: "Which scope?",
  options: [
    { id: "focused", label: "Focused", detail: "Use a narrow scope." },
    { id: "broad", label: "Broad", detail: "Use a broad scope." }
  ]
}
```

- [ ] **Step 3: Run the focused test file and verify failure**

Run:

```powershell
npm test -- server/services/generation/completionEvaluator.test.ts
```

Expected before implementation:
- The ordinary `run_timeline_decision/status:"waiting"` test fails with `waiting` instead of `completed`.
- The post-clarification progress test fails with `waiting` instead of `completed`.

---

### Task 2: Narrow Pending Clarification Detection

**Files:**
- Modify: `server/services/generation/completionEvaluator.ts`
- Test: `server/services/generation/completionEvaluator.test.ts`

- [ ] **Step 1: Replace direct clarification waiting check**

Change:

```typescript
if (hasPendingClarification(events) || input.finishReason === "clarification_required") {
```

to:

```typescript
if (hasPendingClarification(events)) {
```

This prevents a broad adapter-level `finishReason: "clarification_required"` from forcing waiting when there is no valid structured clarification request.

- [ ] **Step 2: Replace `hasPendingClarification` with explicit structured clarification logic**

Replace the current `hasPendingClarification` function with:

```typescript
function hasPendingClarification(events: ToolEventRecord[]) {
  let pending = false;
  for (const event of events) {
    if (pending && isPostClarificationProgress(event)) {
      pending = false;
      continue;
    }
    if (isExplicitClarificationRequest(event)) {
      pending = true;
    }
  }
  return pending;
}

function isExplicitClarificationRequest(event: ToolEventRecord) {
  const payload = record(event.payload);
  const type = string(payload.type) || string(payload.eventType);
  if (!/agent_clarification_requested$/.test(event.eventType) && type !== "agent_clarification_requested") {
    return false;
  }
  return Boolean(string(payload.question) && clarificationOptionCount(payload.options) >= 2);
}

function clarificationOptionCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => {
    if (typeof item === "string") return Boolean(item.trim());
    const option = record(item);
    return Boolean(string(option.label) || string(option.title));
  }).length;
}

function isPostClarificationProgress(event: ToolEventRecord) {
  if (isExplicitClarificationRequest(event)) return false;
  const payload = record(event.payload);
  const toolName = string(payload.toolName) || string(payload.tool);
  const payloadEventType = string(payload.eventType) || string(payload.type);
  return event.eventType === "run_completed"
    || event.eventType === "run_timeline_run_completed"
    || /(?:^|_)tool_(?:started|completed)$/.test(event.eventType)
    || /^(?:write_file|present_files|web_search|web_fetch|knowledge_base|canvas_write)$/.test(toolName)
    || /^canvas_delivery_(?:research|body_checkpoint|body_final|file_document)_committed$/.test(event.eventType)
    || /^canvas_delivery_(?:research|body_checkpoint|body_final|file_document)_committed$/.test(payloadEventType)
    || /(?:^|_)canvas_mutation_committed$/.test(event.eventType)
    || /(?:^|_)artifact_(?:staged|committed)$/.test(event.eventType);
}
```

- [ ] **Step 3: Run the focused completion evaluator tests**

Run:

```powershell
npm test -- server/services/generation/completionEvaluator.test.ts
```

Expected:
- The two new clarification regression tests pass.
- The real clarification test still returns `waiting`.

---

### Task 3: Make Budget Synthesis A Notice, Not A Forced Partial

**Files:**
- Modify: `server/services/generation/completionEvaluator.ts`
- Modify: `server/services/generation/completionEvaluator.test.ts`

- [ ] **Step 1: Replace the old budget test expectation**

Change the existing test name:

```typescript
test("completion evaluator treats runtime budget gates as partial, not completed", () => {
```

to:

```typescript
test("completion evaluator allows runtime budget gates to complete with final text", () => {
```

Change:

```typescript
assert.equal(verdict.status, "partial");
assert.match(verdict.reasons[0] ?? "", /budget gate/);
```

to:

```typescript
assert.equal(verdict.status, "completed");
assert.match(verdict.reasons.join(" "), /budget gate/);
```

- [ ] **Step 2: Add an empty-text durable delivery regression**

Append:

```typescript
test("completion evaluator completes empty assistant text when durable delivery exists", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [{
      eventType: "canvas_delivery_file_document_committed",
      payload: { title: "Report", status: "committed" }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});
```

- [ ] **Step 3: Update empty text and budget branches**

In `evaluateRunCompletion`, add a durable delivery local before the empty text check:

```typescript
const durableDelivery = hasDurableDelivery(events);
```

Change:

```typescript
if (!text) {
```

to:

```typescript
if (!text && !durableDelivery) {
```

Change:

```typescript
if (requiresDurableCanvasCommit(input.payload) && !hasDurableDelivery(events)) {
```

to:

```typescript
if (requiresDurableCanvasCommit(input.payload) && !durableDelivery) {
```

Change the budget branch to:

```typescript
if (hasBudgetSynthesisSignal(events)) {
  reasons.push("The runtime reached a budget gate and synthesized from available evidence.");
  if (text || durableDelivery) {
    reasons.push("Final answer or durable delivery exists and no rule-first blockers remain.");
    return verdict("completed", reasons, []);
  }
  return verdict("partial", reasons, []);
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- server/services/generation/completionEvaluator.test.ts
```

Expected:
- Budget synthesis with final text returns `completed`.
- Empty visible text with durable file/Canvas delivery returns `completed`.

---

### Task 4: Stop Converting Blocked Internal Output Into Runtime Failure

**Files:**
- Modify: `server/services/generation/generationService.ts`
- Modify: `server/services/generationService.facade.test.ts`

- [ ] **Step 1: Add facade regression for internal output without runtime failure**

In `server/services/generationService.facade.test.ts`, add a test that stubs AgentBackend to return internal text such as:

```typescript
"LLM request failed: provider rejected reasoning_content"
```

The expected assertions should be:

```typescript
assert.equal(response.provider, "agent-backend");
assert.notEqual(response.finishReason, "runtime_failed");
assert.equal(response.errorMessage, undefined);
assert.equal(response.text, "");
assert.ok(response.events.some((event) => event.eventType === "internal_output_blocked"));
assert.equal(response.events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
assert.notEqual(response.completion.status, "failed");
```

- [ ] **Step 2: Add facade regression for existing delivery evidence**

Add a second facade test where AgentBackend returns blocked internal output plus an event:

```typescript
{
  eventType: "canvas_delivery_file_document_committed",
  payload: { title: "Report", status: "committed" }
}
```

The expected assertions should be:

```typescript
assert.equal(response.text, "");
assert.equal(response.completion.status, "completed");
assert.ok(response.events.some((event) => event.eventType === "internal_output_blocked"));
assert.equal(response.events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
```

- [ ] **Step 3: Remove the fallback failure branch**

In `server/services/generation/generationService.ts`, replace:

```typescript
if (blockedInternalOutput && !hasVisibleAgentDeliveryEvidence(visibleText, baseEvents)) {
  const event = createRuntimeFallbackEvent("agent-backend", new Error("AgentBackend returned internal runtime output"), isMockFallbackEnabled(deps));
  runtimeEvents.push(...normalizedEvents, event);
  observeToolEvent(event);
} else {
  ...
}
```

with a direct continuation into the normal finalization path:

```typescript
if (isBlockingAgentClarificationRun(baseEvents, visibleText, agentBackendRun.finishReason)) {
  ...
}
const finalized = finalizeCanvasDelivery({
  ...
});
```

Keep `visibleText` as `""` for blocked internal output. Keep `internal_output_blocked` in `baseEvents`.

- [ ] **Step 4: Run facade tests**

Run:

```powershell
npm test -- server/services/generationService.facade.test.ts
```

Expected:
- Internal output is redacted.
- `internal_output_blocked` exists.
- `agent_backend_runtime_failed` is not added.
- Run completion is not `failed` solely because internal output was blocked.

---

### Task 5: Verify Existing Runtime Budget Middleware Still Matches The New Contract

**Files:**
- Test only: `modules/agent-runtime/backend/tests/test_plan_tool_choice_middleware.py`

- [ ] **Step 1: Run Python focused tests**

Run:

```powershell
cd modules/agent-runtime/backend
uv run pytest tests/test_plan_tool_choice_middleware.py -q
```

Expected:
- Budget notice still keeps tools available.
- Continuing tool calls after notice does not raise.
- Internal protocol after notice does not raise.

- [ ] **Step 2: Run existing output normalizer tests**

Run from repo root:

```powershell
npm test -- server/services/generation/outputNormalizer.test.ts
```

Expected:
- Internal prompt/tool JSON/DSML is still redacted.
- `internal_output_blocked` is still emitted.

---

### Task 6: End-To-End Regression Check

**Files:**
- No additional source files unless a test exposes a real frontend-only stale state bug.

- [ ] **Step 1: Run service tests**

Run:

```powershell
npm test -- server/services/generation/completionEvaluator.test.ts server/services/generation/outputNormalizer.test.ts server/services/generationService.facade.test.ts
```

Expected:
- All focused TypeScript tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected:
- TypeScript builds without errors.

- [ ] **Step 3: Manual acceptance scenario**

Run the app with the existing local runtime setup, then reproduce the screenshot flow:

```powershell
npm run dev
```

Expected:
- Budget/synthesis timeline entries may show “Final synthesis” or model waiting, but they do not produce “Answer the pending clarification before completion.”
- A real structured clarification still shows waiting and options.
- After answering a real clarification and seeing later tool/Canvas progress, the run no longer remains stuck in waiting.
- Blocked internal output appears as no visible assistant text plus `internal_output_blocked`, not as a runtime failed Canvas node.

---

## Self-Review

- Spec coverage:
  - Budget only reminds: Task 3 updates budget completion semantics.
  - Internal output is blocked but does not terminate: Task 4 removes failure conversion and adds facade tests.
  - No indiscriminate clarification: Task 2 narrows clarification detection.
  - Existing Python budget middleware behavior remains verified: Task 5.
- Placeholder scan:
  - No TBD/TODO placeholders.
  - Each code-changing task includes exact snippets.
- Type consistency:
  - Uses existing `ToolEventRecord`, `GenerateRequest`, `RunCompletionVerdict`, `completion.status`, `eventType`, and `payload` shapes.
