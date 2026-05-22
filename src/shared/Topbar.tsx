import type { ReactNode } from "react";
import type { AppView } from "../app/App";
import { useI18n } from "../features/i18n/I18nProvider";
import { BrandIcon, SearchIcon, SettingsIcon } from "./icons";
import { Button } from "./ui";

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
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <header className={`topbar ${activeView === "home" ? "topbar-home" : "topbar-workspace"}`}>
      <button className="brand-button" type="button" onClick={onGoHome} aria-label="Go to task cards">
        <span className="brand-mark" aria-hidden="true">
          <BrandIcon />
        </span>
        <span className="brand-lockup">
          <strong>OpenCanvas</strong>
          <small>FacetWrite</small>
        </span>
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
        <Button className="project-settings-button" variant="secondary" type="button" onClick={onOpenSettings}>
          <span>{t("app.projectSettings")}</span>
          <SettingsIcon aria-hidden="true" />
        </Button>
        <button className="language-switch" type="button" onClick={() => setLocale(nextLocale)} aria-label={locale === "zh" ? "Switch to English" : "切换中文"}>
          <span className={locale === "en" ? "selected" : ""}>EN</span>
          <span className={locale === "zh" ? "selected" : ""}>中文</span>
        </button>
        {actions}
      </nav>
    </header>
  );
}
