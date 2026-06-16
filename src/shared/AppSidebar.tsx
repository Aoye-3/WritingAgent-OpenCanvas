import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import type { TranslationKey } from "../features/i18n/translations";
import { AgentIcon, BookIcon, BrandIcon, CanvasNodesIcon, DocumentIcon, HomeIcon, ModelConfigIcon, RuntimeIcon } from "./icons";
import { Button } from "./ui";

type AppSidebarProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSettings?: () => void;
  className?: string;
};

const navItems: Array<{ view: AppView; icon: typeof HomeIcon; labelKey: TranslationKey }> = [
  { view: "home", icon: HomeIcon, labelKey: "sidebar.home" },
  { view: "projects", icon: DocumentIcon, labelKey: "sidebar.projects" },
  { view: "agentSettings", icon: AgentIcon, labelKey: "sidebar.agentSettings" },
  { view: "canvasNodeSettings", icon: CanvasNodesIcon, labelKey: "sidebar.canvasNodeSettings" },
  { view: "modelConfig", icon: ModelConfigIcon, labelKey: "sidebar.modelConfig" },
  { view: "aiDashboard", icon: RuntimeIcon, labelKey: "sidebar.aiDashboard" },
  { view: "knowledgeSettings", icon: BookIcon, labelKey: "sidebar.knowledgeSettings" }
];

export function AppSidebar({ activeView, onNavigate, onOpenSettings, className }: AppSidebarProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <aside className={className ? `home-sidebar ${className}` : "home-sidebar"} aria-label={t("topbar.appNavigation")}>
      <div className="home-sidebar-brand">
        <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
        <span className="brand-lockup">
          <strong>OpenCanvas</strong>
          <small>FacetWrite</small>
        </span>
      </div>

      <nav className="home-sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activeView === item.view ? "home-nav-item is-active" : "home-nav-item"}
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
            >
              <Icon />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="home-sidebar-footer">
        <Button className="home-side-pill" size="sm" type="button" variant="secondary">{t("topbar.localAppMode")}</Button>
        {onOpenSettings ? (
          <Button className="home-side-pill" size="sm" type="button" variant="secondary" onClick={onOpenSettings}>
            {t("app.projectSettings")}
          </Button>
        ) : null}
        <Button className="home-side-pill" size="sm" type="button" variant="secondary" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
          {locale === "zh" ? t("topbar.switchToEnglish") : t("topbar.switchToChinese")}
        </Button>
      </div>
    </aside>
  );
}
