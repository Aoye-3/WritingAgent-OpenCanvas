import type { AgentCard } from "./agentCards.js";
import type { Skill } from "./skillLoader.js";
import type { ProjectBrief, TaskBrief } from "./storageTypes.js";
import { enabledToolHints, type ToolState } from "./toolRegistry.js";

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
  const quickMessages = settings?.quickMessages?.length ? settings.quickMessages.map((message) => `- ${message}`).join("\n") : "";

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
    quickMessages ? `# Agent Quick Messages\n${quickMessages}` : "",
    tools.length ? `# Enabled Tool State\n${tools.join("\n")}` : "",
    instruction ? `# Current User Instruction\n${instruction}` : "",
    `# Output Contract\nReturn ${output.type} content in ${output.defaultFormat}. Be direct, useful, and editable in a document canvas.`
  ]);
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
    skill.allowedTools.length ? `Allowed tools: ${skill.allowedTools.join(", ")}` : "",
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
