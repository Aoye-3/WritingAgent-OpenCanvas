import type { GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

type ToolKey = NonNullable<GenerateRequest["toolState"]> extends Partial<Record<infer Key, boolean>> ? Key : never;

type CommandBarProps = {
  allowedTools: string[];
  toolState: GenerateRequest["toolState"];
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
};

const toolLabelKeys: Record<string, TranslationKey> = {
  web_search: "workspace.webTool",
  knowledge_base: "workspace.knowledge",
  clear_context: "workspace.clearContext"
};

export function CommandBar({ allowedTools, toolState, onToolStateChange }: CommandBarProps) {
  const { t } = useI18n();

  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="command-bar" aria-label={t("workspace.toolUseCommandBar")}>
      <div className="command-bar-label">
        <span>ToolUse</span>
        <small>{t("workspace.toolsAllowed")}</small>
      </div>
      <div className="command-tools">
        {allowedTools.map((tool) => (
          <button
            className={`chip ${toolState?.[tool as ToolKey] ? "chip-selected" : ""}`}
            key={tool}
            type="button"
            onClick={() => toggle(tool)}
          >
            {toolLabelKeys[tool] ? t(toolLabelKeys[tool]) : tool}
          </button>
        ))}
      </div>
    </div>
  );
}
