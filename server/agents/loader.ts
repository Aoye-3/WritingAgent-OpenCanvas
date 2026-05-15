import { builtInAgentCards } from "./cards/builtInCards.js";
import type { AgentCard, AgentSettings } from "./types.js";

export const agentCards: AgentCard[] = builtInAgentCards;

export function getAgentCard(agentCardId?: string) {
  return agentCards.find((card) => card.id === agentCardId) ?? agentCards[0];
}

export function applyAgentSettings(card: AgentCard, settings: AgentSettings): AgentCard {
  const enabledTools = card.toolRefs.filter((tool) => settings.tools[tool] !== false);
  return {
    ...card,
    title: {
      ...card.title,
      en: settings.prompt.name || card.title.en
    },
    description: {
      ...card.description,
      en: settings.prompt.description || card.description.en
    },
    identityPrompt: settings.prompt.identityPrompt || card.identityPrompt,
    skillRefs: settings.prompt.skillRefs.length > 0 ? settings.prompt.skillRefs : card.skillRefs,
    toolRefs: enabledTools.length > 0 ? enabledTools : card.toolRefs,
    outputContract: {
      type: settings.prompt.outputType || card.outputContract.type,
      defaultFormat: settings.prompt.outputFormat || card.outputContract.defaultFormat
    },
    settings
  };
}
