import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Database, FilePlus, FileText, Globe2, Link, NotebookText, Plus, RefreshCcw, RotateCcw, Search, Trash2 } from "lucide-react";
import type { AppView } from "../../app/App";
import { Button, EmptyState, Panel, SelectField, StatusBadge, TextareaField, TextField } from "../../shared/ui";
import { useI18n } from "../i18n/I18nProvider";
import { ManagementSidebar } from "../projects/ProjectsView";
import { getConfiguredModelApis } from "../model-config/modelConfigClient";
import type { ConfiguredModelApiSummary } from "../settings/types";
import { knowledgeClient, type KnowledgeBaseDraft, type KnowledgeItemDraft } from "./knowledgeClient";
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemType, KnowledgeSearchResult } from "./types";

type KnowledgeLayer = "file" | "note" | "url" | "sitemap" | "text";

const layerOptions: Array<{ label: string; type: KnowledgeLayer; icon: typeof FileText }> = [
  { label: "文件", type: "file", icon: FileText },
  { label: "笔记", type: "note", icon: NotebookText },
  { label: "网址", type: "url", icon: Link },
  { label: "网站", type: "sitemap", icon: Globe2 },
  { label: "文本", type: "text", icon: BookOpen }
];

const defaultBaseDraft: KnowledgeBaseDraft = {
  name: "",
  description: "",
  embeddingConfigId: "",
  embeddingProvider: "openai-compatible",
  embeddingModel: "text-embedding-3-small",
  embeddingBaseUrl: "",
  documentCount: 6,
  threshold: 0.2,
  rerankEnabled: false,
  rerankConfigId: "",
  rerankProvider: "",
  rerankModel: "",
  rerankBaseUrl: ""
};

const defaultItemDraft: KnowledgeItemDraft = {
  type: "file",
  title: "",
  content: "",
  source: "",
  fileName: "",
  fileBase64: ""
};

