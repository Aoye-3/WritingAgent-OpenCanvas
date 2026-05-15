import type { AgentCard, AgentSettings } from "../agentCards.js";
import { toolCatalog, type ToolRef } from "../tools/catalog.js";

export type DeerFlowSubagentConfig = {
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolRef[];
  skills: string[];
  model: "inherit";
  maxTurns: number;
  timeoutSeconds: number;
};

const subagentNames: Record<string, string> = {
  "blog-post": "facetwrite-blog-writer",
  summary: "facetwrite-summary",
  "email-writer": "facetwrite-email-writer",
  "lesson-plan": "facetwrite-lesson-planner",
  "report-outline": "facetwrite-report-outliner",
  "rewrite-polish": "facetwrite-rewrite-polisher"
};

export function buildDeerFlowSubagentConfig(card: AgentCard, settings?: AgentSettings): DeerFlowSubagentConfig {
  const enabledTools = effectiveTools(card, settings);
  return {
    name: subagentNames[card.id] ?? `facetwrite-${card.id}`,
    description: card.description.en,
    systemPrompt: settings?.prompt.identityPrompt || card.identityPrompt,
    tools: enabledTools,
    skills: settings?.prompt.skillRefs.length ? settings.prompt.skillRefs : card.skillRefs,
    model: "inherit",
    maxTurns: 8,
    timeoutSeconds: 120
  };
}

export function buildDeerFlowRuntimeMetadata(card: AgentCard, settings?: AgentSettings) {
  return {
    source: "facetwrite",
    agentCardId: card.id,
    subagent: buildDeerFlowSubagentConfig(card, settings)
  };
}

function effectiveTools(card: AgentCard, settings?: AgentSettings) {
  const allowed = new Set(card.toolRefs);
  const knownTools = new Set(toolCatalog.map((tool) => tool.name));
  const tools = card.toolRefs.filter((tool) => {
    if (!knownTools.has(tool)) return false;
    return settings?.tools[tool] !== false;
  });
  return tools.filter((tool) => allowed.has(tool));
}
