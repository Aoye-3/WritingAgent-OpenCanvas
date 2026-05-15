import type { DeerFlowConfigOverview, DeerFlowRuntimeStatus } from "../types";

type DeerFlowRuntimePanelProps = {
  config: DeerFlowConfigOverview;
  status: DeerFlowRuntimeStatus;
};

export function DeerFlowRuntimePanel({ config, status }: DeerFlowRuntimePanelProps) {
  const rows = [
    ["Runtime", deerFlowRuntimeLabel(status)],
    ["Auth", deerFlowAuthLabel(status)],
    ["Base URL", status.baseUrl],
    ["Assistant", status.assistantId],
    ["Skills", String(config.skills.length)],
    ["MCP servers", Object.keys(config.mcpServers).join(", ") || "None"]
  ];

  return (
    <section className="settings-runtime-section" aria-label="DeerFlow runtime status">
      <div className="settings-runtime-heading">
        <div>
          <p className="eyebrow">Agent runtime</p>
          <h3>DeerFlow</h3>
        </div>
        <span className={status.enabled && status.reachable && status.authState === "authenticated" ? "runtime-pill is-online" : "runtime-pill"}>
          {deerFlowRuntimeLabel(status)}
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

function deerFlowRuntimeLabel(status: DeerFlowRuntimeStatus) {
  if (!status.enabled) return "TypeScript fallback";
  if (!status.reachable) return "DeerFlow unreachable";
  if (status.authState === "authenticated") return "DeerFlow online, authenticated";
  if (status.authState === "setup_required") return "DeerFlow online, setup required";
  if (status.authState === "auth_failed") return "DeerFlow online, auth failed";
  if (status.authState === "not_configured") return "DeerFlow online, auth required";
  return "DeerFlow online";
}

function deerFlowAuthLabel(status: DeerFlowRuntimeStatus) {
  if (!status.enabled) return "Not used";
  if (!status.reachable) return "Unavailable";
  if (status.authState === "authenticated") return "Authenticated";
  if (status.authState === "setup_required") return "First-boot setup required";
  if (status.authState === "auth_failed") return "Authentication failed";
  return "Credentials not configured";
}
