import type { AgentBackendConfigOverview, AgentBackendRuntimeStatus } from "../types";

type AgentBackendRuntimePanelProps = {
  config: AgentBackendConfigOverview;
  status: AgentBackendRuntimeStatus;
};

export function AgentBackendRuntimePanel({ config, status }: AgentBackendRuntimePanelProps) {
  const rows = [
    ["Runtime", AgentBackendRuntimeLabel(status)],
    ["Auth", AgentBackendAuthLabel(status)],
    ["Base URL", status.baseUrl],
    ["Assistant", status.assistantId],
    ["Skills", String(config.skills.length)],
    ["MCP servers", Object.keys(config.mcpServers).join(", ") || "None"]
  ];

  return (
    <section className="settings-runtime-section" aria-label="AgentBackend runtime status">
      <div className="settings-runtime-heading">
        <div>
          <p className="eyebrow">Agent runtime</p>
          <h3>AgentBackend</h3>
        </div>
        <span className={status.enabled && status.reachable && status.authState === "authenticated" ? "runtime-pill is-online" : "runtime-pill"}>
          {AgentBackendRuntimeLabel(status)}
        </span>
      </div>
      <dl className="settings-status-list">
        {rows.map(([label, value]) => (
          <div className="settings-status-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {status.lastError || config.lastError ? (
        <p className="settings-message is-error">{status.lastError || config.lastError}</p>
      ) : null}
    </section>
  );
}

function AgentBackendRuntimeLabel(status: AgentBackendRuntimeStatus) {
  if (!status.enabled) return "TypeScript fallback";
  if (!status.reachable) return "AgentBackend unreachable";
  if (status.authState === "authenticated") return "AgentBackend online, authenticated";
  if (status.authState === "setup_required") return "AgentBackend online, setup required";
  if (status.authState === "auth_failed") return "AgentBackend online, auth failed";
  if (status.authState === "not_configured") return "AgentBackend online, auth required";
  return "AgentBackend online";
}

function AgentBackendAuthLabel(status: AgentBackendRuntimeStatus) {
  if (!status.enabled) return "Not used";
  if (!status.reachable) return "Unavailable";
  if (status.authState === "authenticated") return "Authenticated";
  if (status.authState === "setup_required") return "First-boot setup required";
  if (status.authState === "auth_failed") return "Authentication failed";
  return "Credentials not configured";
}
