import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import { AgentIcon, BookIcon, BrandIcon, DocumentIcon, HomeIcon, ModelConfigIcon, RuntimeIcon } from "./icons";
import { Button } from "./ui";

type AppSidebarProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSettings?: () => void;
  className?: string;
};

const navItems: Array<{ view: AppView; icon: typeof HomeIcon; labelKey: keyof typeof labelsEn }> = [
  { view: "home", icon: HomeIcon, labelKey: "home" },
  { view: "projects", icon: DocumentIcon, labelKey: "projects" },
  { view: "agentSettings", icon: AgentIcon, labelKey: "agentSettings" },
  { view: "modelConfig", icon: ModelConfigIcon, labelKey: "modelConfig" },
  { view: "aiDashboard", icon: RuntimeIcon, labelKey: "aiDashboard" },
  { view: "knowledgeSettings", icon: BookIcon, labelKey: "knowledgeSettings" }
];

const labelsEn = {
  home: "Home",
  projects: "Projects",
  agentSettings: "Agent settings",
  modelConfig: "Model config",
  aiDashboard: "AI Dashboard",
  knowledgeSettings: "Knowledge settings"
};

const labelsZh: typeof labelsEn = {
  home: "首页",
  projects: "项目",
  agentSettings: "Agent 设置",
  modelConfig: "模型配置",
  aiDashboard: "AI 仪表盘",
  knowledgeSettings: "知识库设置"
};

export function AppSidebar({ activeView, onNavigate, onOpenSettings, className }: AppSidebarProps) {
  const { locale, setLocale } = useI18n();
  const labels = locale === "zh" ? labelsZh : labelsEn;

  return (
    <aside className={className ? `home-sidebar ${className}` : "home-sidebar"} aria-label="App navigation">
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
