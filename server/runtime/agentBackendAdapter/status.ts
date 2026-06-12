import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "./config.js";
import { getAgentBackendAuthStatus, type AgentBackendAuthState } from "./auth.js";

export type AgentBackendRuntimeStatus = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  reachable: boolean;
  runtimeProvider: "agent-backend" | "typescript";
  authState: AgentBackendAuthState;
  deploymentMode: "local" | "docker" | "external";
  sandboxProvider: string;
  lastError?: string;
};

export async function getAgentBackendRuntimeStatus(input: {
  config?: AgentBackendRuntimeConfig;
  fetchImpl?: typeof fetch;
} = {}): Promise<AgentBackendRuntimeStatus> {
  const config = input.config ?? getAgentBackendRuntimeConfig();
  const deploymentMode = config.deploymentMode ?? "local";
  const sandboxProvider = config.sandboxProvider ?? "deerflow.sandbox.local:LocalSandboxProvider";
  if (!config.enabled) {
    return {
      enabled: false,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: false,
      runtimeProvider: "typescript",
      authState: "not_configured",
      deploymentMode,
      sandboxProvider
    };
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(`${config.baseUrl}/health`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`AgentBackend health returned HTTP ${response.status}`);
    }
    const auth = await getAgentBackendAuthStatus({ config, fetchImpl: input.fetchImpl });
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: true,
      runtimeProvider: "agent-backend",
      authState: auth.authState,
      deploymentMode,
      sandboxProvider,
      lastError: auth.lastError
    };
  } catch (error) {
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: false,
      runtimeProvider: "agent-backend",
      authState: "auth_failed",
      deploymentMode,
      sandboxProvider,
      lastError: error instanceof Error ? error.message : "Unable to reach AgentBackend"
    };
  }
}
