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
    readDurableContinuationCanvas: () => ({
      nodes: [{
        id: "live",
        kind: "document",
        title: "Authoritative Canvas node",
        content: "Current authoritative body text",
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        metadata: { phase: "body" },
        includeInProjectContext: true
      }],
      edges: [],
      objects: [],
      workflow: { mode: "freeform_diagram", stage: "draft" }
    }),
    listDurableContinuationEvidence: () => [{ eventType: "tool_call_completed", payload: { path: "/outputs/report.md" } }],
    supersedeDurableContinuation: () => false,
    failDurableContinuation: () => false
  };
  const payload: GenerateRequest = {
    mode: "chat",
    locale: "zh",
    threadId: "thread_1",
    chatInstruction: "继续",
    contextValues: {
      durableContinuation: { claimToken: "client-token", descriptor: { resolvedInstruction: "attack" } },
      canvas: {
        clientOnlyField: "must not survive",
        workflow: { mode: "freeform_diagram" },
        nodes: [{ id: "stale", title: "Client snapshot", content: "stale client content" }]
      }
    }
  };

  const restored = resolveDurableContinuationRequest(storage, "thread_1", payload);
  assert.equal(restored.payload.chatInstruction, descriptor.resolvedInstruction);
  assert.equal(restored.payload.agentCardId, descriptor.agentCardId);
  assert.equal(restored.payload.runtimeBudgetProfile, "high");
  assert.equal(restored.payload.selectedCanvasNodeId, "node_1");
  const canvas = restored.payload.contextValues?.canvas as {
    deliveryId: string;
    selectedCanvasNodeId: string;
    workflow: { mode: string };
    nodes: Array<{ title: string; content: string }>;
  };
  assert.equal(canvas.nodes[0]?.title, "Authoritative Canvas node");
  assert.equal(canvas.nodes[0]?.content, "Current authoritative body text");
  assert.equal(canvas.deliveryId, "delivery_1");
  assert.equal(canvas.selectedCanvasNodeId, "node_1");
  assert.equal(canvas.workflow.mode, "mind_map");
  assert.deepEqual(restored.payload.contextValues?.durableContinuationEvidence, [{ eventType: "tool_call_completed", payload: { path: "/outputs/report.md" } }]);
  assert.doesNotMatch(JSON.stringify(restored.payload), /client-token|attack|clientOnlyField|stale client content/);
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
    supersedeDurableContinuation: () => { superseded += 1; return true; },
    failDurableContinuation: () => false,
    readDurableContinuationCanvas: () => ({})
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

test("substantive requests cannot bypass an active continuation claim", () => {
  const descriptor: DurableContinuationDescriptor = {
    version: 1,
    resolvedInstruction: "Original task",
    agentCardId: "blog-post",
    projectId: "project_1",
    deliveryId: "delivery_1",
    workflowMode: "batch_delivery"
  };
  let superseded = 0;
  const storage = {
    readDurableContinuation: () => ({ state: "claimed" as const, descriptor, sourceRunId: "run_1" }),
    claimDurableContinuation: () => {
      throw Object.assign(new Error("durable_continuation_in_progress"), { code: "durable_continuation_in_progress" });
    },
    listDurableContinuationEvidence: () => [],
    supersedeDurableContinuation: () => { superseded += 1; return false; },
    failDurableContinuation: () => false,
    readDurableContinuationCanvas: () => ({})
  };

  assert.throws(
    () => resolveDurableContinuationRequest(storage, "thread_1", {
      mode: "chat", locale: "en", chatInstruction: "Start a different task"
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "durable_continuation_in_progress"
  );
  assert.equal(superseded, 0);
});

test("post-claim restoration errors immediately fail the owned claim", () => {
  const descriptor: DurableContinuationDescriptor = {
    version: 1,
    resolvedInstruction: "Original task",
    agentCardId: "blog-post",
    projectId: "project_1",
    deliveryId: "delivery_1",
    workflowMode: "batch_delivery"
  };
  const failures: Array<{ token: string; error: string }> = [];
  const storage = {
    readDurableContinuation: () => ({ state: "ready" as const, descriptor, sourceRunId: "run_1" }),
    claimDurableContinuation: () => ({
      state: "claimed" as const,
      descriptor,
      sourceRunId: "run_1",
      claimToken: "server-token",
      attempts: 1
    }),
    readDurableContinuationCanvas: () => { throw new Error("canvas storage unavailable"); },
    listDurableContinuationEvidence: () => [],
    supersedeDurableContinuation: () => false,
    failDurableContinuation: (_threadId: string, token: string, error: string) => {
      failures.push({ token, error });
      return true;
    }
  };

  assert.throws(
    () => resolveDurableContinuationRequest(storage, "thread_1", {
      mode: "chat", locale: "en", chatInstruction: "continue"
    }),
    /canvas storage unavailable/
  );
  assert.deepEqual(failures, [{ token: "server-token", error: "canvas storage unavailable" }]);
});

test("clarification, plan revision, and intervention flows never activate durable continuation", () => {
  const protectedRequests: Array<{ name: string; payload: GenerateRequest }> = [
    {
      name: "agent clarification",
      payload: {
        mode: "chat",
        locale: "en",
        chatInstruction: "continue",
        contextValues: { agentClarification: { clarificationId: "clarification_1", answer: "Report" } }
      }
    },
    {
      name: "plan clarification",
      payload: {
        mode: "chat",
        locale: "en",
        chatInstruction: "continue",
        planPhase: "intake",
        contextValues: { awaitingPlan: { id: "plan_clarification_1", answer: "Option A" } }
      }
    },
    {
      name: "plan revision",
      payload: {
        mode: "chat",
        locale: "en",
        chatInstruction: "continue",
        planPhase: "revise",
        planId: "plan_1"
      }
    },
    {
      name: "queued intervention",
      payload: {
        mode: "chat",
        locale: "en",
        chatInstruction: "continue",
        contextValues: { queuedIntervention: { runId: "runtime_1", text: "adjust scope" } }
      }
    }
  ];

  for (const { name, payload } of protectedRequests) {
    let durableCalls = 0;
    const storage = {
      readDurableContinuation: () => { durableCalls += 1; return undefined; },
      claimDurableContinuation: () => { durableCalls += 1; throw new Error("must not claim"); },
      supersedeDurableContinuation: () => { durableCalls += 1; return false; },
      failDurableContinuation: () => { durableCalls += 1; return false; },
      readDurableContinuationCanvas: () => { durableCalls += 1; return {}; },
      listDurableContinuationEvidence: () => { durableCalls += 1; return []; }
    };

    const resolved = resolveDurableContinuationRequest(storage, "thread_1", payload);
    assert.equal(resolved.claimed, false, name);
    assert.equal(resolved.payload.chatInstruction, "continue", name);
    assert.equal(durableCalls, 0, name);
  }
});
