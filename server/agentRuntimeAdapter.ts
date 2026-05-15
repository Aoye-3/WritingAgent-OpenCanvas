import { agentCards, applyAgentSettings, defaultAgentSettings, getAgentCard, type AgentSettings } from "./agentCards.js";
import { buildAgentRuntimeConfig, normalizeAgentSettings } from "./services/agentDefinitionService.js";
import type { SQLiteStorageRepository } from "./storage.js";

export class AgentRuntimeAdapter {
  constructor(private storage: SQLiteStorageRepository) {}

  listAgentCards() {
    return agentCards.map((card) => this.resolveAgentCard(card.id));
  }

  resolveAgentCard(agentCardId?: string) {
    const card = getAgentCard(agentCardId);
    const settings = this.getAgentSettings(card.id);
    return applyAgentSettings(card, settings);
  }

  getAgentSettings(agentCardId: string) {
    const card = getAgentCard(agentCardId);
    const saved = this.storage.getAgentSettings(card.id);
    return normalizeAgentSettings(defaultAgentSettings(card), saved, card.toolRefs);
  }

  async getAgentRuntimeConfig(agentCardId: string) {
    const card = getAgentCard(agentCardId);
    const settings = this.getAgentSettings(card.id);
    return buildAgentRuntimeConfig(applyAgentSettings(card, settings), settings);
  }

  saveAgentSettings(agentCardId: string, settings: Partial<AgentSettings> | undefined) {
    const card = getAgentCard(agentCardId);
    const merged = normalizeAgentSettings(defaultAgentSettings(card), settings, card.toolRefs);
    this.storage.saveAgentSettings(card.id, merged);
    return merged;
  }
}

export function createAgentRuntimeAdapter(storage: SQLiteStorageRepository) {
  return new AgentRuntimeAdapter(storage);
}
