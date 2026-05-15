import type { ReactNode } from "react";
import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import { BrandIcon, SearchIcon } from "./icons";

type TopbarProps = {
  activeView: AppView;
  actions?: ReactNode;
  contextLabel?: string;
  onGoHome: () => void;
  onOpenSettings: () => void;
};

export function Topbar({
  activeView,
  actions,
  contextLabel,
  onGoHome,
  onOpenSettings
}: TopbarProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <header className={`topbar ${activeView === "home" ? "topbar-home" : "topbar-workspace"}`}>
      <button className="brand-button" type="button" onClick={onGoHome} aria-label="Go to task cards">
        <span className="brand-mark" aria-hidden="true">
          <BrandIcon />
        </span>
        <span>FacetWrite</span>
      </button>

      {activeView === "home" ? (
        <div className="topbar-spacer" aria-hidden="true" />
      ) : (
        <label className="search-field topbar-context-field">
          <SearchIcon />
          <input type="text" value={contextLabel} aria-label="Current workspace" readOnly />
        </label>
      )}

      <nav className="topbar-actions" aria-label="Workspace actions">
        <button className="project-settings-button" type="button" onClick={onOpenSettings}>
          <span>{t("app.projectSettings")}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10" />
            <path d="M18 7h2" />
            <path d="M16 5v4" />
            <path d="M4 17h2" />
            <path d="M10 17h10" />
            <path d="M8 15v4" />
          </svg>
        </button>
        <button className="language-switch" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
          <span className={locale === "en" ? "selected" : ""}>EN</span>
          <span className={locale === "zh" ? "selected" : ""}>中文</span>
        </button>
        {actions}
      </nav>
    </header>
  );
}
