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
