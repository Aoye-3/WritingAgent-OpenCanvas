const supportedModes = new Set(["local", "docker", "external"]);

export function resolveRuntimeMode(env = process.env) {
  const mode = (env.AGENT_RUNTIME_MODE || "local").trim().toLowerCase();
  if (!supportedModes.has(mode)) {
    throw new Error(`AGENT_RUNTIME_MODE must be local, docker, or external; received ${env.AGENT_RUNTIME_MODE}`);
  }
  const configuredBaseUrl = cleanUrl(env.AGENT_BACKEND_BASE_URL);
  if (mode === "external" && !configuredBaseUrl) {
    throw new Error("AGENT_BACKEND_BASE_URL is required when AGENT_RUNTIME_MODE=external.");
  }
  return {
    mode,
    baseUrl: configuredBaseUrl ?? defaultBaseUrl(mode, env),
    managed: mode !== "external",
  };
}

function defaultBaseUrl(mode, env) {
  if (mode === "docker") return "http://127.0.0.1:2026";
  const port = readPort(env.AGENT_RUNTIME_PORT);
  return port ? `http://127.0.0.1:${port}` : undefined;
}

function cleanUrl(value) {
  const url = value?.trim();
  return url ? url.replace(/\/+$/, "") : undefined;
}

function readPort(value) {
  if (!value) return undefined;
  const port = Number(value);
  if (port === 0) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`AGENT_RUNTIME_PORT must be a TCP port between 1 and 65535; received ${value}`);
  }
  return port;
}
