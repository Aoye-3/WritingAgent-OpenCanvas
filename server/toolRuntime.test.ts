import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall, getEnabledToolDefinitions } from "./toolRuntime.js";

test("exposes only enabled tools with chat-completion schemas", () => {
  const tools = getEnabledToolDefinitions(["knowledge_base", "web_search"], { knowledge_base: true, web_search: false });

  assert.deepEqual(tools.map((tool) => tool.function.name), ["knowledge_base"]);
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].function.parameters.additionalProperties, false);
});

test("executes local knowledge tool from current context", async () => {
  const result = await executeToolCall(
    {
      id: "call_1",
      type: "function",
      function: { name: "knowledge_base", arguments: JSON.stringify({ query: "draft", limit: 2 }) }
    },
    {
      contextValues: { currentDraft: "Draft text", knowledgeSource: "Course Notes" },
      chatInstruction: "Use the draft"
    }
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /Draft text/);
});

test("rejects a tool call disabled by runtime policy", async () => {
  const result = await executeToolCall(
    {
      id: "call_disabled",
      type: "function",
      function: { name: "knowledge_base", arguments: JSON.stringify({ query: "draft", limit: 2 }) }
    },
    {
      allowedToolRefs: ["knowledge_base"],
      toolState: { knowledge_base: false },
      contextValues: { currentDraft: "Draft text" }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "policy_denied");
  assert.match(result.content, /disabled/i);
});

test("rejects a tool call not allowed by the active Agent", async () => {
  const result = await executeToolCall(
    {
      id: "call_not_allowed",
      type: "function",
      function: { name: "canvas_write", arguments: JSON.stringify({ operation: "create", content: "Nope" }) }
    },
    {
      allowedToolRefs: ["knowledge_base"],
      toolState: { canvas_write: true }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "policy_denied");
  assert.match(result.content, /not allowed/i);
});

test("returns structured unavailable result for web search", async () => {
  const result = await executeToolCall(
    {
      id: "call_2",
      type: "function",
      function: { name: "web_search", arguments: JSON.stringify({ query: "latest" }) }
    },
    { contextValues: {}, chatInstruction: "search" }
  );

  assert.equal(result.ok, false);
  assert.match(result.content, /not configured/i);
});

test("canvas_write creates a pending request instead of writing directly", async () => {
  const result = await executeToolCall(
    {
      id: "call_3",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "create",
          nodeKind: "document",
          title: "Draft",
          content: "Pending draft",
          rationale: "The user asked for a first version."
        })
      }
    },
    {
      createCanvasWriteRequest(input) {
        assert.equal(input.operation, "create");
        assert.equal(input.content, "Pending draft");
        return {
          id: "write_1",
          operation: input.operation,
          nodeKind: input.nodeKind ?? "document",
          title: input.title ?? "",
          status: "pending"
        };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.requestId, "write_1");
  assert.equal(result.payload.status, "pending");
  assert.match(result.content, /ready for user confirmation/i);
});

test("executes local knowledge tool from KnowledgeService before context fallback", async () => {
  const result = await executeToolCall(
    {
      id: "call_knowledge_service",
      type: "function",
      function: { name: "knowledge_base", arguments: JSON.stringify({ query: "codename", limit: 2 }) }
    },
    {
      contextValues: { currentDraft: "Fallback draft text" },
      knowledgeService: {
        search: async () => [{
          id: 1,
          baseId: "kb_orchid",
          baseName: "Orchid Base",
          title: "Orchid memo",
          content: "The project codename is ORCHID-9137.",
          source: "orchid-note",
          score: 0.91,
          metadata: {}
        }]
      } as never
    }
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /ORCHID-9137/);
  assert.equal(result.content.includes("Fallback draft text"), false);
  assert.deepEqual(result.payload, { tool: "knowledge_base", entries: 1, sources: ["orchid-note"] });
});

test("passes selected knowledge bases to the local knowledge tool", async () => {
  let observedBaseIds: string[] | undefined;
  const result = await executeToolCall(
    {
      id: "call_knowledge_base_scope",
      type: "function",
      function: { name: "knowledge_base", arguments: JSON.stringify({ query: "codename", limit: 3, baseIds: ["kb_orchid"] }) }
    },
    {
      knowledgeService: {
        search: async (input: { baseIds?: string[] }) => {
          observedBaseIds = input.baseIds;
          return [];
        }
      } as never
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(observedBaseIds, ["kb_orchid"]);
  assert.match(result.content, /No local context/);
});

test("canvas_write normalizes replace unless the user explicitly asks to replace", async () => {
  const result = await executeToolCall(
    {
      id: "call_replace",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "replace",
          nodeKind: "document",
          title: "Draft",
          content: "Safer draft"
        })
      }
    },
    {
      selectedCanvasNodeId: "node_1",
      chatInstruction: "写入画板",
      createCanvasWriteRequest(input) {
        assert.equal(input.operation, "append");
        assert.equal(input.targetNodeId, "node_1");
        return {
          id: "write_replace",
          operation: input.operation,
          targetNodeId: input.targetNodeId,
          nodeKind: input.nodeKind ?? "document",
          title: input.title ?? "",
          status: "pending"
        };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.operation, "append");
});

test("canvas_write rejects malformed write arguments", async () => {
  const result = await executeToolCall(
    {
      id: "call_4",
      type: "function",
      function: { name: "canvas_write", arguments: JSON.stringify({ operation: "delete", content: "Nope" }) }
    },
    {
      createCanvasWriteRequest() {
        throw new Error("should not be called");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "invalid_operation");
});

test("plan_update creates a plan before approval and updates steps after approval", async () => {
  const calls: unknown[] = [];
  const created = await executeToolCall({ id: "plan", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "create", title: "Research", goal: "Compare", steps: [{ id: "search", title: "Search" }] }) } }, {
    allowedToolRefs: ["plan_update"], toolState: { plan_update: true },
    createPlanRun: (input) => (calls.push(input), { id: "plan_1", status: "awaiting_approval" })
  });
  assert.equal(created.ok, true);
  assert.equal(created.payload.eventType, "plan_created");
  assert.equal(calls.length, 1);
});

test("plan_update can pause a pending plan for clarification before approval", async () => {
  let nextStatus = "";
  const result = await executeToolCall({ id: "clarify", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "request_input", planId: "plan_1", message: "Which market?" }) } }, {
    allowedToolRefs: ["plan_update"], toolState: { plan_update: true },
    getPlanRun: () => ({ id: "plan_1", approval: "pending", status: "draft", steps: [] }) as never,
    setPlanStatus: (_planId, status) => { nextStatus = status; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "plan_waiting_for_user");
  assert.equal(nextStatus, "awaiting_user");
});