export function KnowledgeSettingsView({ activeView, onNavigate }: { activeView: AppView; onNavigate: (view: AppView) => void }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [baseDraft, setBaseDraft] = useState<KnowledgeBaseDraft>(defaultBaseDraft);
  const [itemDraft, setItemDraft] = useState<KnowledgeItemDraft>(defaultItemDraft);
  const [activeLayer, setActiveLayer] = useState<KnowledgeLayer>("file");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [configuredApis, setConfiguredApis] = useState<ConfiguredModelApiSummary[]>([]);

  const selectedBase = useMemo(
    () => bases.find((base) => base.id === selectedBaseId) ?? bases[0],
    [bases, selectedBaseId]
  );
  const visibleItems = useMemo(
    () => selectedBase?.items.filter((item) => item.type === activeLayer) ?? [],
    [activeLayer, selectedBase]
  );
  const embeddingConfigs = useMemo(
    () => configuredApis.filter((config) => config.enabled && config.keyConfigured && config.modelType?.toLowerCase() === "embedding"),
    [configuredApis]
  );

  useEffect(() => {
    void refreshBases();
    void refreshConfiguredApis();
  }, []);

  async function refreshConfiguredApis() {
    try {
      const response = await getConfiguredModelApis();
      setConfiguredApis(response.configs);
      const firstEmbedding = response.configs.find((config) => config.enabled && config.keyConfigured && config.modelType?.toLowerCase() === "embedding");
      if (firstEmbedding) {
        setBaseDraft((current) => current.embeddingConfigId ? current : ({
          ...current,
          embeddingConfigId: firstEmbedding.id,
          embeddingProvider: firstEmbedding.providerId === "ollama" ? "ollama" : "openai-compatible",
          embeddingModel: firstEmbedding.modelId,
          embeddingBaseUrl: firstEmbedding.baseURL
        }));
      }
    } catch {
      setConfiguredApis([]);
    }
  }

  async function refreshBases() {
    setLoading(true);
    try {
      const response = await knowledgeClient.listBases();
      setBases(response.bases);
      if (!selectedBaseId && response.bases[0]) setSelectedBaseId(response.bases[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load knowledge bases");
    } finally {
      setLoading(false);
    }
  }

  async function createBase() {
    if (!baseDraft.name.trim()) {
      setMessage(zh ? "请输入知识库名称" : "Knowledge base name is required");
      return;
    }
    const selectedEmbeddingConfig = embeddingConfigs.find((config) => config.id === baseDraft.embeddingConfigId) ?? embeddingConfigs[0];
    setLoading(true);
    try {
      const response = await knowledgeClient.createBase(selectedEmbeddingConfig ? {
        ...baseDraft,
        embeddingConfigId: selectedEmbeddingConfig.id,
        embeddingProvider: selectedEmbeddingConfig.providerId === "ollama" ? "ollama" : "openai-compatible",
        embeddingModel: selectedEmbeddingConfig.modelId,
        embeddingBaseUrl: selectedEmbeddingConfig.baseURL
      } : baseDraft);
      setBases((current) => [response.base, ...current]);
      setSelectedBaseId(response.base.id);
      setBaseDraft(defaultBaseDraft);
      setMessage(zh ? "知识库已创建" : "Knowledge base created");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create knowledge base");
    } finally {
      setLoading(false);
    }
  }

  async function addItem() {
    if (!selectedBase) return;
    const draft = { ...itemDraft, type: activeLayer as KnowledgeItemType };
    if (draft.type === "file" && (!draft.fileBase64 || !draft.fileName)) {
      setMessage(zh ? "请选择要上传的文件" : "Please choose a file to upload");
      return;
    }
    if ((draft.type === "text" || draft.type === "note") && !draft.content?.trim()) {
      setMessage(zh ? "请输入内容" : "Text content is required");
      return;
    }
    if ((draft.type === "url" || draft.type === "sitemap") && !draft.source?.trim()) {
      setMessage(zh ? "请输入 URL" : "URL is required");
      return;
    }
    setLoading(true);
    try {
      await knowledgeClient.addItem(selectedBase.id, draft);
      await refreshBases();
      setItemDraft({ ...defaultItemDraft, type: activeLayer as KnowledgeItemType });
      setMessage(zh ? "条目已索引" : "Item indexed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to index item");
    } finally {
      setLoading(false);
    }
  }

  async function deleteBase(baseId: string) {
    setLoading(true);
    try {
      await knowledgeClient.deleteBase(baseId);
      setBases((current) => current.filter((base) => base.id !== baseId));
      if (selectedBaseId === baseId) setSelectedBaseId("");
      setMessage(zh ? "知识库已删除" : "Knowledge base deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete knowledge base");
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(baseId: string, itemId: string) {
    setLoading(true);
    try {
      await knowledgeClient.deleteItem(baseId, itemId);
      await refreshBases();
      setMessage(zh ? "条目已删除" : "Item deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete item");
    } finally {
      setLoading(false);
    }
  }

  async function reindexBase(baseId: string) {
    setLoading(true);
    try {
      await knowledgeClient.reindex(baseId);
      await refreshBases();
      setMessage(zh ? "重建索引完成" : "Reindex completed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reindex base");
    } finally {
      setLoading(false);
    }
  }

  async function searchKnowledge() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await knowledgeClient.search({
        query,
        baseIds: selectedBase ? [selectedBase.id] : undefined
      });
      setResults(response.results);
      setMessage(response.results.length ? "" : zh ? "没有找到匹配结果" : "No matching results");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to search knowledge");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setItemDraft((current) => ({ ...current, fileName: "", fileBase64: "" }));
      return;
    }
    const fileBase64 = await readFileBase64(file);
    setItemDraft((current) => ({
      ...current,
      fileName: file.name,
      fileBase64,
      source: "",
      title: current.title || file.name
    }));
  }

  function switchLayer(type: KnowledgeLayer) {
    setActiveLayer(type);
    setItemDraft({ ...defaultItemDraft, type });
    setResults([]);
    setMessage("");
  }

  return (
    <main className="view management-app knowledge-shell" data-active={activeView === "knowledgeSettings"}>
      <ManagementSidebar activeView={activeView} onNavigate={onNavigate} />
      <section className="knowledge-workbench">
        <aside className="knowledge-base-sidebar">
          <div className="knowledge-base-header">
            <strong>{zh ? "知识库列表" : "Knowledge Bases"}</strong>
            <Button size="sm" onClick={createBase} variant="ghost"><Plus size={14} />{zh ? "添加" : "Add"}</Button>
          </div>
          <div className="knowledge-create-compact">
            <SelectField
              label={zh ? "已配置嵌入 API" : "Configured embedding API"}
              value={baseDraft.embeddingConfigId ?? ""}
              onChange={(event) => {
                const config = embeddingConfigs.find((item) => item.id === event.target.value);
                setBaseDraft({
                  ...baseDraft,
                  embeddingConfigId: config?.id ?? "",
                  embeddingProvider: config?.providerId === "ollama" ? "ollama" : "openai-compatible",
                  embeddingModel: config?.modelId ?? baseDraft.embeddingModel,
                  embeddingBaseUrl: config?.baseURL ?? baseDraft.embeddingBaseUrl
                });
              }}
            >
              {embeddingConfigs.length === 0 ? <option value="">{zh ? "暂无已配置嵌入模型" : "No configured embedding models"}</option> : null}
              {embeddingConfigs.map((config) => (
                <option value={config.id} key={config.id}>{config.providerLabel} / {config.modelName}</option>
              ))}
            </SelectField>
            <TextField label={zh ? "名称" : "Name"} value={baseDraft.name} onChange={(event) => setBaseDraft({ ...baseDraft, name: event.target.value })} placeholder={zh ? "新知识库" : "New base"} />
            <SelectField label="Embedding" value={baseDraft.embeddingProvider} onChange={(event) => setBaseDraft({ ...baseDraft, embeddingProvider: event.target.value as KnowledgeBaseDraft["embeddingProvider"] })}>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="ollama">Ollama</option>
            </SelectField>
            <TextField label={zh ? "模型" : "Model"} value={baseDraft.embeddingModel} onChange={(event) => setBaseDraft({ ...baseDraft, embeddingModel: event.target.value })} />
          </div>
          <div className="knowledge-base-list">
            {bases.map((base) => (
              <button className={base.id === selectedBase?.id ? "knowledge-base-row is-active" : "knowledge-base-row"} key={base.id} onClick={() => setSelectedBaseId(base.id)} type="button">
                <Database size={17} />
                <span>
                  <strong>{base.name}</strong>
                  <small>{base.items.length} items · {base.embeddingModel}</small>
                </span>
              </button>
            ))}
            {bases.length === 0 ? <EmptyState title={zh ? "还没有知识库" : "No bases"}>{zh ? "先创建一个知识库。" : "Create a base first."}</EmptyState> : null}
          </div>
        </aside>

        <section className="knowledge-main-stage">
          <header className="knowledge-stage-header">
            <div>
              <h1>{selectedBase?.name ?? (zh ? "知识库" : "Knowledge Base")}</h1>
              <p>{selectedBase ? `${selectedBase.embeddingProvider} · ${selectedBase.embeddingModel}` : zh ? "管理本地 RAG 知识源" : "Manage local RAG sources"}</p>
            </div>
            <div className="knowledge-actions">
              <Button loading={loading} onClick={refreshBases} variant="secondary"><RefreshCcw size={16} />{zh ? "刷新" : "Refresh"}</Button>
              {selectedBase ? <Button onClick={() => reindexBase(selectedBase.id)}><RotateCcw size={16} />{zh ? "重建" : "Reindex"}</Button> : null}
              {selectedBase ? <Button onClick={() => deleteBase(selectedBase.id)} variant="danger"><Trash2 size={16} />{zh ? "删除" : "Delete"}</Button> : null}
            </div>
          </header>

          {message ? <div className="knowledge-alert">{message}</div> : null}

          {selectedBase ? (
            <>
              <nav className="knowledge-layer-tabs" aria-label="Knowledge source types">
                {layerOptions.map((layer) => {
                  const Icon = layer.icon;
                  const count = selectedBase.items.filter((item) => item.type === layer.type).length;
                  return (
                    <button className={activeLayer === layer.type ? "is-active" : ""} key={layer.type} onClick={() => switchLayer(layer.type)} type="button">
                      <Icon size={17} />
                      <span>{layer.label}</span>
                      <small>{count}</small>
                    </button>
                  );
                })}
              </nav>

              <Panel className="knowledge-import-panel">
                {activeLayer === "file" ? (
                  <label className="knowledge-dropzone">
                    <FilePlus size={24} />
                    <strong>{itemDraft.fileName || (zh ? "拖拽或选择文件上传" : "Drop or choose a file")}</strong>
                    <span>TXT, MD, PDF, DOC, DOCX, CSV, JSON</span>
                    <input accept=".csv,.doc,.docx,.json,.md,.pdf,.txt" type="file" onChange={handleFileChange} />
                  </label>
                ) : activeLayer === "url" || activeLayer === "sitemap" ? (
                  <div className="knowledge-inline-import">
                    <TextField label={activeLayer === "sitemap" ? "Sitemap URL" : "URL"} value={itemDraft.source} onChange={(event) => setItemDraft({ ...itemDraft, source: event.target.value })} />
                    <TextField label={zh ? "标题" : "Title"} value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} />
                  </div>
                ) : (
                  <div className="knowledge-note-import">
                    <TextField label={zh ? "标题" : "Title"} value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} />
                    <TextareaField label={zh ? "内容" : "Content"} rows={6} value={itemDraft.content} onChange={(event) => setItemDraft({ ...itemDraft, content: event.target.value })} />
                  </div>
                )}
                <Button loading={loading} onClick={addItem} variant="primary"><Plus size={16} />{activeLayer === "file" ? (zh ? "添加文件" : "Add file") : (zh ? "添加条目" : "Add item")}</Button>
              </Panel>

              <section className="knowledge-content-grid">
                <Panel className="knowledge-panel">
                  <div className="knowledge-panel-title">
                    <h2>{zh ? "文件列表" : "Items"}</h2>
                    <StatusBadge tone="neutral">{visibleItems.length}</StatusBadge>
                  </div>
                  <div className="knowledge-items">
                    {visibleItems.map((item) => (
                      <KnowledgeItemRow item={item} key={item.id} onDelete={() => deleteItem(selectedBase.id, item.id)} />
                    ))}
                    {visibleItems.length === 0 ? <EmptyState title={zh ? "暂无条目" : "No items"}>{zh ? "从上方导入当前类型的知识源。" : "Import this source type above."}</EmptyState> : null}
                  </div>
                </Panel>

                <Panel className="knowledge-panel">
                  <h2><Search size={18} />{zh ? "检索测试" : "Search Test"}</h2>
                  <div className="knowledge-search-row">
                    <TextField label={zh ? "查询" : "Query"} value={query} onChange={(event) => setQuery(event.target.value)} />
                    <Button loading={loading} onClick={searchKnowledge} variant="primary">{zh ? "搜索" : "Search"}</Button>
                  </div>
                  <div className="knowledge-results">
                    {results.map((result) => (
                      <article className="knowledge-result" key={`${result.baseId}-${result.id}-${result.source}`}>
                        <strong>{result.title}</strong>
                        <small><Link size={13} />{result.source} · {result.score.toFixed(3)}</small>
                        <p>{result.content}</p>
                      </article>
                    ))}
                  </div>
                </Panel>
              </section>
            </>
          ) : (
            <EmptyState title={zh ? "选择或创建知识库" : "Select or create a base"}>{zh ? "左侧会显示所有知识库。" : "Bases appear in the left column."}</EmptyState>
          )}
        </section>
      </section>
    </main>
  );
}

function KnowledgeItemRow({ item, onDelete }: { item: KnowledgeItem; onDelete: () => void }) {
  return (
    <div className="knowledge-item-row">
      <FileText size={30} />
      <span>
        <strong>{item.title}</strong>
        <small>{item.source}</small>
        {item.errorMessage ? <small className="knowledge-error">{item.errorMessage}</small> : null}
      </span>
      <div className="knowledge-actions">
        {item.status === "completed" ? <CheckCircle2 className="knowledge-ok-icon" size={17} /> : <StatusBadge tone={item.status === "failed" ? "danger" : "warning"}>{item.status}</StatusBadge>}
        <Button size="sm" onClick={onDelete} variant="ghost"><Trash2 size={14} /></Button>
      </div>
    </div>
  );
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",").pop() ?? "" : value);
    };
    reader.readAsDataURL(file);
  });
}
