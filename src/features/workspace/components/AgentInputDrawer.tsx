import { ChevronLeftIcon, ChevronRightIcon, StarIcon } from "../../../shared/icons";
import { ChipGroup, IconButton, SelectField, SegmentedControl, TextareaField, TextField } from "../../../shared/ui";
import type { AgentCard, AgentCardField, AgentValues } from "../../agents/types";
import type { Locale } from "../../i18n/types";

type AgentInputDrawerProps = {
  activeAgent: AgentCard;
  agentValues: AgentValues;
  collapsed: boolean;
  locale: Locale;
  onCollapse: () => void;
  onExpand: () => void;
  onValuesChange: (values: AgentValues) => void;
  labels: {
    coreSettings: string;
    customInstruction: string;
    outputSpec: string;
    clear: string;
  };
};

export function AgentInputDrawer({
  activeAgent,
  agentValues,
  collapsed,
  locale,
  onCollapse,
  onExpand,
  onValuesChange,
  labels
}: AgentInputDrawerProps) {
  const updateValue = (id: string, value: string) => {
    onValuesChange({ ...agentValues, [id]: value });
  };

  return (
    <aside className="input-drawer ui-drawer" aria-label="AgentCard structured input drawer" data-collapsed={collapsed}>
      {collapsed ? (
        <button className="drawer-rail drawer-rail-left" type="button" onClick={onExpand} aria-label={locale === "zh" ? "展开 AgentCard 输入" : "Expand AgentCard inputs"}>
          <span>{activeAgent.title[locale].slice(0, 1)}</span>
          <small>AgentCard</small>
          <b><ChevronRightIcon aria-hidden="true" size={18} /></b>
        </button>
      ) : null}

      <div className="drawer-expanded-content" aria-hidden={collapsed}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">AgentCard</p>
            <h2>{activeAgent.title[locale]}</h2>
          </div>
          <div className="drawer-header-actions">
            <IconButton type="button" aria-label={`Favorite ${activeAgent.title[locale]}`}>
              <StarIcon />
            </IconButton>
            <IconButton type="button" onClick={onCollapse} aria-label={locale === "zh" ? "收起左侧栏" : "Collapse left drawer"}>
              <ChevronLeftIcon aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="agent-capability-box ui-panel">
          <span>{activeAgent.skillRefs.join(", ")}</span>
          <p>{activeAgent.description[locale]}</p>
        </div>

        <form className="facet-form">
          <fieldset>
            <legend>{labels.coreSettings}</legend>
            {activeAgent.fields.slice(0, 4).map((field) => renderField(field, agentValues, updateValue, locale))}
          </fieldset>

          <fieldset>
            <legend>{labels.outputSpec}</legend>
            {activeAgent.fields.slice(4, 7).map((field) => renderField(field, agentValues, updateValue, locale))}
          </fieldset>

          <fieldset>
            <legend>{labels.customInstruction}</legend>
            {activeAgent.fields.slice(7).map((field) => renderField(field, agentValues, updateValue, locale))}
          </fieldset>
        </form>

        <div className="drawer-footer">
          <button className="button button-secondary ui-button ui-button-secondary" type="button" onClick={() => onValuesChange(activeAgent.defaultValues)}>
            {labels.clear}
          </button>
        </div>
      </div>
    </aside>
  );
}

function renderField(
  field: AgentCardField,
  values: AgentValues,
  updateValue: (id: string, value: string) => void,
  locale: Locale
) {
  const value = String(values[field.id] ?? "");
  const placeholder = field.placeholder[locale];
  const label = field.label[locale];

  if (field.kind === "textarea") {
    return (
      <TextareaField
        key={field.id}
        label={label}
        placeholder={placeholder}
        required={field.required}
        value={value}
        onChange={(event) => updateValue(field.id, event.target.value)}
      />
    );
  }

  if (field.kind === "select") {
    return (
      <SelectField key={field.id} label={label} required={field.required} value={value} onChange={(event) => updateValue(field.id, event.target.value)}>
        <option value="">{placeholder}</option>
        {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
      </SelectField>
    );
  }

  if (field.kind === "chips" || field.kind === "segmented") {
    const options = field.options?.map((option) => ({ label: option, value: option })) ?? [];
    const Control = field.kind === "segmented" ? SegmentedControl : ChipGroup;
    return (
      <div className="field ui-field" key={field.id}>
        <span>{label}</span>
        <Control ariaLabel={label} options={options} value={value} onChange={(nextValue) => updateValue(field.id, nextValue)} />
        {!value ? <small className="field-hint">{placeholder}</small> : null}
      </div>
    );
  }

  return (
    <TextField
      key={field.id}
      label={label}
      placeholder={placeholder}
      required={field.required}
      value={value}
      onChange={(event) => updateValue(field.id, event.target.value)}
    />
  );
}
