export type AgentBackendRuntimeConfig = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  deploymentMode?: AgentRuntimeDeploymentMode;
  sandboxProvider?: string;
  auth?: AgentBackendAuthConfig;
};

export type AgentRuntimeDeploymentMode = "local" | "docker" | "external";

const localSandboxProvider = "deerflow.sandbox.local:LocalSandboxProvider";

export type AgentBackendAuthConfig = {
  email?: string;
  password?: string;
  autoSetup: boolean;
  timeoutMs: number;
};

export function getAgentBackendRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentBackendRuntimeConfig {
  const deploymentMode = readDeploymentMode(env.AGENT_RUNTIME_MODE);
  return {
    enabled: readBoolean(env.AGENT_BACKEND_ENABLED),
    baseUrl: (env.AGENT_BACKEND_BASE_URL ?? defaultBaseUrl(deploymentMode)).replace(/\/+$/, ""),
    assistantId: env.AGENT_BACKEND_ASSISTANT_ID?.trim() || "lead_agent",
    deploymentMode,
    sandboxProvider: env.AGENT_RUNTIME_SANDBOX_PROVIDER?.trim() || localSandboxProvider,
    auth: {
      email: env.AGENT_BACKEND_AUTH_EMAIL?.trim() || undefined,
      password: env.AGENT_BACKEND_AUTH_PASSWORD?.trim() || undefined,
      autoSetup: readBoolean(env.AGENT_BACKEND_AUTO_SETUP),
      timeoutMs: readPositiveInteger(env.AGENT_BACKEND_AUTH_TIMEOUT_MS, 5000)
    }
  };
}

function readDeploymentMode(value: string | undefined): AgentRuntimeDeploymentMode {
  const mode = value?.trim().toLowerCase() || "local";
  if (mode === "local" || mode === "docker" || mode === "external") return mode;
  throw new Error(`AGENT_RUNTIME_MODE must be local, docker, or external; received ${value}`);
}

function defaultBaseUrl(mode: AgentRuntimeDeploymentMode) {
  return mode === "docker" ? "http://127.0.0.1:2026" : "http://127.0.0.1:8001";
}

function readBoolean(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
