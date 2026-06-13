import type { TaskDefinition } from "./types";

export const taskDefinitions: TaskDefinition[] = [
  {
    id: "chat-agent",
    category: "chat",
    accent: "blue",
    icon: "bot",
    i18nTitle: { en: "ChatAgent", zh: "ChatAgent" },
    i18nDescription: {
      en: "A neutral base Agent for prompts, tools, knowledge, memory, and MCP selections.",
      zh: "A neutral base Agent for prompts, tools, knowledge, memory, and MCP selections."
    },
    defaultValues: {},
    fields: []
  }
];
