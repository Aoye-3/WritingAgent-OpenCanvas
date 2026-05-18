import { useState } from "react";
import { Button, Panel, TabButton, Tabs } from "../../../shared/ui";
import { useI18n } from "../../i18n/I18nProvider";

export function WorkspaceUtilityBar({ promptPreview }: { promptPreview: string }) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="context-bar" aria-label="Workspace utility bar" data-expanded={expanded}>
      <div className="context-collapsed">
        <Tabs className="context-tabs" ariaLabel="Workspace utility tabs">
          <TabButton active className="context-tab">{locale === "zh" ? "工作区" : "Workspace"}</TabButton>
          <TabButton className="context-tab">{locale === "zh" ? "版本" : "Versions"}</TabButton>
          <TabButton className="context-tab">{locale === "zh" ? "资源" : "Assets"}</TabButton>
          <TabButton className="context-tab">{t("app.previewPrompt")}</TabButton>
        </Tabs>
        <div className="context-summary">
          <span className="metadata-chip ui-status-badge">{locale === "zh" ? "后续功能区" : "Future tools"}</span>
          <span>{locale === "zh" ? "左侧 AgentCard 输入会参与 Agent 运行" : "Left AgentCard inputs guide the Agent run"}</span>
        </div>
        <Button size="sm" variant="secondary" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t("workspace.collapse") : t("workspace.expand")}
        </Button>
      </div>

      <div className="context-expanded" aria-hidden={!expanded}>
        <section className="context-panel">
          <div>
            <p className="eyebrow">{locale === "zh" ? "工作区栏" : "Workspace bar"}</p>
            <h2>{locale === "zh" ? "后续功能与 Prompt 预览" : "Future tools and prompt preview"}</h2>
          </div>
          <div className="context-columns">
            <Panel className="context-card">
              <h3>{locale === "zh" ? "功能预留" : "Reserved area"}</h3>
              <p>{locale === "zh" ? "这里不再注入运行信息，后续可承载版本、资源或协作工具。" : "This bar no longer injects runtime inputs. It can host versions, assets, or collaboration tools later."}</p>
            </Panel>
            <Panel className="context-card">
              <h3>{locale === "zh" ? "输入来源" : "Input source"}</h3>
              <p>{locale === "zh" ? "Agent 运行读取左侧 AgentCard 的结构化输入和当前画板状态。" : "Agent runs read the left AgentCard structured inputs and current canvas state."}</p>
            </Panel>
            <Panel className="context-card prompt-card">
              <h3>{t("workspace.generatedPrompt")}</h3>
              <pre>{promptPreview}</pre>
            </Panel>
          </div>
        </section>
      </div>
    </aside>
  );
}
