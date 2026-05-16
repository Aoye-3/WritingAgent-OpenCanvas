import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

export function WorkspaceUtilityBar({ promptPreview }: { promptPreview: string }) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="context-bar" aria-label="Workspace utility bar" data-expanded={expanded}>
      <div className="context-collapsed">
        <div className="context-tabs" role="tablist" aria-label="Workspace utility tabs">
          <button className="context-tab active" type="button">{locale === "zh" ? "工作区" : "Workspace"}</button>
          <button className="context-tab" type="button">{locale === "zh" ? "版本" : "Versions"}</button>
          <button className="context-tab" type="button">{locale === "zh" ? "资源" : "Assets"}</button>
          <button className="context-tab" type="button">{t("app.previewPrompt")}</button>
        </div>
        <div className="context-summary">
          <span className="metadata-chip">{locale === "zh" ? "后续功能区" : "Future tools"}</span>
          <span>{locale === "zh" ? "左侧 AgentCard 输入会参与 Agent 运行" : "Left AgentCard inputs guide the Agent run"}</span>
        </div>
        <button className="button button-secondary button-small" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t("workspace.collapse") : t("workspace.expand")}
        </button>
      </div>

      <div className="context-expanded" aria-hidden={!expanded}>
        <section className="context-panel">
          <div>
            <p className="eyebrow">{locale === "zh" ? "工作区栏" : "Workspace bar"}</p>
            <h2>{locale === "zh" ? "后续功能与 Prompt 预览" : "Future tools and prompt preview"}</h2>
          </div>
          <div className="context-columns">
            <div className="context-card">
              <h3>{locale === "zh" ? "功能预留" : "Reserved area"}</h3>
              <p>{locale === "zh" ? "这里不再注入运行信息，后续可承载版本、资源或协作工具。" : "This bar no longer injects runtime inputs. It can host versions, assets, or collaboration tools later."}</p>
            </div>
            <div className="context-card">
              <h3>{locale === "zh" ? "输入来源" : "Input source"}</h3>
              <p>{locale === "zh" ? "Agent 运行读取左侧 AgentCard 的结构化输入和当前画板状态。" : "Agent runs read the left AgentCard structured inputs and current canvas state."}</p>
            </div>
            <div className="context-card prompt-card">
              <h3>{t("workspace.generatedPrompt")}</h3>
              <pre>{promptPreview}</pre>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
