import { useEffect, useState } from "react";
import { fetchAgentRuntimeConfig, saveAgentSettings } from "../agentClient";
import type { AgentCard, AgentRuntimeConfig, AgentSettings } from "../types";

export function useAgentRuntimeConfig(
  selectedAgent: AgentCard | undefined,
  messages: {
    runtimeLoadFailed: string;
    saved: string;
  },
  onAgentSaved: (agentCard: AgentCard) => void
) {
  const [runtimeConfig, setRuntimeConfig] = useState<AgentRuntimeConfig | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(selectedAgent?.settings ?? null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  useEffect(() => {
    if (!selectedAgent) return;
    let active = true;
    setLoadingConfig(true);
    setMessage("");
    fetchAgentRuntimeConfig(selectedAgent.id)
      .then((config) => {
        if (!active) return;
        setRuntimeConfig(config);
        setDraft(config.settings);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeConfig(null);
        setDraft(selectedAgent.settings ?? null);
        setMessage(error instanceof Error ? error.message : messages.runtimeLoadFailed);
      })
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => {
      active = false;
    };
  }, [selectedAgent?.id, messages.runtimeLoadFailed]);

  const updateDraft = (next: AgentSettings) => {
    setDraft(next);
    setMessage("");
  };

  const saveDraft = async () => {
    if (!selectedAgent || !draft) return;
    setSaving(true);
    try {
      const result = await saveAgentSettings(selectedAgent.id, draft);
      onAgentSaved(result.agentCard);
      const config = await fetchAgentRuntimeConfig(selectedAgent.id);
      setRuntimeConfig(config);
      setDraft(config.settings);
      setMessage(messages.saved);
    } finally {
      setSaving(false);
    }
  };

  return {
    draft,
    loadingConfig,
    message,
    runtimeConfig,
    saving,
    saveDraft,
    updateDraft
  };
}
