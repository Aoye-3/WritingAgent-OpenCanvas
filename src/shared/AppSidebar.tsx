import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import { AgentIcon, BookIcon, BrandIcon, DocumentIcon, HomeIcon, RuntimeIcon } from "./icons";
import { Button } from "./ui";

type AppSidebarProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSettings?: () => void;
  className?: string;
};

const navItems: Array<{ view: AppView; icon: typeof HomeIcon; labelKey: "home" | "projects" | "agentSettings" | "aiDashboard" | "knowledgeSettings" }> = [
  { view: "home", icon: HomeIcon, labelKey: "home" },
  { view: "projects", icon: DocumentIcon, labelKey: "projects" },
  { view: "agentSettings", icon: AgentIcon, labelKey: "agentSettings" },
  { view: "aiDashboard", icon: RuntimeIcon, labelKey: "aiDashboard" },
  { view: "knowledgeSettings", icon: BookIcon, labelKey: "knowledgeSettings" }
];

export function AppSidebar({ activeView, onNavigate, onOpenSettings, className }: AppSidebarProps) {
  const { locale, setLocale } = useI18n();
  const labels = {
    home: locale === "zh" ? "家" : "Home",
    projects: locale === "zh" ? "项目" : "Projects",
    agentSettings: locale === "zh" ? "Agent 设置" : "Agent settings",
    aiDashboard: locale === "zh" ? "AI 仪表盘" : "AI Dashboard",
    knowledgeSettings: locale === "zh" ? "知识库设置" : "Knowledge settings"
  };

  return (
    <aside className={className ? `home-sidebar ${className}` : "home-sidebar"} aria-label="App navigation">
      <div className="home-sidebar-brand">
        <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
        <span>FacetWrite</span>
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
              <span>{labels[item.labelKey]}</span>
            </button>
          );
        })}
      </nav>

      <div className="home-sidebar-footer">
        <Button className="home-side-pill" size="sm" type="button" variant="secondary">{locale === "zh" ? "本地应用模式" : "Local app mode"}</Button>
        {onOpenSettings ? (
          <Button className="home-side-pill" size="sm" type="button" variant="secondary" onClick={onOpenSettings}>
            {locale === "zh" ? "项目设置" : "Project settings"}
          </Button>
        ) : null}
        <Button className="home-side-pill" size="sm" type="button" variant="secondary" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
          {locale === "zh" ? "Switch to English" : "切换中文"}
        </Button>
      </div>
    </aside>
  );
}
