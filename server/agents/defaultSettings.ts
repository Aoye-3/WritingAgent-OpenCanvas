import type { ToolRef } from "../tools/catalog.js";
import type { AgentCard, AgentSettings } from "./types.js";

export function defaultAgentSettings(card: AgentCard): AgentSettings {
  return {
    model: {
      providerId: "deepseek",
      model: "",
      responseMode: "normal",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "function",
      maxToolCalls: 20
    },
    prompt: {
      name: card.title.en,
      description: card.description.en,
      identityPrompt: card.identityPrompt,
      outputType: card.outputContract.type,
      outputFormat: card.outputContract.defaultFormat,
      skillRefs: [...card.skillRefs]
    },
    tools: Object.fromEntries(card.toolRefs.map((tool) => [tool, true])) as Partial<Record<ToolRef, boolean>>,
    knowledge: {
      enabled: card.toolRefs.includes("knowledge_base"),
      scope: "current_workspace",
      baseIds: [],
      documentCount: 6,
      threshold: 0.2,
      rerankEnabled: true
    },
    memory: {
      enabled: false
    },
    quickMessages: [
      "Make this clearer.",
      "Shorten the current draft.",
      "Rewrite in a more professional tone."
    ]
  };
}
