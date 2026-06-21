import type { AgentCard } from "./agentCards.js";
import type { Skill } from "./skillLoader.js";
import type { ProjectBrief, TaskBrief } from "./storageTypes.js";
import { enabledToolHints, type ToolState } from "./toolRegistry.js";
import type { CanvasDeliveryContract } from "./services/generation/canvasDeliveryContent.js";

export type Locale = "en" | "zh";

export type PromptBuildInput = {
  agentCard: AgentCard;
  skills: Skill[];
  locale: Locale;
  projectBrief?: ProjectBrief;
  taskBrief?: TaskBrief;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  freeTextPrompt?: string;
  toolState?: ToolState;
  canvasDeliveryContract?: CanvasDeliveryContract;
};

export function buildAgentPrompt(input: PromptBuildInput) {
  const title = input.agentCard.title[input.locale];
  const projectBrief = formatBrief(input.projectBrief, projectBriefLabels);
  const taskBrief = formatBrief(input.taskBrief, taskBriefLabels);
  const context = formatRecord(input.contextValues);
  const skillText = input.skills.map(formatSkill).join("\n\n");
  const tools = enabledToolHints(input.agentCard.toolRefs, input.toolState);
  const output = input.agentCard.outputContract;
  const instruction = input.chatInstruction?.trim() || input.freeTextPrompt?.trim();
  const settings = input.agentCard.settings;

  return compactLines([
    `# AgentCard`,
    `Agent: ${title}`,
    `Capability: ${input.agentCard.description[input.locale]}`,
    `Identity: ${input.agentCard.identityPrompt}`,
    "",
    skillText ? `# Loaded Skills\n${skillText}` : "",
    projectBrief ? `# Project Brief\n${projectBrief}` : "",
    taskBrief ? `# Current Task Brief\n${taskBrief}` : "",
    projectBrief && taskBrief ? "When the Current Task Brief conflicts with the Project Brief, follow the Current Task Brief for this request." : "",
    context ? `# Context\n${context}` : "",
    settings?.knowledge.enabled ? `# Knowledge Scope\n${settings.knowledge.scope}` : "",
    settings?.memory.enabled ? "# Memory State\nGlobal memory is enabled for this Agent, but this local MVP only uses memory hints explicitly included in the current prompt context." : "",
    tools.length ? `# Enabled Tool State\n${tools.join("\n")}` : "",
    instruction ? `# Current User Instruction\n${instruction}` : "",
    input.canvasDeliveryContract ? `# Canvas Delivery Contract\n${formatCanvasDeliveryContract(input.canvasDeliveryContract)}` : "",
    `# Output Contract\nReturn ${output.type} content in ${output.defaultFormat}. Be direct, useful, and editable in a document canvas.`
  ]);
}

function formatCanvasDeliveryContract(contract: CanvasDeliveryContract) {
  const localeHint = contract.locale === "zh" ? "Use Chinese field content unless source titles are already in another language." : "Use English field content unless source titles are already in another language.";
  const preferredDiagramKind = contract.preferredMode === "mind_map"
    ? "mindmap"
    : contract.preferredMode === "user_flow"
      ? "userflow"
      : contract.preferredMode === "freeform_diagram"
        ? "freeform"
        : "";
  return [
    "The user explicitly requested a Canvas delivery. Prepare durable Canvas content separately from the conversational reply.",
    preferredDiagramKind
      ? `Current Canvas mode prefers editable diagram delivery. Use facetwrite_diagram_delivery with kind "${preferredDiagramKind}" unless the user explicitly asks for ordinary document batches.`
      : "Current Canvas mode prefers ordinary batch delivery unless the user explicitly asks for a mind map, user flow, flowchart, diagram, or free graphic nodes.",
    "For ordinary document batches, return a short user-facing completion reply, then append exactly one fenced block:",
    "```facetwrite_canvas_delivery",
    JSON.stringify({
      facetwrite_canvas_delivery: {
        assistant_reply: "short completion reply for the chat bubble",
        outline_markdown: "# Summary or rough zones\n- zone 1\n- zone 2",
        body_markdown: "durable body content for editable Canvas document nodes",
        sources: [{ title: "source title", url: "https://example.com" }]
      }
    }, null, 2),
    "```",
    "For mind maps, user flows, flowcharts, diagrams, or free graphic nodes, use this fenced block instead:",
    "```facetwrite_diagram_delivery",
    JSON.stringify({
      facetwrite_diagram_delivery: {
        assistant_reply: "short completion reply for the chat bubble",
        kind: "mindmap",
        title: "Diagram title",
        layout: "tree",
        nodes: [
          { id: "root", label: "Main topic", shape: "rounded", tone: "primary" },
          { id: "decision", label: "Decision", shape: "diamond", tone: "warning", parentId: "root" }
        ],
        edges: [{ from: "root", to: "decision", label: "next", kind: "next" }],
        sources: [{ title: "source title", url: "https://example.com" }]
      }
    }, null, 2),
    "```",
    "Diagram kind must be one of mindmap, userflow, flowchart, freeform. Layout must be one of radial, tree, left-right, freeform.",
    "Diagram nodes must use stable ids and labels. Optional shapes: rounded, rect, diamond, parallelogram, circle, database, document. Optional tones: primary, success, warning, danger, neutral.",
    "The fenced block is not a reasoning trace. Include only final deliverable content and usable source links.",
    "Do not include hidden reasoning, prompts, messages, raw tool JSON, or chain-of-thought.",
    localeHint
  ].join("\n");
}

const projectBriefLabels: Record<keyof ProjectBrief, string> = {
  goal: "Project goal",
  audience: "Target audience",
  background: "Background and known facts",
  standingConstraints: "Standing constraints and expression principles"
};

const taskBriefLabels: Record<keyof TaskBrief, string> = {
  objective: "Task objective",
  deliverableType: "Expected deliverable",
  deliverableDetails: "Deliverable supplemental details",
  mustCover: "Must cover",
  temporaryConstraints: "Temporary constraints and supplemental requirements"
};

function formatBrief<T extends Record<string, unknown>>(brief: T | undefined, labels: Record<keyof T, string>) {
  if (!brief) return "";
  return Object.entries(labels)
    .map(([key, label]) => {
      const formatted = readValue(brief[key]);
      return formatted ? `- ${label}: ${formatted}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatSkill(skill: Skill) {
  return compactLines([
    `## ${skill.name}`,
    skill.description,
    skill.allowedTools.length ? `Allowed FacetWrite tools: ${skill.allowedTools.join(", ")}` : "",
    skill.metadata.executionMode === "sandbox" ? "Execution mode: Agent Runtime sandbox only." : "",
    skill.metadata.runtimeTools.length ? `Runtime sandbox tools: ${skill.metadata.runtimeTools.join(", ")}` : "",
    skill.metadata.requiresEnv.length ? `Required environment variables: ${skill.metadata.requiresEnv.join(", ")}` : "",
    skill.content
  ]);
}

function formatRecord(record: Record<string, unknown> | undefined) {
  if (!record) return "";
  return Object.entries(record)
    .map(([key, value]) => {
      const formatted = readValue(value);
      return formatted ? `- ${key}: ${formatted}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function readValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function compactLines(lines: string[]) {
  return lines.filter((line) => line.trim().length > 0).join("\n");
}
