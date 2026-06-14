import type { GenerateRequest } from "../../generation/types";
import { useI18n } from "../../i18n/I18nProvider";

type ToolKey = NonNullable<GenerateRequest["toolState"]> extends Partial<Record<infer Key, boolean>> ? Key : never;

type CommandBarProps = {
  allowedTools: string[];
  toolState: GenerateRequest["toolState"];
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
};

const toolLabels: Record<string, { en: string; zh: string }> = {
  web_search: { en: "Web", zh: "联网" },
  knowledge_base: { en: "Knowledge", zh: "知识库" },
  clear_context: { en: "Clear", zh: "清除上下文" }
};

export function CommandBar({ allowedTools, toolState, onToolStateChange }: CommandBarProps) {
  const { locale } = useI18n();

  const toggle = (tool: string) => {
    const key = tool as ToolKey;
    onToolStateChange({ ...toolState, [key]: !toolState?.[key] });
  };

  return (
    <div className="command-bar" aria-label="Tool use command bar">
      <div className="command-bar-label">
        <span>{locale === "zh" ? "ToolUse" : "ToolUse"}</span>
        <small>{locale === "zh" ? "当前 Agent 可用工具" : "Tools allowed by this AgentCard"}</small>
      </div>
      <div className="command-tools">
        {allowedTools.map((tool) => (
          <button
            className={`chip ${toolState?.[tool as ToolKey] ? "chip-selected" : ""}`}
            key={tool}
            type="button"
            onClick={() => toggle(tool)}
          >
            {toolLabels[tool]?.[locale] ?? tool}
          </button>
        ))}
      </div>
    </div>
  );
}
