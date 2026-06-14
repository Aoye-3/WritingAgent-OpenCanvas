import type { AgentCard, AgentSettings } from "../agentCards.js";
import { loadPublicSkills } from "../skillLoader.js";
import { buildToolPolicies, type ToolPolicy } from "../tools/policies.js";
import {
  allowedToolDefinitions,
  getToolDefinition,
  toolCatalog,
  type ToolDefinition,
  type ToolRef,
  type ToolState
} from "../tools/catalog.js";

export type PublicToolDefinition = Pick<
  ToolDefinition,
  "name" | "group" | "label" | "description" | "riskLevel" | "requiresApproval" | "enabledByDefault" | "requiresExternalConfig"
>;

export type SkillCatalogItem = {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  status: "available";
};

export type AgentRuntimeConfig = {
  agentCard: AgentCard;
  settings: AgentSettings;
  availableTools: PublicToolDefinition[];
  enabledTools: ToolRef[];
  toolPolicies: ToolPolicy[];
  missingToolRefs: string[];
  deprecatedToolRefs: string[];
  availableSkills: SkillCatalogItem[];
  missingSkillRefs: string[];
};

export function getToolCatalog(): PublicToolDefinition[] {
  return toolCatalog.map(toPublicToolDefinition);
}

export async function getSkillCatalog(): Promise<SkillCatalogItem[]> {
  const skills = await loadPublicSkills();
  return skills.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    allowedTools: skill.allowedTools,
    status: "available"
  }));
}

export function normalizeAgentSettings(
  base: AgentSettings,
  saved: Partial<AgentSettings> | undefined,
  allowedToolRefs: string[]
): AgentSettings {
  const merged: AgentSettings = {
    prompt: {
      ...base.prompt,
      ...saved?.prompt,
      skillRefs: saved?.prompt?.skillRefs?.length ? saved.prompt.skillRefs : base.prompt.skillRefs
    },
    tools: normalizeTools(base.tools, saved?.tools, allowedToolRefs),
    knowledge: { ...base.knowledge, ...saved?.knowledge },
    memory: { ...base.memory, ...saved?.memory },
    mcpRefs: Array.isArray(saved?.mcpRefs) ? saved.mcpRefs.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : base.mcpRefs
  };

  return merged;
}

export async function buildAgentRuntimeConfig(card: AgentCard, settings: AgentSettings): Promise<AgentRuntimeConfig> {
  const availableSkills = await getSkillCatalog();
  const availableSkillIds = new Set(availableSkills.map((skill) => skill.id));
  const missingToolRefs = card.toolRefs.filter((tool) => !getToolDefinition(tool));
  const availableTools = allowedToolDefinitions(card.toolRefs).map(toPublicToolDefinition);
  const allowedToolNames = new Set(availableTools.map((tool) => tool.name));
  const enabledTools = availableTools
    .filter((tool) => settings.tools[tool.name] !== false)
    .map((tool) => tool.name);
  const deprecatedToolRefs = Object.keys(settings.tools).filter((tool) => !allowedToolNames.has(tool as ToolRef) || !getToolDefinition(tool));
  const missingSkillRefs = settings.prompt.skillRefs.filter((skillRef) => !availableSkillIds.has(skillRef));

  return {
    agentCard: card,
    settings,
    availableTools,
    enabledTools,
    toolPolicies: buildToolPolicies(card.toolRefs, settings.tools),
    missingToolRefs,
    deprecatedToolRefs,
    availableSkills,
    missingSkillRefs
  };
}

function normalizeTools(
  baseTools: ToolState,
  savedTools: Partial<Record<string, boolean>> | undefined,
  allowedToolRefs: string[]
): ToolState {
  const normalized: ToolState = {};
  for (const tool of allowedToolDefinitions(allowedToolRefs)) {
    normalized[tool.name] = savedTools?.[tool.name] ?? baseTools[tool.name] ?? tool.enabledByDefault;
  }
  return normalized;
}

function toPublicToolDefinition(tool: ToolDefinition): PublicToolDefinition {
  return {
    name: tool.name,
    group: tool.group,
    label: tool.label,
    description: tool.description,
    riskLevel: tool.riskLevel,
    requiresApproval: tool.requiresApproval,
    enabledByDefault: tool.enabledByDefault,
    requiresExternalConfig: tool.requiresExternalConfig
  };
}
