import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";
import { getDeerFlowAuthStatus, type DeerFlowAuthState } from "./auth.js";

export type DeerFlowRuntimeStatus = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  reachable: boolean;
  runtimeProvider: "deerflow" | "typescript";
  authState: DeerFlowAuthState;
  lastError?: string;
};

export async function getDeerFlowRuntimeStatus(input: {
  config?: DeerFlowRuntimeConfig;
  fetchImpl?: typeof fetch;
} = {}): Promise<DeerFlowRuntimeStatus> {
  const config = input.config ?? getDeerFlowRuntimeConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: false,
      runtimeProvider: "typescript",
      authState: "not_configured"
    };
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(`${config.baseUrl}/health`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`DeerFlow health returned HTTP ${response.status}`);
    }
    const auth = await getDeerFlowAuthStatus({ config, fetchImpl: input.fetchImpl });
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: true,
      runtimeProvider: "deerflow",
      authState: auth.authState,
      lastError: auth.lastError
    };
  } catch (error) {
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: false,
      runtimeProvider: "deerflow",
      authState: "auth_failed",
      lastError: error instanceof Error ? error.message : "Unable to reach DeerFlow"
    };
  }
}
