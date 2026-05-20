import { useEffect, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { EmptyState, Panel, StatusBadge } from "../../shared/ui";
import { useI18n } from "../i18n/I18nProvider";
import { fetchAgentRuntimeDashboard } from "./agentRuntimeClient";
import type { AgentBackendDashboard, AgentBackendToolBridgeStatus } from "./types";

type AiDashboardViewProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
};

export function AiDashboardView({ activeView, onNavigate }: AiDashboardViewProps) {
  const { locale } = useI18n();
  const [dashboard, setDashboard] = useState<AgentBackendDashboard | null>(null);
  const [error, setError] = useState("");
  const mcpServers = useMemo(() => Object.entries(dashboard?.config.mcpServers ?? {}), [dashboard]);

  useEffect(() => {
    if (activeView !== "aiDashboard") return;
    fetchAgentRuntimeDashboard()
      .then((nextDashboard) => {
        setDashboard(nextDashboard);
        setError("");
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load AI dashboard");
      });
  }, [activeView]);

  return (
    <main className="view management-app ai-dashboard-app" data-active={activeView === "aiDashboard"}>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} className="management-sidebar" />
      <section className="management-main ai-dashboard-main">
        <div className="management-header">
          <div>
            <h1>{locale === "zh" ? "AI 仪表盘" : "AI Dashboard"}</h1>
            <p>{locale === "zh" ? "查看内置 Agent Runtime、MCP、Skills、Agent 映射和 ToolUse 桥接状态。" : "Internal Agent Runtime, MCP, Skills, Agent mapping, and ToolUse bridge status."}</p>
          </div>
          {dashboard ? <StatusPill dashboard={dashboard} /> : null}
        </div>

        {error ? <p className="settings-message is-error">{error}</p> : null}
        {!dashboard && !error ? <EmptyState className="empty-management-state" title={locale === "zh" ? "正在读取 AI runtime 状态..." : "Loading AI runtime status..."} /> : null}

        {dashboard ? (
          <>
            <section className="ai-dashboard-grid" aria-label="Runtime status">
              <Metric label="Runtime" value={runtimeLabel(dashboard)} tone={dashboard.runtime.reachable ? "success" : "neutral"} />
              <Metric label="Auth" value={dashboard.runtime.authState} tone={dashboard.runtime.authState === "authenticated" ? "success" : "warning"} />
              <Metric label="Lead Agent" value={dashboard.leadAgent.assistantId} />
              <Metric label="Base URL" value={dashboard.runtime.baseUrl} />
            </section>

            <Panel className="ai-dashboard-section">
              <div className="ai-section-header">
                <h2>Agent Runtime capabilities</h2>
                <span>{dashboard.config.skills.length} Skills / {mcpServers.length} MCP</span>
              </div>
              <div className="ai-capability-grid">
                <CapabilityList title="Skills" items={dashboard.config.skills.map(readName).filter(Boolean)} />
                <CapabilityList title="MCP servers" items={mcpServers.map(([name, value]) => `${name}${readEnabled(value)}`)} />
              </div>
            </Panel>

            <Panel className="ai-dashboard-section">
              <div className="ai-section-header">
                <h2>Agent runtime mapping</h2>
                <span>{dashboard.agentMappings.length} subagents</span>
              </div>
              <div className="ai-mapping-table">
                <div className="ai-mapping-head">
                  <span>FacetWrite Agent</span>
                  <span>Runtime subagent</span>
                  <span>Skills</span>
                  <span>Tools</span>
                  <span>Status</span>
                </div>
                {dashboard.agentMappings.map((mapping) => (
                  <article className="ai-mapping-row" key={mapping.agentCardId}>
                    <div>
                      <strong>{mapping.title}</strong>
                      <small>{mapping.agentCardId}</small>
                    </div>
                    <div>
                      <strong>{mapping.subagent.name}</strong>
                      <small>{mapping.subagent.model} / {mapping.subagent.maxTurns} turns / {mapping.subagent.timeoutSeconds}s</small>
                    </div>
                    <ChipLine values={mapping.subagent.skills} />
                    <ChipLine values={mapping.subagent.tools} />
                    <BridgePill state={mapping.contractState === "fallback_only" ? "pending_bridge" : "mapped_metadata"} label={mapping.contractState === "fallback_only" ? "Fallback" : "Mapped"} />
                  </article>
                ))}
              </div>
            </Panel>

            <Panel className="ai-dashboard-section">
              <div className="ai-section-header">
                <h2>ToolUse bridge</h2>
                <span>{dashboard.toolBridgeStatus.length} capabilities</span>
              </div>
              <div className="ai-tool-grid">
                {dashboard.toolBridgeStatus.map((tool) => <ToolBridgeCard key={tool.name} tool={tool} />)}
              </div>
            </Panel>

            <Panel className="ai-dashboard-section">
              <div className="ai-section-header">
                <h2>Integration maturity</h2>
                <span>{dashboard.integrationMaturity.filter((item) => item.state !== "pending").length}/{dashboard.integrationMaturity.length}</span>
              </div>
              <div className="ai-maturity-grid">
                {dashboard.integrationMaturity.map((item) => (
                  <article className="ai-maturity-item" key={item.label}>
                    <BridgePill state={item.state === "pending" ? "pending_bridge" : "mapped_metadata"} label={item.state} />
                    <strong>{item.label}</strong>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </Panel>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "success" | "warning" | "neutral" }) {
  return (
    <Panel as="article" className={`ai-metric ai-metric-${tone === "success" ? "online" : tone === "warning" ? "warn" : "neutral"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </Panel>
  );
}

function StatusPill({ dashboard }: { dashboard: AgentBackendDashboard }) {
  return <StatusBadge tone={dashboard.runtime.reachable && dashboard.runtime.authState === "authenticated" ? "success" : "neutral"}>{runtimeLabel(dashboard)}</StatusBadge>;
}

function runtimeLabel(dashboard: AgentBackendDashboard) {
  if (!dashboard.runtime.enabled) return "TypeScript fallback";
  if (!dashboard.runtime.reachable) return "Agent Runtime unreachable";
  if (dashboard.runtime.authState === "authenticated") return "Agent Runtime online";
  return dashboard.runtime.authState;
}

function CapabilityList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="ai-capability-list">
      <h3>{title}</h3>
      <div className="ai-chip-list">
        {items.length ? items.slice(0, 16).map((item) => <span className="ai-chip" key={item}>{item}</span>) : <span className="ai-muted">None</span>}
      </div>
    </article>
  );
}

function ChipLine({ values }: { values: string[] }) {
  return <div className="ai-chip-line">{values.length ? values.map((value) => <span className="ai-chip" key={value}>{value}</span>) : <span className="ai-muted">None</span>}</div>;
}

function ToolBridgeCard({ tool }: { tool: AgentBackendToolBridgeStatus }) {
  return (
    <article className="ai-tool-card">
      <div>
        <strong>{tool.label}</strong>
        <small>{tool.name}</small>
      </div>
      <BridgePill state={tool.bridgeState} />
      <p>{tool.target}</p>
      <small>{tool.approvalBoundary ?? tool.executionBoundary}</small>
    </article>
  );
}

type BridgePillState = AgentBackendToolBridgeStatus["bridgeState"] | "mapped_metadata";

function BridgePill({ state, label }: { state: BridgePillState; label?: string }) {
  const text = label ?? (state === "mapped_metadata" ? "Mapped" : state === "agent_backend_builtin" ? "Built-in" : state === "facetwrite_bridge" ? "FacetWrite bridge" : state === "pending_bridge" ? "Pending bridge" : "Control plane");
  return <span className={`ai-bridge-pill ai-bridge-${state}`}>{text}</span>;
}

function readName(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { name?: unknown; id?: unknown };
    return typeof record.name === "string" ? record.name : typeof record.id === "string" ? record.id : "";
  }
  return "";
}

function readEnabled(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const enabled = (value as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? ` (${enabled ? "enabled" : "disabled"})` : "";
}
