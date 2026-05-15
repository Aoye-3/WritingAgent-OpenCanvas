import type { Locale } from "../promptBuilder.js";
import { getProviderProfile } from "../providerRuntime.js";

export function getProviderId() {
  return getProviderProfile(process.env.OPENAI_PROVIDER_ID?.trim()).id;
}

export function getBaseURL(providerId = getProviderId()) {
  const configuredProviderId = getProviderId();
  const configuredBaseURL = process.env.OPENAI_BASE_URL?.trim();
  if (configuredBaseURL && configuredProviderId === providerId) {
    return configuredBaseURL;
  }

  return getProviderProfile(providerId).defaultBaseURL;
}

export function getModel(providerId = getProviderId()) {
  const configuredProviderId = getProviderId();
  const configuredModel = process.env.OPENAI_MODEL?.trim();
  if (configuredModel && configuredProviderId === providerId) {
    return configuredModel;
  }

  return getProviderProfile(providerId).defaultModel;
}

export function getSystemPrompt(locale: Locale = "en") {
  const configured = process.env.AGENT_SYSTEM_PROMPT?.trim();
  if (configured) return configured;

  return locale === "zh"
    ? "你是 FacetWrite 的文本 Agent。请结合 AgentCard、Skill、结构化输入、上下文与工具状态，生成清晰、可编辑、可协作的文本。"
    : "You are FacetWrite's text agent. Use the AgentCard, Skill, structured inputs, context, and tool state to produce clear, editable, collaborative text.";
}
