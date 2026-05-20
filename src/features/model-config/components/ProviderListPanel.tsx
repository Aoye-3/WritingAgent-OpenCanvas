import { Panel } from "../../../shared/ui";
import type { ProviderReference } from "../../settings/types";

export function ProviderListPanel({ providers, selectedProviderId, zh, onSelect }: { providers: ProviderReference[]; selectedProviderId?: string; zh: boolean; onSelect: (provider: ProviderReference) => void }) {
  return (
    <Panel className="model-provider-panel">
      <div className="model-panel-header">
        <h2>{zh ? "供应商" : "Providers"}</h2>
        <span>{providers.length}</span>
      </div>
      <div className="model-provider-list">
        {providers.map((provider) => (
          <button className={provider.id === selectedProviderId ? "model-provider-row is-active" : "model-provider-row"} key={provider.id} type="button" onClick={() => onSelect(provider)}>
            <span className="model-provider-avatar">{provider.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{provider.name}</strong>
              <small>{provider.type} / {provider.models.length} static</small>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
