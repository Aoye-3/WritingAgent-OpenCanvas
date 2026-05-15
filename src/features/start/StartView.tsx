import { BrandIcon } from "../../shared/icons";
import { useI18n } from "../i18n/I18nProvider";

type StartViewProps = {
  active: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
};

export function StartView({ active, onStart, onOpenSettings }: StartViewProps) {
  const { locale, setLocale } = useI18n();

  return (
    <main className={`view view-start ${active ? "is-active" : ""}`} aria-label="FacetWrite start page">
      <header className="start-nav">
        <div className="start-brand">
          <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
          <span>FacetWrite</span>
        </div>
        <div className="start-actions">
          <button className="button button-secondary" type="button" onClick={onOpenSettings}>
            {locale === "zh" ? "项目设置" : "Settings"}
          </button>
          <button className="language-switch" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
            <span className={locale === "en" ? "selected" : ""}>EN</span>
            <span className={locale === "zh" ? "selected" : ""}>中文</span>
          </button>
        </div>
      </header>

      <section className="start-hero">
        <div className="start-copy">
          <p className="eyebrow">{locale === "zh" ? "本地优先的文本 Agent 工作台" : "Local-first text agent workspace"}</p>
          <h1>{locale === "zh" ? "把任务卡、结构化输入和 AI 协作放进同一个写作界面。" : "Agent cards, structured inputs, and AI collaboration in one writing surface."}</h1>
          <p className="subcopy">
            {locale === "zh"
              ? "FacetWrite 将 Prompt 构建、文档画布、上下文和右侧协作聊天组合成一个分层式工作台，为后续接入 Deerflow 风格 Agent 能力打好基础。"
              : "FacetWrite combines prompt construction, a document canvas, context controls, and a collaboration drawer into a layered workspace ready for Deerflow-inspired agent capabilities."}
          </p>
          <div className="start-cta-row">
            <button className="button button-primary start-primary" type="button" onClick={onStart}>
              {locale === "zh" ? "Start" : "Start"}
            </button>
            <span>{locale === "zh" ? "当前为前端信息入口，预留未来登录扩展。" : "Information entry today, future login expansion later."}</span>
          </div>
        </div>

        <div className="start-preview" aria-hidden="true">
          <div className="preview-rail">
            <span />
            <span />
            <span />
          </div>
          <div className="preview-canvas">
            <div className="preview-card wide" />
            <div className="preview-card" />
            <div className="preview-line" />
            <div className="preview-line short" />
            <div className="preview-doc" />
          </div>
          <div className="preview-chat">
            <div />
            <div />
            <div />
          </div>
        </div>
      </section>
    </main>
  );
}
