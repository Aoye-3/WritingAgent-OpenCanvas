export type DeerFlowRuntimeConfig = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
};

export function getDeerFlowRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DeerFlowRuntimeConfig {
  return {
    enabled: readBoolean(env.DEERFLOW_ENABLED),
    baseUrl: (env.DEERFLOW_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
    assistantId: env.DEERFLOW_ASSISTANT_ID?.trim() || "lead_agent"
  };
}

function readBoolean(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}
