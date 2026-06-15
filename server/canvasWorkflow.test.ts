import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptCanvasWorkflowSuggestion,
  buildCanvasWorkflowContext,
  createCanvasWorkflowSuggestion,
  defaultCanvasWorkflow,
  findConnectedWorkflowRoles,
  nextCanvasWorkflowNodeMetadata,
  readWorkflowRoleMetadata,
  updateCanvasWorkflowStage
} from "../shared/canvasWorkflow.js";

test("canvas workflow defaults to the inspiration stage with built-in roles", () => {
  const workflow = defaultCanvasWorkflow();

  assert.equal(workflow.mode, "batch_delivery");
  assert.equal(workflow.stage, "inspiration");
  assert.deepEqual(workflow.stages, ["inspiration", "research", "structure", "writing", "polish", "publish"]);
  assert.equal(workflow.roles[0].id, "structure");
});

test("new node metadata inherits the current workflow stage", () => {
  const metadata = nextCanvasWorkflowNodeMetadata({ stage: "structure" }, { canvasLayout: { sizeMode: "manual" } });

  assert.deepEqual(metadata, {
    canvasLayout: { sizeMode: "manual" },
    workflow: { stage: "structure" }
  });
});

test("workflow role metadata is read from a role node", () => {
  const metadata = readWorkflowRoleMetadata({
    workflowRole: { roleId: "evidence", label: "Evidence", prompt: "Check sources.", description: "Fact lens" }
  });

  assert.deepEqual(metadata, { roleId: "evidence", label: "Evidence", prompt: "Check sources.", description: "Fact lens" });
});

test("suggestions move from pending to accepted and append to node content", () => {
  const suggestion = createCanvasWorkflowSuggestion({
    roleNodeId: "role_1",
    targetNodeId: "node_1",
    roleId: "style",
    content: "Make the argument more direct.",
    rationale: "The current paragraph is indirect."
  });
  const accepted = acceptCanvasWorkflowSuggestion(suggestion);

  assert.equal(suggestion.status, "pending");
  assert.equal(accepted.status, "accepted");
  assert.match(accepted.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("workflow roles only apply through Role to content edges", () => {
  const nodes = [
    { id: "role_evidence", kind: "role", metadata: { workflowRole: { roleId: "evidence", label: "Evidence", prompt: "Check sources." } } },
    { id: "role_style", kind: "role", metadata: { workflowRole: { roleId: "style", label: "Style", prompt: "Improve wording." } } },
    { id: "draft", kind: "document", metadata: { workflow: { stage: "research" } } },
    { id: "other", kind: "document", metadata: { workflow: { stage: "research" } } }
  ];
  const edges = [
    { sourceNodeId: "role_evidence", targetNodeId: "draft" },
    { sourceNodeId: "draft", targetNodeId: "role_style" },
    { sourceNodeId: "role_style", targetNodeId: "other" }
  ];

  const roles = findConnectedWorkflowRoles({ nodes, edges, targetNodeIds: ["draft"] });

  assert.deepEqual(roles.map((role) => role.roleId), ["evidence"]);
  assert.deepEqual(roles.map((role) => role.prompt), ["Check sources."]);
});

test("workflow context filters by chain, stage, and connected role nodes without reading every node", () => {
  const workflow = updateCanvasWorkflowStage(defaultCanvasWorkflow(), "research");
  const nodes = [
    { id: "role_evidence", kind: "role", title: "Evidence", content: "", metadata: { workflowRole: { roleId: "evidence", label: "Evidence", prompt: "Check sources." } } },
    { id: "brief", kind: "document", title: "Brief", content: "Goal", metadata: { workflow: { stage: "inspiration" } } },
    { id: "source", kind: "reference", title: "Source", content: "Evidence", metadata: { workflow: { stage: "research" } } },
    { id: "draft", kind: "document", title: "Draft", content: "Draft text", metadata: { workflow: { stage: "writing" } } }
  ];
  const edges = [
    { sourceNodeId: "role_evidence", targetNodeId: "source" },
    { sourceNodeId: "source", targetNodeId: "role_evidence" }
  ];

  const context = buildCanvasWorkflowContext({
    workflow,
    nodes,
    edges,
    chainNodeIds: ["brief", "source"],
    stage: "research"
  });

  assert.deepEqual(context.nodes.map((node) => node.id), ["source"]);
  assert.equal(context.stage, "research");
  assert.deepEqual(context.roles.map((role) => role.roleId), ["evidence"]);
});
