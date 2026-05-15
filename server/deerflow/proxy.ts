import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";

export type DeerFlowConfigOverview = {
  enabled: boolean;
  baseUrl: string;
  skills: unknown[];
  mcpServers: Record<string, unknown>;
  lastError?: string;
};

const secretKeyPattern = /(key|token|secret|password|credential|authorization|cookie)/i;

export async function getDeerFlowConfigOverview(input: {
  config?: DeerFlowRuntimeConfig;
  fetchImpl?: typeof fetch;
} = {}): Promise<DeerFlowConfigOverview> {
  const config = input.config ?? getDeerFlowRuntimeConfig();
  if (!config.enabled) {
    return { enabled: false, baseUrl: config.baseUrl, skills: [], mcpServers: {} };
  }

  try {
    const fetcher = input.fetchImpl ?? fetch;
    const [skills, mcpConfig] = await Promise.all([
      readJson(fetcher, `${config.baseUrl}/api/skills`),
      readJson(fetcher, `${config.baseUrl}/api/mcp/config`)
    ]);

    return {
      enabled: true,
      baseUrl: config.baseUrl,
      skills: normalizeSkills(skills),
      mcpServers: sanitizeMcpServers(mcpConfig)
    };
  } catch (error) {
    return {
      enabled: true,
      baseUrl: config.baseUrl,
      skills: [],
      mcpServers: {},
      lastError: error instanceof Error ? error.message : "Unable to read DeerFlow configuration"
    };
  }
}

async function readJson(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`DeerFlow config request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function normalizeSkills(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const skills = value.skills ?? value.data;
    if (Array.isArray(skills)) return skills;
  }
  return [];
}

function sanitizeMcpServers(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const rawServers = value.mcp_servers ?? value.mcpServers;
  if (!isRecord(rawServers)) return {};
  return Object.fromEntries(Object.entries(rawServers).map(([name, server]) => [name, sanitizeValue(server)]));
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (secretKeyPattern.test(key)) return [key, "[redacted]"];
      return [key, sanitizeValue(entry)];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
