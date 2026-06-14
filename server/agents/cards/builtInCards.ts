import type { AgentCard } from "../types.js";
import { agentIdentityPrompts } from "../prompts.js";

export const builtInAgentCards: AgentCard[] = [
  {
    id: "chat-agent",
    category: "chat",
    accent: "blue",
    icon: "bot",
    title: { en: "ChatAgent", zh: "ChatAgent" },
    description: {
      en: "A neutral base Agent for conversation, prompts, tools, Knowledge, Memory, and MCP selections.",
      zh: "中性的基础 Agent，用于对话、提示词、工具、知识库、记忆和 MCP 选择。"
    },
    identityPrompt: agentIdentityPrompts.chatAgent,
    skillRefs: [],
    toolRefs: ["web_search", "knowledge_base", "clear_context", "canvas_write"],
    outputContract: { type: "chat", defaultFormat: "markdown" }
  }
];
