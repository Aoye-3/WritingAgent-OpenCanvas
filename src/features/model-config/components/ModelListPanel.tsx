import { EmptyState, Panel, TextField } from "../../../shared/ui";
import type { ModelReference } from "../../settings/types";

export function ModelListPanel({ models, query, selectedModel, zh, onQueryChange, onUseModel }: { models: ModelReference[]; query: string; selectedModel: string; zh: boolean; onQueryChange: (value: string) => void; onUseModel: (model: ModelReference) => void }) {
  return (
    <Panel className="model-list-panel">
      <div className="model-panel-header">
        <h2>{zh ? "模型列表" : "Models"}</h2>
        <span>{models.length}</span>
      </div>
      <TextField label={zh ? "搜索模型" : "Search models"} value={query} onChange={(event) => onQueryChange(event.target.value)} />
      <div className="model-reference-list">
        {models.length > 0 ? models.map((item) => (
          <button className={item.id === selectedModel ? "model-reference-row is-selected" : "model-reference-row"} key={`${item.provider}:${item.id}`} type="button" onClick={() => onUseModel(item)}>
            <span>
              <strong>{item.name}</strong>
              <small>{item.id}</small>
            </span>
            <em>{item.group}</em>
            <b>{item.modelType ?? "chat"}</b>
          </button>
        )) : <EmptyState title={zh ? "暂无模型" : "No models"}>{zh ? "尝试获取远程模型列表或切换供应商。" : "Fetch remote models or switch provider."}</EmptyState>}
      </div>
    </Panel>
  );
}
