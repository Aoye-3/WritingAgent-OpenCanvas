import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { useI18n } from "../i18n/I18nProvider";
import { SourceUpdatePanel } from "./components/SourceUpdatePanel";

type SourceUpdateViewProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
};

export function SourceUpdateView({ activeView, onNavigate }: SourceUpdateViewProps) {
  const { locale } = useI18n();
  const zh = locale === "zh";

  return (
    <main className="view management-app source-update-app" data-active={activeView === "sourceUpdate"}>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} className="management-sidebar" />
      <section className="management-main source-update-main">
        <div className="management-header">
          <div>
            <h1>{zh ? "应用更新" : "App updates"}</h1>
            <p>
              {zh
                ? "检查并应用 Harness 源码 Git 更新；本地项目数据、密钥、Knowledge、Memory 和运行时缓存会被保护。"
                : "Check and apply Harness source Git updates while protecting local projects, secrets, Knowledge, Memory, and runtime caches."}
            </p>
          </div>
        </div>

        <SourceUpdatePanel />
      </section>
    </main>
  );
}
