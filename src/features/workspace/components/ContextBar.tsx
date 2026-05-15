import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

export function ContextBar({ promptPreview }: { promptPreview: string }) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="context-bar" aria-label="Context configuration" data-expanded={expanded}>
      <div className="context-collapsed">
        <div className="context-tabs" role="tablist" aria-label="Context tabs">
          <button className="context-tab active" type="button">{t("workspace.context")}</button>
          <button className="context-tab" type="button">{t("workspace.knowledge")}</button>
          <button className="context-tab" type="button">{t("workspace.references")}</button>
          <button className="context-tab" type="button">{t("app.previewPrompt")}</button>
        </div>
        <div className="context-summary">
          <span className="metadata-chip">{locale === "zh" ? "课程笔记" : "Course Notes"}</span>
          <span className="metadata-chip">{locale === "zh" ? "受众画像" : "Audience Profile"}</span>
          <span>{t("workspace.contextSummary")}</span>
        </div>
        <button className="button button-secondary button-small" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t("workspace.collapse") : t("workspace.expand")}
        </button>
      </div>

      <div className="context-expanded" aria-hidden={!expanded}>
        <section className="context-panel">
          <div>
            <p className="eyebrow">{t("workspace.context")}</p>
            <h2>{t("workspace.contextTitle")}</h2>
          </div>
          <div className="context-columns">
            <div className="context-card">
              <h3>{t("workspace.writingStyle")}</h3>
              <p>{locale === "zh" ? "友好、清晰，并适合中学生阅读。" : "Friendly, clear, and suitable for secondary school students."}</p>
            </div>
            <div className="context-card">
              <h3>{t("workspace.knowledgeSource")}</h3>
              <p>{locale === "zh" ? "课程笔记：气候与环境" : "Course Notes: Climate and Environment"}</p>
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
