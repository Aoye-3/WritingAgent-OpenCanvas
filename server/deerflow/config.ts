export type DeerFlowRuntimeConfig = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  auth?: DeerFlowAuthConfig;
};

export type DeerFlowAuthConfig = {
  email?: string;
  password?: string;
  autoSetup: boolean;
  timeoutMs: number;
};

export function getDeerFlowRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DeerFlowRuntimeConfig {
  return {
    enabled: readBoolean(env.DEERFLOW_ENABLED),
    baseUrl: (env.DEERFLOW_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
    assistantId: env.DEERFLOW_ASSISTANT_ID?.trim() || "lead_agent",
    auth: {
      email: env.DEERFLOW_AUTH_EMAIL?.trim() || undefined,
      password: env.DEERFLOW_AUTH_PASSWORD?.trim() || undefined,
      autoSetup: readBoolean(env.DEERFLOW_AUTO_SETUP),
      timeoutMs: readPositiveInteger(env.DEERFLOW_AUTH_TIMEOUT_MS, 5000)
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
