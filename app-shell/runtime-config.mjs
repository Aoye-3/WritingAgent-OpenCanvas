const supportedModes = new Set(["local", "docker", "external"]);

export function resolveRuntimeMode(env = process.env) {
  const mode = (env.AGENT_RUNTIME_MODE || "local").trim().toLowerCase();
  if (!supportedModes.has(mode)) {
    throw new Error(`AGENT_RUNTIME_MODE must be local, docker, or external; received ${env.AGENT_RUNTIME_MODE}`);
  }
  const defaultBaseUrl = mode === "docker" ? "http://127.0.0.1:2026" : "http://127.0.0.1:8001";
  return {
    mode,
    baseUrl: (env.AGENT_BACKEND_BASE_URL || defaultBaseUrl).replace(/\/+$/, ""),
    managed: mode !== "external",
  };
}
