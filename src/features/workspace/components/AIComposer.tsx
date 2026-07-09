import { useEffect, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { AddIcon, AgentIcon, KnowledgeIcon, LightbulbIcon, ModelConfigIcon, SearchIcon, SendIcon, StopIcon } from "../../../shared/icons";
import type { AgentCard, SkillCatalogItem, SkillFolderItem } from "../../agents/types";
import type { GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import type { ConfiguredModelApiSummary } from "../../settings/types";
import { visibleComposerTools } from "../planUiPolicy";
import { SkillPickerDialog } from "./SkillPickerDialog";
import { supportsModelThinking } from "../../../../shared/modelCapabilities";

type ToolKey = NonNullable<GenerateRequest["toolState"]> extends Partial<Record<infer Key, boolean>> ? Key : never;

export type ThinkingChoice = "disabled" | "high" | "max";
export type RuntimeBudgetChoice = NonNullable<GenerateRequest["runtimeBudgetProfile"]>;

export type ConversationModelControls = {
  providerId?: string;
  modelId?: string;
  modelName?: string;
  supportsThinking?: boolean;
  thinkingMode?: NonNullable<GenerateRequest["modelOverrides"]>["thinkingMode"];
  reasoningEffort?: NonNullable<GenerateRequest["modelOverrides"]>["reasoningEffort"];
};

export type AIComposerSubmitPayload = {
  text: string;
  agentId: string;
  enabledSkillRefs: string[];
  disabledSkillRefs: string[];
  selectedModelConfigId?: string | null;
  runtimeBudgetProfile: RuntimeBudgetChoice;
  thinkingChoice: ThinkingChoice;
  toolState: GenerateRequest["toolState"];
};

type AIComposerProps = {
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  allowedTools: string[];
  className?: string;
  configuredModels: ConfiguredModelApiSummary[];
  disabled?: boolean;
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  hideResizeHandle?: boolean;
  isSending: boolean;
  modelSelectionDisabled: boolean;
  modelSettings?: ConversationModelControls;
  placeholder: string;
  runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"];
  selectedModelConfigId?: string | null;
  skillCatalog: SkillCatalogItem[];
  skillCatalogStatus: "idle" | "loading" | "ready" | "error";
  skillFolders: SkillFolderItem[];
  submitEmpty?: boolean;
  toolState: GenerateRequest["toolState"];
  value: string;
  onRequestSkillCatalog: () => void;
  onSelectAgent: (agentCardId: string) => void;
  onSelectModel: (configuredModelApiId: string) => Promise<void> | void;
  onStopSending?: () => void;
  onSubmit: (payload: AIComposerSubmitPayload) => Promise<unknown> | unknown;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  onValueChange: (value: string) => void;
};

const COMPOSER_MIN_HEIGHT = 72;
const COMPOSER_MAX_HEIGHT = 240;

const toolMeta: Record<string, { en: string; zh: string; hint: string }> = {
  web_search: { en: "Web search", zh: "\u8054\u7f51\u641c\u7d22", hint: "Web search intent only" },
  knowledge_base: { en: "Knowledge base", zh: "\u77e5\u8bc6\u5e93\u5f15\u7528", hint: "Use selected knowledge hints" },
  clear_context: { en: "Clear context", zh: "\u6e05\u9664\u4e0a\u4e0b\u6587", hint: "Ignore previous conversational context" }
};

export function AIComposer({
  activeAgent,
  agentCards,
  allowedTools,
  className = "",
  configuredModels,
  disabled = false,
  disabledSkillRefs,
  enabledSkillRefs,
  hideResizeHandle = false,
  isSending,
  modelSelectionDisabled,
  modelSettings,
  placeholder,
  runtimeBudgetProfile,
  selectedModelConfigId,
  skillCatalog,
  skillCatalogStatus,
  skillFolders,
  submitEmpty = false,
  toolState,
  value,
  onRequestSkillCatalog,
  onSelectAgent,
  onSelectModel,
  onStopSending,
  onSubmit,
  onToggleSkill,
  onToolStateChange,
  onValueChange
}: AIComposerProps) {
  const { locale, t } = useI18n();
  const supportsThinking = isThinkingSupportedModel(modelSettings);
  const [thinkingChoice, setThinkingChoice] = useState<ThinkingChoice>(modelSettingsToThinkingChoice(modelSettings));
  const [runtimeBudgetChoice, setRuntimeBudgetChoice] = useState<RuntimeBudgetChoice>(runtimeBudgetProfile ?? "low");
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const showStopControl = shouldShowStopControl(isSending, value);

  useEffect(() => {
    setThinkingChoice(modelSettingsToThinkingChoice(modelSettings));
  }, [modelSettings?.providerId, modelSettings?.modelId, modelSettings?.modelName, modelSettings?.supportsThinking, modelSettings?.thinkingMode, modelSettings?.reasoningEffort]);

  useEffect(() => {
    if (!supportsThinking) setThinkingMenuOpen(false);
  }, [supportsThinking]);

  useEffect(() => {
    setRuntimeBudgetChoice(runtimeBudgetProfile ?? "low");
  }, [runtimeBudgetProfile]);

  useEffect(() => {
    if (skillPickerOpen) onRequestSkillCatalog();
  }, [onRequestSkillCatalog, skillPickerOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (!text && !submitEmpty) return;
    await onSubmit({
      text,
      agentId: activeAgent.id,
      enabledSkillRefs,
      disabledSkillRefs,
      selectedModelConfigId,
      runtimeBudgetProfile: runtimeBudgetChoice,
      thinkingChoice,
      toolState
    });
  };

  const startComposerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, startHeight + startY - moveEvent.clientY));
      setComposerHeight(nextHeight);
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  return (
    <form className={`drawer-chat-composer ai-composer ${className}`.trim()} onSubmit={submit}>
      <div className="composer-control-row" data-testid="composer-control-row">
        <div className={locale === "en" ? "composer-agent-section is-icon-only" : "composer-agent-section"}>
          <AgentIcon aria-hidden="true" size={16} />
          <select
            aria-label={t("workspace.agentForMessage")}
            className="composer-agent-select"
            title={activeAgent.title[locale]}
            value={activeAgent.id}
            onChange={(event) => onSelectAgent(event.target.value)}
          >
            {agentCards.map((agent) => <option key={agent.id} value={agent.id}>{agent.title[locale]}</option>)}
          </select>
        </div>
        {supportsThinking ? (
          <div className="composer-thinking-section">
            <ThinkingModeButton choice={thinkingChoice} open={thinkingMenuOpen} onChange={setThinkingChoice} onOpenChange={setThinkingMenuOpen} />
          </div>
        ) : null}
        <RuntimeBudgetControl value={runtimeBudgetChoice} onChange={setRuntimeBudgetChoice} />
      </div>
      {enabledSkillRefs.length || disabledSkillRefs.length ? (
        <div className="composer-skill-chips" aria-label={skillText(locale, "selectedSkills")}>
          {enabledSkillRefs.map((skillRef) => (
            <span className="composer-skill-chip" key={`enabled:${skillRef}`}>
              {skillRef}
              <button aria-label={skillText(locale, "removeSkill", skillRef)} onClick={() => onToggleSkill(findSkill(skillCatalog, skillRef), false)} type="button">
                x
              </button>
            </span>
          ))}
          {disabledSkillRefs.map((skillRef) => (
            <span className="composer-skill-chip is-disabled" key={`disabled:${skillRef}`}>
              {skillText(locale, "disabledSkill", skillRef)}
              <button aria-label={skillText(locale, "restoreSkill", skillRef)} onClick={() => onToggleSkill(findSkill(skillCatalog, skillRef), true)} type="button">
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {hideResizeHandle ? null : (
        <div
          aria-label={t("workspace.resizeMessageInput")}
          aria-orientation="horizontal"
          className="composer-resize-handle"
          data-testid="composer-resize-handle"
          onPointerDown={startComposerResize}
          role="separator"
          title={t("workspace.resizeMessageInputTitle")}
        >
          <span aria-hidden="true" />
        </div>
      )}
      <textarea
        aria-label={t("workspace.aiMessage")}
        data-testid="ai-collaboration-input"
        disabled={disabled}
        placeholder={placeholder}
        rows={3}
        style={{ height: composerHeight }}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <div className="composer-tool-row">
        <ToolUseIconBar allowedTools={allowedTools} toolState={toolState} onToolStateChange={onToolStateChange} />
        <div className="composer-skill-picker">
          <button
            aria-expanded={skillPickerOpen}
            aria-haspopup="dialog"
            aria-label={skillText(locale, "skills")}
            className={enabledSkillRefs.length || disabledSkillRefs.length ? "tool-icon-button is-active" : "tool-icon-button"}
            onClick={() => setSkillPickerOpen((open) => !open)}
            title={skillText(locale, "skills")}
            type="button"
          >
            <AddIcon aria-hidden="true" size={15} />
          </button>
          <SkillPickerDialog
            activeSkillRefs={activeAgent.skillRefs}
            disabledSkillRefs={disabledSkillRefs}
            enabledSkillRefs={enabledSkillRefs}
            folders={skillFolders}
            locale={locale}
            open={skillPickerOpen}
            skills={skillCatalog}
            status={skillCatalogStatus}
            title={skillText(locale, "skills")}
            onClose={() => setSkillPickerOpen(false)}
            onToggleSkill={onToggleSkill}
          />
        </div>
        <select
          aria-label={t("workspace.conversationModel")}
          className="composer-model-select"
          disabled={modelSelectionDisabled}
          value={selectedModelConfigId ?? ""}
          onChange={(event) => { void onSelectModel(event.target.value); }}
        >
          <option value="">{t("workspace.selectModel")}</option>
          {modelGroups(locale).map((group) => {
            const models = configuredModels.filter((model) => model.capabilityGroup === group.id);
            return models.length ? (
              <optgroup key={group.id} label={group.label}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.providerLabel} / {model.modelName}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
        <button
          aria-label={t("workspace.createTaskPlan")}
          className="tool-icon-button plan-command-button"
          onClick={() => onValueChange(value.startsWith("/plan") ? value : `/plan ${value}`)}
          title={t("workspace.createTaskPlan")}
          type="button"
        >
          <ModelConfigIcon aria-hidden="true" size={15} />
        </button>
        <button
          aria-label={showStopControl ? (locale === "zh" ? "\u505c\u6b62" : "Stop") : t("workspace.send")}
          className={showStopControl ? "button button-primary chat-send chat-send-icon is-stopping" : "button button-primary chat-send chat-send-icon"}
          disabled={disabled}
          onClick={showStopControl ? onStopSending : undefined}
          title={showStopControl ? (locale === "zh" ? "\u505c\u6b62\u5f53\u524d\u4efb\u52a1" : "Stop current run") : isSending ? (locale === "zh" ? "\u53d1\u9001\u5e76\u6392\u961f" : "Send and queue") : t("workspace.send")}
          type={showStopControl ? "button" : "submit"}
        >
          {showStopControl ? <StopIcon aria-hidden="true" size={18} /> : <SendIcon aria-hidden="true" size={18} />}
        </button>
      </div>
    </form>
  );
}

function shouldShowStopControl(isSending: boolean, input: string) {
  return isSending && input.trim().length === 0;
}

export function modelSettingsToThinkingChoice(modelSettings?: ConversationModelControls): ThinkingChoice {
  if (!isThinkingSupportedModel(modelSettings) || modelSettings?.thinkingMode !== "enabled") return "disabled";
  return modelSettings.reasoningEffort === "max" || modelSettings.reasoningEffort === "xhigh" ? "max" : "high";
}

export function isThinkingSupportedModel(modelSettings?: ConversationModelControls) {
  return modelSettings?.supportsThinking === true || supportsModelThinking(modelSettings);
}

export function thinkingOverridesFromChoice(choice: ThinkingChoice): GenerateRequest["modelOverrides"] {
  if (choice === "disabled") return { thinkingMode: "disabled" };
  return { thinkingMode: "enabled", reasoningEffort: choice };
}

function ToolUseIconBar({ allowedTools, toolState, onToolStateChange }: Pick<AIComposerProps, "allowedTools" | "toolState" | "onToolStateChange">) {
  const { locale, t } = useI18n();
  const visibleTools = visibleComposerTools(allowedTools);
  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="composer-tool-icons" aria-label={t("workspace.toolUseCommandBar")}>
      {visibleTools.map((tool) => {
        const active = Boolean(toolState?.[tool as ToolKey]);
        const meta = toolMeta[tool] ?? { en: tool, zh: tool, hint: tool };
        const label = locale === "zh" ? meta.zh : meta.en;
        return (
          <button
            aria-label={label}
            aria-pressed={active}
            className={active ? "tool-icon-button is-active" : "tool-icon-button"}
            key={tool}
            onClick={() => toggle(tool)}
            title={`${label}: ${meta.hint}`}
            type="button"
          >
            <ToolIcon tool={tool} />
            {active ? <i aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function ToolIcon({ tool }: { tool: string }) {
  if (tool === "web_search") return <SearchIcon aria-hidden="true" size={16} />;
  if (tool === "knowledge_base") return <KnowledgeIcon aria-hidden="true" size={16} />;
  return null;
}

function ThinkingModeButton({
  choice,
  open,
  onChange,
  onOpenChange
}: {
  choice: ThinkingChoice;
  open: boolean;
  onChange: (choice: ThinkingChoice) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useI18n();
  const label = thinkingLabel(locale, choice);
  return (
    <div className="thinking-mode-control">
      <button
        aria-expanded={open}
        aria-label={locale === "zh" ? "\u601d\u8003\u6a21\u5f0f" : "Thinking mode"}
        className={choice === "disabled" ? "thinking-mode-button" : "thinking-mode-button is-active"}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <span><LightbulbIcon aria-hidden="true" size={16} /></span>
        <strong>{label}</strong>
      </button>
      {open ? (
        <div className="thinking-mode-menu" role="menu">
          {(["disabled", "high", "max"] as ThinkingChoice[]).map((option) => (
            <button
              className={option === choice ? "is-active" : ""}
              key={option}
              onClick={() => {
                onChange(option);
                onOpenChange(false);
              }}
              role="menuitem"
              type="button"
            >
              {thinkingLabel(locale, option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeBudgetControl({ value, onChange }: { value: RuntimeBudgetChoice; onChange: (value: RuntimeBudgetChoice) => void }) {
  const { locale } = useI18n();
  const options: RuntimeBudgetChoice[] = ["low", "medium", "high"];
  return (
    <div className="runtime-budget-control" aria-label={locale === "zh" ? "\u8fd0\u884c\u9884\u7b97" : "Runtime budget"}>
      {options.map((option) => (
        <button aria-pressed={value === option} className={value === option ? "is-active" : ""} key={option} onClick={() => onChange(option)} type="button">
          {budgetLabel(locale, option)}
        </button>
      ))}
    </div>
  );
}

function thinkingLabel(locale: "en" | "zh", choice: ThinkingChoice) {
  const labels = {
    en: { disabled: "Off", high: "High", max: "Max" },
    zh: { disabled: "\u5173", high: "\u9ad8", max: "Max" }
  } as const;
  return labels[locale][choice];
}

function budgetLabel(locale: "en" | "zh", value: RuntimeBudgetChoice) {
  const labels = {
    en: { low: "Low", medium: "Medium", high: "High" },
    zh: { low: "\u4f4e", medium: "\u4e2d", high: "\u9ad8" }
  } as const;
  return labels[locale][value];
}

function modelGroups(locale: "en" | "zh") {
  return [
    { id: "reasoning", label: locale === "zh" ? "\u63a8\u7406\u6a21\u578b" : "Reasoning models" },
    { id: "chat", label: locale === "zh" ? "\u5bf9\u8bdd\u6a21\u578b" : "Chat models" },
    { id: "other-chat", label: locale === "zh" ? "\u5176\u4ed6\u804a\u5929\u6a21\u578b" : "Other chat models" }
  ] as const;
}

function findSkill(skills: SkillCatalogItem[], skillRef: string): SkillCatalogItem {
  return skills.find((skill) => skill.id === skillRef || skill.name === skillRef || skill.relativePath === skillRef) ?? {
    id: skillRef,
    name: skillRef,
    description: "",
    allowedTools: [],
    requiresEnv: [],
    runtimeTools: [],
    originalAllowedTools: [],
    executionMode: "instruction",
    riskLevel: "low",
    folderId: "default",
    folderName: "Default skills",
    folderPath: "default",
    relativePath: skillRef,
    source: "project",
    manageable: true,
    status: "available"
  };
}

function skillText(locale: "en" | "zh", key: "disabledSkill" | "removeSkill" | "restoreSkill" | "selectedSkills" | "skills", value?: string) {
  if (key === "removeSkill") return locale === "zh" ? `\u79fb\u9664\u6280\u80fd ${value ?? ""}` : `Remove skill ${value ?? ""}`;
  if (key === "restoreSkill") return locale === "zh" ? `\u6062\u590d\u6280\u80fd ${value ?? ""}` : `Restore skill ${value ?? ""}`;
  if (key === "disabledSkill") return locale === "zh" ? `\u5df2\u7981\u7528 ${value ?? ""}` : `Disabled ${value ?? ""}`;
  const copy = {
    en: {
      skills: "Skills",
      selectedSkills: "Selected skills"
    },
    zh: {
      skills: "\u6280\u80fd",
      selectedSkills: "\u5df2\u9009\u6280\u80fd"
    }
  } as const;
  return copy[locale][key];
}
