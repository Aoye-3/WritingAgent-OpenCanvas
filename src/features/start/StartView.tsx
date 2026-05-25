import { brandAssets } from "../../shared/brandAssets";
import { Button } from "../../shared/ui";
import { useI18n } from "../i18n/I18nProvider";

type StartViewProps = {
  active: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
};

export function StartView({ active, onStart, onOpenSettings }: StartViewProps) {
  const { locale, setLocale } = useI18n();

  return (
    <main className={`view view-start ${active ? "is-active" : ""}`} aria-label="OpenCanvas start page">
      <header className="start-nav">
        <div className="start-brand">
          <img className="start-logo-art" src={brandAssets.openCanvasLockup} alt="OpenCanvas, FacetWrite architecture" />
        </div>
        <div className="start-actions">
          <Button type="button" onClick={onOpenSettings}>{locale === "zh" ? "项目设置" : "Settings"}</Button>
          <button className="language-switch" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
            <span className={locale === "en" ? "selected" : ""}>EN</span>
            <span className={locale === "zh" ? "selected" : ""}>中文</span>
          </button>
        </div>
      </header>

      <section className="start-hero">
        <div className="start-copy">
          <p className="eyebrow">{locale === "zh" ? "本地优先的 AI 画板工作台" : "Local-first AI canvas workspace"}</p>
          <h1>{locale === "zh" ? "把任务、节点和 AI 协作放进同一个开放画板。" : "Tasks, nodes, and AI collaboration in one open canvas."}</h1>
          <p className="subcopy">
            {locale === "zh"
              ? "OpenCanvas 将结构化输入、文档画板、上下文和 Agent Runtime 组合成一个本地优先的 AI 工作台。"
              : "OpenCanvas combines structured inputs, document canvases, context, and Agent Runtime into a local-first AI workspace."}
          </p>
          <div className="start-cta-row">
            <Button className="start-primary" data-testid="start-button" variant="primary" type="button" onClick={onStart}>Start</Button>
            <span>{locale === "zh" ? "当前是本地信息入口，后续可扩展登录与同步。" : "Information entry today, future login expansion later."}</span>
          </div>
        </div>

        <div className="start-preview" aria-hidden="true">
          <div className="preview-rail"><span /><span /><span /></div>
          <div className="preview-canvas">
            <div className="preview-card wide" />
            <div className="preview-card" />
            <div className="preview-line" />
            <div className="preview-line short" />
            <div className="preview-doc" />
          </div>
          <div className="preview-chat"><div /><div /><div /></div>
        </div>
      </section>
    </main>
  );
}
