import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../shared/icons";
import { ChipGroup, IconButton, SelectField, SegmentedControl, TextareaField, TextField } from "../../../shared/ui";
import type { AgentCard, AgentCardField, AgentValues } from "../../agents/types";
import type { Locale } from "../../i18n/types";
import type { ConfiguredModelApiSummary } from "../../settings/types";

type AgentInputDrawerProps = {
  activeAgent: AgentCard;
  agentValues: AgentValues;
  collapsed: boolean;
  locale: Locale;
  projectTitle: string;
  configuredModels: ConfiguredModelApiSummary[];
  selectedModelConfigId?: string | null;
  onCollapse: () => void;
  onExpand: () => void;
  onProjectTitleChange: (title: string) => Promise<void>;
  onSelectModel: (configuredModelApiId: string) => Promise<void>;
  onValuesChange: (values: AgentValues) => void;
  labels: {
    coreSettings: string;
    customInstruction: string;
    outputSpec: string;
    clear: string;
    projectName: string;
    projectNamePlaceholder: string;
  };
};

export function AgentInputDrawer(props: AgentInputDrawerProps) {
  const {
    activeAgent, agentValues, collapsed, locale, projectTitle, configuredModels,
    selectedModelConfigId, onCollapse, onExpand, onProjectTitleChange, onSelectModel, onValuesChange, labels
  } = props;
  const [projectTitleDraft, setProjectTitleDraft] = useState(projectTitle);

  useEffect(() => setProjectTitleDraft(projectTitle), [projectTitle]);

  const updateValue = (id: string, value: string) => onValuesChange({ ...agentValues, [id]: value });
  const commitProjectTitle = async () => {
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle || nextTitle === projectTitle) {
      setProjectTitleDraft(projectTitle);
      return;
    }
    await onProjectTitleChange(nextTitle);
  };

  return (
    <aside className="input-drawer ui-drawer" aria-label="Project settings and structured inputs" data-collapsed={collapsed}>
      {collapsed ? (
        <button className="drawer-rail drawer-rail-left" type="button" onClick={onExpand} aria-label={locale === "zh" ? "展开项目面板" : "Expand Project panel"}>
          <span>{projectTitle.slice(0, 1)}</span><small>Project</small><b><ChevronRightIcon aria-hidden="true" size={18} /></b>
        </button>
      ) : null}

      <div className="drawer-expanded-content" aria-hidden={collapsed}>
        <div className="drawer-header">
          <div><p className="eyebrow">Project</p><h2>{projectTitle}</h2></div>
          <IconButton type="button" onClick={onCollapse} aria-label={locale === "zh" ? "收起左侧栏" : "Collapse left drawer"}>
            <ChevronLeftIcon aria-hidden="true" />
          </IconButton>
        </div>

        <div className="drawer-project-name">
          <TextField label={labels.projectName} maxLength={120} placeholder={labels.projectNamePlaceholder} value={projectTitleDraft}
            onBlur={() => { void commitProjectTitle(); }} onChange={(event) => setProjectTitleDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </div>

        <section className="project-model-settings" aria-label={locale === "zh" ? "会话模型" : "Conversation model"}>
          <SelectField label={locale === "zh" ? "会话模型" : "Conversation model"} value={selectedModelConfigId ?? ""}
            onChange={(event) => { void onSelectModel(event.target.value); }}>
            <option value="">{locale === "zh" ? "生成前请选择模型" : "Select a model before generating"}</option>
            {modelGroups(locale).map((group) => {
              const models = configuredModels.filter((model) => model.capabilityGroup === group.id);
              return models.length ? <optgroup key={group.id} label={group.label}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.providerLabel} / {model.modelName}</option>)}
              </optgroup> : null;
            })}
          </SelectField>
        </section>

        <form className="facet-form">
          <p className="agent-parameter-heading">{locale === "zh" ? `${activeAgent.title[locale]} 参数` : `${activeAgent.title[locale]} parameters`}</p>
          <fieldset><legend>{labels.coreSettings}</legend>{activeAgent.fields.slice(0, 4).map((field) => renderField(field, agentValues, updateValue, locale))}</fieldset>
          <fieldset><legend>{labels.outputSpec}</legend>{activeAgent.fields.slice(4, 7).map((field) => renderField(field, agentValues, updateValue, locale))}</fieldset>
          <fieldset><legend>{labels.customInstruction}</legend>{activeAgent.fields.slice(7).map((field) => renderField(field, agentValues, updateValue, locale))}</fieldset>
        </form>

        <div className="drawer-footer"><button className="button button-secondary ui-button ui-button-secondary" type="button" onClick={() => onValuesChange(activeAgent.defaultValues)}>{labels.clear}</button></div>
      </div>
    </aside>
  );
}

function modelGroups(locale: Locale) {
  return [
    { id: "reasoning", label: locale === "zh" ? "推理模型" : "Reasoning models" },
    { id: "chat", label: locale === "zh" ? "对话模型" : "Chat models" },
    { id: "other-chat", label: locale === "zh" ? "其他聊天模型" : "Other chat models" }
  ] as const;
}

function renderField(field: AgentCardField, values: AgentValues, updateValue: (id: string, value: string) => void, locale: Locale) {
  const value = String(values[field.id] ?? "");
  const placeholder = field.placeholder[locale];
  const label = field.label[locale];
  if (field.kind === "textarea") return <TextareaField key={field.id} label={label} placeholder={placeholder} required={field.required} value={value} onChange={(event) => updateValue(field.id, event.target.value)} />;
  if (field.kind === "select") return <SelectField key={field.id} label={label} required={field.required} value={value} onChange={(event) => updateValue(field.id, event.target.value)}><option value="">{placeholder}</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</SelectField>;
  if (field.kind === "chips" || field.kind === "segmented") {
    const options = field.options?.map((option) => ({ label: option, value: option })) ?? [];
    const Control = field.kind === "segmented" ? SegmentedControl : ChipGroup;
    return <div className="field ui-field" key={field.id}><span>{label}</span><Control ariaLabel={label} options={options} value={value} onChange={(nextValue) => updateValue(field.id, nextValue)} />{!value ? <small className="field-hint">{placeholder}</small> : null}</div>;
  }
  return <TextField key={field.id} label={label} placeholder={placeholder} required={field.required} value={value} onChange={(event) => updateValue(field.id, event.target.value)} />;
}
