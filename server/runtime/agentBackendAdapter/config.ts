export type AgentBackendRuntimeConfig = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  auth?: AgentBackendAuthConfig;
};

export type AgentBackendAuthConfig = {
  email?: string;
  password?: string;
  autoSetup: boolean;
  timeoutMs: number;
};

export function getAgentBackendRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentBackendRuntimeConfig {
  return {
    enabled: readBoolean(env.AGENT_BACKEND_ENABLED),
    baseUrl: (env.AGENT_BACKEND_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
    assistantId: env.AGENT_BACKEND_ASSISTANT_ID?.trim() || "lead_agent",
    auth: {
      email: env.AGENT_BACKEND_AUTH_EMAIL?.trim() || undefined,
      password: env.AGENT_BACKEND_AUTH_PASSWORD?.trim() || undefined,
      autoSetup: readBoolean(env.AGENT_BACKEND_AUTO_SETUP),
      timeoutMs: readPositiveInteger(env.AGENT_BACKEND_AUTH_TIMEOUT_MS, 5000)
    }
  };
}

function readBoolean(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
