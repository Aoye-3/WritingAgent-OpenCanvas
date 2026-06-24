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

test("canvas_write does not degrade low-risk creates into pending proposals", async () => {
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
      createCanvasWriteRequest() {
        throw new Error("low-risk writes must not create proposals");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.eventType, "canvas_mutation_failed");
  assert.equal(result.payload.reason, "direct_commit_unavailable");
  assert.match(result.content, /cannot commit low-risk writes directly/i);
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
      commitCanvasWrite(input) {
        assert.equal(input.operation, "append");
        assert.equal(input.targetNodeId, "node_1");
        return { id: "node_1", projectId: "project_1", kind: "document", title: "Draft" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.operation, "append");
  assert.equal(result.payload.status, "committed");
});

test("canvas_write keeps delete operations pending for approval", async () => {
  const result = await executeToolCall(
    {
      id: "call_4",
      type: "function",
      function: { name: "canvas_write", arguments: JSON.stringify({ operation: "delete", targetNodeId: "node_1" }) }
    },
    {
      createCanvasWriteRequest(input) {
        assert.equal(input.operation, "delete");
        assert.equal(input.targetNodeId, "node_1");
        return { id: "write_delete", operation: "delete", targetNodeId: "node_1", nodeKind: "document", title: "Delete node", status: "pending" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "canvas_write_pending_approval");
});

test("canvas_write commits low-risk create operations and returns the real node id", async () => {
  const result = await executeToolCall(
    {
      id: "call_commit",
      type: "function",
      function: { name: "canvas_write", arguments: JSON.stringify({ operation: "create", title: "Identity", content: "Assistant identity" }) }
    },
    {
      commitCanvasWrite(input) {
        assert.equal(input.operation, "create");
        return { id: "node_identity", projectId: "project_1", kind: "document", title: "Identity" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "canvas_mutation_committed");
  assert.equal(result.payload.nodeId, "node_identity");
  assert.equal(result.payload.status, "committed");
});

test("canvas_write commits short progressive summary nodes with a stable node id", async () => {
  const result = await executeToolCall(
    {
      id: "call_short_progress",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "create",
          nodeKind: "document",
          title: "Overview",
          content: "# Overview\n- Key finding\n- Next step"
        })
      }
    },
    {
      threadId: "thread_short_progress",
      contextValues: { facetwrite_canvas_write_scope: "short_progress_nodes" },
      commitCanvasWrite(input, options) {
        assert.equal(input.operation, "create");
        assert.equal(input.nodeKind, "document");
        assert.match(options?.shortProgressStableNodeId ?? "", /^node_short_progress_thread_short_progress_/);
        return { id: options?.shortProgressStableNodeId ?? "node_overview", projectId: "project_1", kind: "document", title: input.title ?? "Overview" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "canvas_mutation_committed");
});

test("canvas_write rejects oversized progressive short nodes", async () => {
  const result = await executeToolCall(
    {
      id: "call_short_progress_long",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "create",
          nodeKind: "document",
          title: "Summary",
          content: "Long paragraph. ".repeat(220)
        })
      }
    },
    {
      threadId: "thread_short_progress",
      contextValues: { facetwrite_canvas_write_scope: "short_progress_nodes" },
      commitCanvasWrite() {
        throw new Error("oversized short node must not commit");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "short_progress_content_too_long");
  assert.match(result.content, /write_file/i);
});

test("canvas_write rejects body or full-report titles in progressive short scope", async () => {
  for (const title of ["Body", "Final body", "完整报告"]) {
    const result = await executeToolCall(
      {
        id: `call_reject_${title}`,
        type: "function",
        function: {
          name: "canvas_write",
          arguments: JSON.stringify({
            operation: "create",
            nodeKind: "document",
            title,
            content: "# Summary\nShort text"
          })
        }
      },
      {
        threadId: "thread_short_progress",
        contextValues: { facetwrite_canvas_write_scope: "short_progress_nodes" },
        commitCanvasWrite() {
          throw new Error("long-form title must not commit");
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.payload.reason, "short_progress_long_form_title");
    assert.match(result.content, /present_files/i);
  }
});

test("canvas_write rejects file_document node kind in progressive short scope", async () => {
  const result = await executeToolCall(
    {
      id: "call_file_document",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "create",
          nodeKind: "file_document",
          title: "Document file",
          content: "File entry"
        })
      }
    },
    {
      threadId: "thread_short_progress",
      contextValues: { facetwrite_canvas_write_scope: "short_progress_nodes" },
      commitCanvasWrite() {
        throw new Error("file_document must not commit through canvas_write");
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "short_progress_node_kind_not_allowed");
});

test("canvas_write committed payload includes sources extracted from content", async () => {
  const result = await executeToolCall(
    {
      id: "call_sources",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "create",
          title: "References",
          content: [
            "| Paper | Link |",
            "|---|---|",
            "| Agent survey | [2503.21460](https://arxiv.org/abs/2503.21460) |"
          ].join("\n")
        })
      }
    },
    {
      commitCanvasWrite(input) {
        assert.equal(input.operation, "create");
        return { id: "node_references", projectId: "project_1", kind: "document", title: input.title ?? "References" };
      }
    }
  );

  assert.deepEqual(result.payload.sources, [{ title: "2503.21460", url: "https://arxiv.org/abs/2503.21460" }]);
});

test("canvas_write creates a new node when append has no target", async () => {
  const result = await executeToolCall(
    {
      id: "call_append_without_target",
      type: "function",
      function: {
        name: "canvas_write",
        arguments: JSON.stringify({
          operation: "append",
          title: "Appendix: Search Methodology",
          content: "## Appendix\nSearch criteria."
        })
      }
    },
    {
      commitCanvasWrite(input) {
        assert.equal(input.operation, "create");
        assert.equal(input.targetNodeId, undefined);
        assert.equal(input.title, "Appendix: Search Methodology");
        assert.equal(input.content, "## Appendix\nSearch criteria.");
        return { id: "node_append_as_create", projectId: "project_1", kind: "document", title: input.title ?? "Appendix: Search Methodology" };
      },
      createCanvasWriteRequest() {
        throw new Error("append without target must not create a proposal");
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.operation, "create");
  assert.equal(result.payload.requestedOperation, "append");
  assert.equal(result.payload.status, "committed");
});

test("canvas_write uses the server-recognized operation instead of the model-selected operation", async () => {
  const result = await executeToolCall(
    {
      id: "call_authoritative_action",
      type: "function",
      function: { name: "canvas_write", arguments: JSON.stringify({ operation: "create", content: "Replacement" }) }
    },
    {
      canvasAction: { operation: "replace", targetNodeId: "node_1" },
      createCanvasWriteRequest(input) {
        assert.equal(input.operation, "replace");
        assert.equal(input.targetNodeId, "node_1");
        return { id: "write_replace", operation: "replace", targetNodeId: "node_1", nodeKind: "document", title: "", status: "pending" };
      },
      commitCanvasWrite() {
        throw new Error("high-risk replacement must not commit directly");
      }
    }
  );

  assert.equal(result.payload.eventType, "canvas_write_pending_approval");
  assert.equal(result.payload.status, "pending");
});

test("plan_clarification_submit updates only the server-created intake Plan", async () => {
  let submittedPlanId = "";
  const result = await executeToolCall({ id: "intake-contract", type: "function", function: {
    name: "plan_clarification_submit",
    arguments: JSON.stringify({
      title: "Clarify laptop purchase",
      goal: "Choose the primary purchase priority",
      question: "What matters most?",
      options: [
        { id: "value", label: "Best value", description: "Balance price and performance", recommended: true },
        { id: "power", label: "Maximum power", description: "Prefer performance", recommended: false }
      ]
    })
  } }, {
    allowedToolRefs: ["plan_clarification_submit"],
    toolState: { plan_clarification_submit: true },
    contextValues: { planGeneration: { planId: "plan_intake" } },
    submitPlanClarification: (planId) => {
      submittedPlanId = planId;
      return { id: "plan_intake", status: "awaiting_user" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "plan_waiting_for_user");
  assert.equal(submittedPlanId, "plan_intake");
});

test("plan_clarification_submit rejects missing or multiple recommendations", async () => {
  for (const recommendations of [[false, false], [true, true]]) {
    const result = await executeToolCall({ id: "invalid-intake-contract", type: "function", function: {
      name: "plan_clarification_submit",
      arguments: JSON.stringify({
        title: "Clarify laptop purchase",
        goal: "Choose the primary purchase priority",
        question: "What matters most?",
        options: [
          { id: "value", label: "Best value", description: "Balance price and performance", recommended: recommendations[0] },
          { id: "power", label: "Maximum power", description: "Prefer performance", recommended: recommendations[1] }
        ]
      })
    } }, {
      allowedToolRefs: ["plan_clarification_submit"],
      toolState: { plan_clarification_submit: true },
      contextValues: { planGeneration: { planId: "plan_intake" } },
      submitPlanClarification: () => { throw new Error("invalid clarification must not persist"); }
    });

    assert.equal(result.ok, false);
    assert.equal(result.payload.reason, "invalid_clarification");
    assert.equal(result.payload.planId, "plan_intake");
  }
});

test("plan_revision_submit revises only the specified pending Plan", async () => {
  let revisedPlanId = "";
  const result = await executeToolCall({ id: "revision-contract", type: "function", function: {
    name: "plan_revision_submit",
    arguments: JSON.stringify({
      planId: "plan_1",
      title: "Laptop comparison",
      goal: "Choose a laptop",
      steps: [{ id: "compare", title: "Compare models" }]
    })
  } }, {
    allowedToolRefs: ["plan_revision_submit"],
    toolState: { plan_revision_submit: true },
    getPlanRun: () => ({ id: "plan_1", approval: "pending", status: "draft", steps: [] }) as never,
    revisePlanRun: (planId) => {
      revisedPlanId = planId;
      return { id: planId, status: "awaiting_approval" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.eventType, "plan_updated");
  assert.equal(revisedPlanId, "plan_1");
});

test("removed plan_update cannot mutate Plan state through Tool Runtime", async () => {
  const result = await executeToolCall(
    { id: "retired-plan-tool", type: "function", function: { name: "plan_update", arguments: JSON.stringify({ action: "finish", planId: "plan_1" }) } },
    {
      allowedToolRefs: ["plan_update"],
      setPlanStatus: () => { throw new Error("retired tool must not mutate Plan state"); }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "policy_denied");
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
