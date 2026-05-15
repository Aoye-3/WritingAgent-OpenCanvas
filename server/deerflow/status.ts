import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";

export type DeerFlowRuntimeStatus = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  reachable: boolean;
  runtimeProvider: "deerflow" | "typescript";
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
      runtimeProvider: "typescript"
    };
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(`${config.baseUrl}/health`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`DeerFlow health returned HTTP ${response.status}`);
    }
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: true,
      runtimeProvider: "deerflow"
    };
  } catch (error) {
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      assistantId: config.assistantId,
      reachable: false,
      runtimeProvider: "deerflow",
      lastError: error instanceof Error ? error.message : "Unable to reach DeerFlow"
    };
  }
}
