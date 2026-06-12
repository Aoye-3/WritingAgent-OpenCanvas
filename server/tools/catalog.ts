import type { ChatCompletionTool } from "../providerRuntime.js";

export type ToolRef = "web_search" | "knowledge_base" | "quick_messages" | "clear_context" | "canvas_write" | "plan_update" | "artifact_stage";
export type ToolState = Partial<Record<ToolRef, boolean>>;
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolGroup = "web" | "context" | "chat";

export type ToolDefinition = {
  name: ToolRef;
  group: ToolGroup;
  label: string;
  description: string;
  promptHint: string;
  schema: Record<string, unknown>;
  executorKind: "local" | "external";
  enabledByDefault: boolean;
  requiresExternalConfig: boolean;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
};

export const toolCatalog: ToolDefinition[] = [
  {
    name: "web_search",
    group: "web",
    label: "Web Search",
    description: "Search the web for current information when an external search provider is configured.",
    promptHint: "The user has enabled web search intent. If live browsing is unavailable, clearly state that no live web lookup was performed.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"],
      additionalProperties: false
    },
    executorKind: "external",
    enabledByDefault: false,
    requiresExternalConfig: true,
    riskLevel: "medium",
    requiresApproval: false
  },
  {
    name: "knowledge_base",
    group: "context",
    label: "Knowledge Base",
    description: "Read local context and knowledge hints already available in the current workspace.",
    promptHint: "Use the selected knowledge/context notes as reference material and avoid inventing unsupported source claims.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to retrieve from local context" },
        limit: { type: "integer", description: "Maximum number of context entries to return" },
        baseIds: {
          type: "array",
          description: "Optional Knowledge Base ids to search",
          items: { type: "string" }
        }
      },
      required: ["query", "limit"],
      additionalProperties: false
    },
    executorKind: "local",
    enabledByDefault: true,
    requiresExternalConfig: false,
    riskLevel: "low",
    requiresApproval: false
  },
  {
    name: "quick_messages",
    group: "chat",
    label: "Quick Messages",
    description: "Normalize a quick editing instruction for the current draft.",
    promptHint: "The user may be applying a quick instruction. Treat it as an editing or generation command scoped to the current draft.",
    schema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The quick edit instruction" }
      },
      required: ["instruction"],
      additionalProperties: false
    },
    executorKind: "local",
    enabledByDefault: true,
    requiresExternalConfig: false,
    riskLevel: "low",
    requiresApproval: false
  },
  {
    name: "clear_context",
    group: "context",
    label: "Clear Context",
    description: "Confirm that previous conversation context should be ignored for this run.",
    promptHint: "Ignore previous conversational context for this run unless it appears in the current structured inputs.",
    schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why previous context should be ignored" }
      },
      required: ["reason"],
      additionalProperties: false
    },
    executorKind: "local",
    enabledByDefault: true,
    requiresExternalConfig: false,
    riskLevel: "low",
    requiresApproval: false
  },
  {
    name: "plan_update",
    group: "chat",
    label: "Plan Update",
    description: "Create and update a persistent multi-step task plan. Creating a plan pauses for user approval.",
    promptHint: "For /plan work, create a concise ordered plan first. Do not execute steps until the plan is approved.",
    schema: { type: "object", properties: {
      action: { type: "string", enum: ["create", "revise", "update_step", "request_input", "finish", "fail"] },
      planId: { type: "string" }, stepId: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, detail: { type: "string" }, error: { type: "string" }, message: { type: "string" },
      status: { type: "string", enum: ["pending", "running", "completed", "failed", "skipped"] },
      steps: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, detail: { type: "string" } }, required: ["id", "title"], additionalProperties: false } }
    }, required: ["action"], additionalProperties: false },
    executorKind: "local", enabledByDefault: false, requiresExternalConfig: false, riskLevel: "low", requiresApproval: false
  },
  {
    name: "artifact_stage",
    group: "chat",
    label: "Stage Plan Artifact",
    description: "Stage a text or web-image artifact selected by the Agent for the approved plan.",
    promptHint: "Stage only durable task outputs, not conversational replies. Use stable artifact ids for retries.",
    schema: { type: "object", properties: {
      planId: { type: "string" },
      artifacts: { type: "array", items: { type: "object", properties: { artifactId: { type: "string" }, stepId: { type: "string" }, type: { type: "string", enum: ["text", "image"] }, title: { type: "string" }, payload: { type: "object" }, source: { type: "object" }, layout: { type: "object" } }, required: ["artifactId", "stepId", "type", "title", "payload"], additionalProperties: false } },
      links: { type: "array", items: { type: "object", properties: { id: { type: "string" }, fromArtifactId: { type: "string" }, toArtifactId: { type: "string" }, label: { type: "string" } }, required: ["id", "fromArtifactId", "toArtifactId"], additionalProperties: false } }
    }, required: ["planId", "artifacts"], additionalProperties: false },
    executorKind: "local", enabledByDefault: false, requiresExternalConfig: false, riskLevel: "low", requiresApproval: false
  },
  {
    name: "canvas_write",
    group: "chat",
    label: "Canvas Write Proposal",
    description: "Propose content to write to the user's Canvas. The application will ask the user to confirm before applying the change.",
    promptHint: "Use canvas_write to propose a Canvas write when the user asks to save or when the response is useful for Canvas. Never claim the Canvas was changed until the user confirms the proposal.",
    schema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "replace", "append"], description: "The requested Canvas write operation" },
        nodeKind: { type: "string", enum: ["document", "note", "reference"], description: "Node type for created content or fallback target type" },
        targetNodeId: { type: "string", description: "Existing Canvas node id for replace or append. Omit to use the currently selected node when available." },
        title: { type: "string", description: "Short title for the node or write request" },
        content: { type: "string", description: "The exact Markdown/plain text content to write" },
        rationale: { type: "string", description: "Brief explanation of why this write is useful" }
      },
      required: ["operation", "content"],
      additionalProperties: false
    },
    executorKind: "local",
    enabledByDefault: true,
    requiresExternalConfig: false,
    riskLevel: "high",
    requiresApproval: true
  }
];

export function getToolDefinition(name: string) {
  return toolCatalog.find((tool) => tool.name === name);
}

export function allowedToolDefinitions(toolRefs: string[]) {
  const allowed = new Set(toolRefs);
  return toolCatalog.filter((tool) => allowed.has(tool.name));
}

export function toChatCompletionTool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema
    }
  };
}