test("plan_update revises the same pending plan after clarification", async () => {
  let revisedPlanId = "";
  const result = await executeToolCall({ id: "revise", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "revise", planId: "plan_1", title: "Phone comparison", goal: "Compare in China", steps: [{ id: "sources", title: "Collect sources" }] }) } }, {
    allowedToolRefs: ["plan_update"], toolState: { plan_update: true },
    getPlanRun: () => ({ id: "plan_1", approval: "pending", status: "draft", steps: [] }) as never,
    revisePlanRun: (planId) => { revisedPlanId = planId; return { id: planId, status: "awaiting_approval" }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "plan_updated");
  assert.equal(revisedPlanId, "plan_1");
});

test("artifact_stage requires an approved plan", async () => {
  const result = await executeToolCall({ id: "artifact", type: "function", function: { name: "artifact_stage", arguments: JSON.stringify({ planId: "plan_1", artifactId: "summary", stepId: "search", type: "text", title: "Summary", payload: { content: "Result" } }) } }, {
    allowedToolRefs: ["artifact_stage"], toolState: { artifact_stage: true },
    getPlanRun: () => ({ id: "plan_1", approval: "pending", status: "awaiting_approval" }) as never,
    stagePlanArtifact: () => { throw new Error("must not stage"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "plan_not_approved");
});

test("plan_update refuses to finish while steps are incomplete", async () => {
  const result = await executeToolCall({ id: "finish", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "finish", planId: "plan_1" }) } }, {
    allowedToolRefs: ["plan_update"], toolState: { plan_update: true },
    getPlanRun: () => ({ id: "plan_1", approval: "approved", status: "running", steps: [{ status: "pending" }] }) as never,
    setPlanStatus: () => { throw new Error("must not finish"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "steps_incomplete");
});

test("plan_update cannot start a step outside the designated execution unit", async () => {
  const result = await executeToolCall({ id: "wrong-step", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "update_step", planId: "plan_1", stepId: "compare", status: "running" }) } }, {
    allowedToolRefs: ["plan_update"], toolState: { plan_update: true },
    contextValues: { planExecution: { planId: "plan_1", stepId: "sources" } },
    getPlanRun: () => ({ id: "plan_1", approval: "approved", status: "running", steps: [{ id: "sources", status: "pending" }, { id: "compare", status: "pending" }] }) as never,
    updatePlanStep: () => { throw new Error("must not update another step"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "wrong_execution_step");
});

test("artifact_stage accepts a batch of artifacts and links", async () => {
  const staged: string[] = [];
  const result = await executeToolCall({ id: "artifacts", type: "function", function: { name: "artifact_stage", arguments: JSON.stringify({
    planId: "plan_1",
    artifacts: [
      { artifactId: "source", stepId: "search", type: "text", title: "Source", payload: { content: "Source text", nodeKind: "reference" } },
      { artifactId: "summary", stepId: "search", type: "text", title: "Summary", payload: { content: "Summary text" } }
    ],
    links: [{ id: "link_1", fromArtifactId: "source", toArtifactId: "summary", label: "supports" }]
  }) } }, {
    allowedToolRefs: ["artifact_stage"], toolState: { artifact_stage: true },
    getPlanRun: () => ({ id: "plan_1", approval: "approved", status: "running", steps: [{ id: "search", status: "running" }] }) as never,
    stagePlanArtifact: (_planId, input) => (staged.push(input.artifactId), { id: input.artifactId, status: "committed" }),
    stagePlanArtifactLinks: (planRunId, links) => links.map((link) => ({ ...link, planRunId, label: typeof link.label === "string" ? link.label : "" }))
  });
  assert.equal(result.ok, true);
  assert.deepEqual(staged, ["source", "summary"]);
  assert.equal(result.payload.artifactCount, 2);
  assert.equal(result.payload.linkCount, 1);
});

test("artifact_stage keeps successful artifacts when one item fails", async () => {
  const result = await executeToolCall({ id: "partial", type: "function", function: { name: "artifact_stage", arguments: JSON.stringify({
    planId: "plan_1",
    artifacts: [
      { artifactId: "summary", stepId: "search", type: "text", title: "Summary", payload: { content: "Done" } },
      { artifactId: "broken-image", stepId: "search", type: "image", title: "Image", payload: { imageUrl: "https://example.com/broken.png" } }
    ]
  }) } }, {
    allowedToolRefs: ["artifact_stage"], toolState: { artifact_stage: true },
    getPlanRun: () => ({ id: "plan_1", approval: "approved", status: "running", steps: [{ id: "search", status: "running" }] }) as never,
    stagePlanArtifact: (_planId, input) => input.artifactId === "broken-image"
      ? Promise.reject(new Error("Image download failed"))
      : Promise.resolve({ id: input.artifactId, status: "committed" })
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.artifactCount, 2);
  assert.equal(result.payload.failedCount, 1);
  assert.deepEqual((result.payload.artifacts as Array<{ status: string }>).map((artifact) => artifact.status), ["committed", "failed"]);
});
