import type { AppView } from "../../app/App";
import { EmptyState, Panel } from "../../shared/ui";
import { useI18n } from "../i18n/I18nProvider";
import { ManagementSidebar } from "../projects/ProjectsView";

export function KnowledgeSettingsView({ activeView, onNavigate }: { activeView: AppView; onNavigate: (view: AppView) => void }) {
  const { locale } = useI18n();
  return (
    <main className="view management-app" data-active={activeView === "knowledgeSettings"}>
      <ManagementSidebar activeView={activeView} onNavigate={onNavigate} />
      <section className="management-main">
        <div className="management-header">
          <div>
            <h1>{locale === "zh" ? "知识库设置" : "Knowledge settings"}</h1>
            <p>{locale === "zh" ? "当前阶段为知识库能力预留入口；Agent 可以保存知识库开关并注入 Prompt。" : "Reserved for knowledge base setup; Agents can already save knowledge toggles and prompt hints."}</p>
          </div>
        </div>
        <Panel className="knowledge-placeholder">
          <EmptyState title={locale === "zh" ? "即将接入本地知识库" : "Local knowledge base coming next"}>
            {locale === "zh" ? "后续这里会管理文档上传、索引、引用范围和检索结果。" : "This area will manage uploads, indexing, reference scopes, and retrieval results."}
          </EmptyState>
        </Panel>
      </section>
    </main>
  );
}
