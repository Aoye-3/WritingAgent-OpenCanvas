import type { ComponentType } from "react";
import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import { BrandIcon } from "./icons";

type AppSidebarProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSettings?: () => void;
  className?: string;
};

const navItems: Array<{ view: AppView; icon: ComponentType; labelKey: "home" | "projects" | "agentSettings" | "knowledgeSettings" }> = [
  { view: "home", icon: HomeGlyph, labelKey: "home" },
  { view: "projects", icon: DocumentGlyph, labelKey: "projects" },
  { view: "agentSettings", icon: AgentGlyph, labelKey: "agentSettings" },
  { view: "knowledgeSettings", icon: BookGlyph, labelKey: "knowledgeSettings" }
];

export function AppSidebar({ activeView, onNavigate, onOpenSettings, className }: AppSidebarProps) {
  const { locale, setLocale } = useI18n();
  const labels = {
    home: locale === "zh" ? "家" : "Home",
    projects: locale === "zh" ? "项目" : "Projects",
    agentSettings: locale === "zh" ? "Agent设置" : "Agent settings",
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
        <button className="home-side-pill" type="button">{locale === "zh" ? "本地应用模式" : "Local app mode"}</button>
        {onOpenSettings ? (
          <button className="home-side-pill" type="button" onClick={onOpenSettings}>
            {locale === "zh" ? "项目设置" : "Project settings"}
          </button>
        ) : null}
        <button className="home-side-pill" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
          {locale === "zh" ? "Switch to English" : "切换中文"}
        </button>
      </div>
    </aside>
  );
}

export function DocumentGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h7l4 4v12H7z" /><path d="M14 4v5h5" /></svg>;
}

function HomeGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v8H5v-8Z" /><path d="M9 20v-6h6v6" /></svg>;
}

function AgentGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5" /></svg>;
}

function BookGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h7a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4-4Z" /><path d="M19 5h-3a4 4 0 0 0-4 4v10" /></svg>;
}
