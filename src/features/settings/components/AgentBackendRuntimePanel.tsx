import type { AgentBackendConfigOverview, AgentBackendRuntimeStatus } from "../types";

type AgentBackendRuntimePanelProps = {
  config: AgentBackendConfigOverview;
  status: AgentBackendRuntimeStatus;
};

export function AgentBackendRuntimePanel({ config, status }: AgentBackendRuntimePanelProps) {
  const rows = [
    ["Runtime", AgentBackendRuntimeLabel(status)],
    ["Auth", AgentBackendAuthLabel(status)],
    ["Deployment", status.deploymentMode],
    ["Sandbox", status.sandboxProvider],
    ["Base URL", status.baseUrl],
    ["Assistant", status.assistantId],
    ["Skills", String(config.skills.length)],
    ["MCP servers", Object.keys(config.mcpServers).join(", ") || "None"]
  ];

  return (
    <section className="settings-runtime-section" aria-label="Agent Runtime status">
      <div className="settings-runtime-heading">
        <div>
          <p className="eyebrow">Agent runtime</p>
          <h3>Agent Runtime</h3>
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
  if (!status.reachable) return "Agent Runtime unreachable";
  if (status.authState === "authenticated") return "Agent Runtime online, authenticated";
  if (status.authState === "setup_required") return "Agent Runtime online, setup required";
  if (status.authState === "auth_failed") return "Agent Runtime online, auth failed";
  if (status.authState === "not_configured") return "Agent Runtime online, auth required";
  return "Agent Runtime online";
}

function AgentBackendAuthLabel(status: AgentBackendRuntimeStatus) {
  if (!status.enabled) return "Not used";
  if (!status.reachable) return "Unavailable";
  if (status.authState === "authenticated") return "Authenticated";
  if (status.authState === "setup_required") return "First-boot setup required";
  if (status.authState === "auth_failed") return "Authentication failed";
  return "Credentials not configured";
}
