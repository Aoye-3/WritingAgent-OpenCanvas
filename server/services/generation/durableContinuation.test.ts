import test from "node:test";
import assert from "node:assert/strict";
import type { GenerateRequest } from "../../contracts/generation.js";
import type { DurableContinuationDescriptor } from "../../storageTypes.js";
import {
  createDurableContinuationDescriptor,
  durableContinuationClaim,
  isStandaloneDurableContinuationIntent,
  resolveDurableContinuationRequest,
  withDurableContinuationDelivery
} from "./durableContinuation.js";

test("only narrow standalone continuation intents are recognized", () => {
  for (const value of ["继续", "接着做", "继续执行。", "continue", "GO ON!", "resume…"]) {
    assert.equal(isStandaloneDurableContinuationIntent(value), true, value);
  }
  for (const value of ["continue the report", "please continue", "继续写第二章", "resume plan 2", "go onward"]) {
    assert.equal(isStandaloneDurableContinuationIntent(value), false, value);
  }
});

test("descriptor is a versioned whitelist without arbitrary context or resume credentials", () => {
  const payload = withDurableContinuationDelivery({
    mode: "chat",
    locale: "en",
    chatInstruction: "Complete the original report",
    agentCardId: "blog-post",
    projectId: "project_1",
    runtimeBudgetProfile: "high",
    transientSkillRefs: ["research"],
    disabledSkillRefs: ["unused"],
    modelOverrides: { thinkingMode: "enabled", reasoningEffort: "xhigh" },
    selectedCanvasNodeId: "node_1",
    contextValues: {
      arbitraryClientValue: { secret: true },
      runtimeResume: { checkpointId: "credential" },
      durableContinuation: { claimToken: "client-token" },
      agentIntake: { phase: "execution", completed: true, clientOnlyField: "must not persist", runtimeResume: { checkpoint: "secret" } },
      taskHandlingPolicy: { executionMode: "progressive", canvasDeliveryMode: "progressive" },
      canvas: { workflow: { mode: "mind_map" }, nodes: [{ id: "stale", content: "stale" }] }
    }
  }, "delivery_1");

  const descriptor = createDurableContinuationDescriptor(payload);
  assert.equal(descriptor.deliveryId, "delivery_1");
  assert.equal(descriptor.workflowMode, "mind_map");
  assert.deepEqual(Object.keys(descriptor.safeContext ?? {}).sort(), ["agentIntake", "taskHandlingPolicy"]);
  const serialized = JSON.stringify(descriptor);
  assert.doesNotMatch(serialized, /arbitraryClientValue|clientOnlyField|runtimeResume|checkpoint|client-token|stale/);
});

test("claim restoration uses server descriptor, current Canvas, and safe prior evidence", () => {
  const descriptor: DurableContinuationDescriptor = {
    version: 1,
    resolvedInstruction: "Complete the original report with the research skill",
    agentCardId: "blog-post",
    projectId: "project_1",
    transientSkillRefs: ["research"],
    runtimeBudgetProfile: "high",
    deliveryId: "delivery_1",
    workflowMode: "mind_map",
    selectedCanvasNodeId: "node_1",
    safeContext: {
      agentIntake: { executionPhase: "execute" },
      taskHandlingPolicy: { executionMode: "progressive", canvasDeliveryMode: "progressive" }
    }
  };
  const storage = {
    readDurableContinuation: () => ({ state: "ready" as const, descriptor, sourceRunId: "run_1" }),
    claimDurableContinuation: () => ({ state: "claimed" as const, descriptor, sourceRunId: "run_1", claimToken: "server-token", attempts: 1 }),
    listDurableContinuationEvidence: () => [{ eventType: "tool_call_completed", payload: { path: "/outputs/report.md" } }],
    supersedeDurableContinuation: () => false
  };
  const payload: GenerateRequest = {
    mode: "chat",
    locale: "zh",
    threadId: "thread_1",
    chatInstruction: "继续",
    contextValues: {
      durableContinuation: { claimToken: "client-token", descriptor: { resolvedInstruction: "attack" } },
      canvas: { workflow: { mode: "freeform_diagram" }, nodes: [{ id: "live", title: "Current Canvas node", content: "current content" }] }
    }
  };

  const restored = resolveDurableContinuationRequest(storage, "thread_1", payload);
  assert.equal(restored.payload.chatInstruction, descriptor.resolvedInstruction);
  assert.equal(restored.payload.agentCardId, descriptor.agentCardId);
  assert.equal(restored.payload.runtimeBudgetProfile, "high");
  assert.equal(restored.payload.selectedCanvasNodeId, "node_1");
  assert.equal((restored.payload.contextValues?.canvas as Record<string, unknown>).nodes instanceof Array, true);
  assert.match(JSON.stringify(restored.payload.contextValues?.canvas), /Current Canvas node/);
  assert.equal(((restored.payload.contextValues?.canvas as { workflow: { mode: string } }).workflow.mode), "mind_map");
  assert.deepEqual(restored.payload.contextValues?.durableContinuationEvidence, [{ eventType: "tool_call_completed", payload: { path: "/outputs/report.md" } }]);
  assert.doesNotMatch(JSON.stringify(restored.payload), /client-token|attack/);
  assert.deepEqual(durableContinuationClaim(restored.payload), {
    claimToken: "server-token",
    visibleUserMessage: "继续",
    descriptor
  });
});

test("no descriptor remains ordinary chat and substantive requests supersede retryable state", () => {
  let superseded = 0;
  const storage = {
    readDurableContinuation: () => undefined,
    claimDurableContinuation: () => { throw new Error("must not claim"); },
    listDurableContinuationEvidence: () => [],
    supersedeDurableContinuation: () => { superseded += 1; return true; }
  };
  const continuation = resolveDurableContinuationRequest(storage, "thread_1", {
    mode: "chat", locale: "en", chatInstruction: "continue", contextValues: { durableContinuation: { descriptor: "client" } }
  });
  assert.equal(continuation.payload.chatInstruction, "continue");
  assert.equal(continuation.payload.contextValues?.durableContinuation, undefined);

  resolveDurableContinuationRequest(storage, "thread_1", {
    mode: "chat", locale: "en", chatInstruction: "Start a different task"
  });
  assert.equal(superseded, 1);
});
