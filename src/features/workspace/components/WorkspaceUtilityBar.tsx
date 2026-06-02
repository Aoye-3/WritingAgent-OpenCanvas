import {
  Hand,
  Image,
  FileText,
  MousePointer2,
  Plus,
  Shapes,
  Square,
  Sparkles,
  StickyNote,
  Table2,
  Type,
  type LucideIcon
} from "lucide-react";
import { iconProps } from "../../../shared/icons";
import { useI18n } from "../../i18n/I18nProvider";

type BoardTool = {
  icon: LucideIcon;
  id: string;
  label: { en: string; zh: string };
};

const primaryTools: BoardTool[] = [
  { id: "select", icon: MousePointer2, label: { en: "Select", zh: "选择" } },
  { id: "pan", icon: Hand, label: { en: "Pan", zh: "拖动画布" } }
];

const creationTools: BoardTool[] = [
  { id: "text", icon: Type, label: { en: "Text", zh: "文本" } },
  { id: "document", icon: FileText, label: { en: "Document", zh: "文档" } },
  { id: "note", icon: StickyNote, label: { en: "Note", zh: "便签" } },
  { id: "shape", icon: Square, label: { en: "Shape", zh: "形状" } },
  { id: "table", icon: Table2, label: { en: "Table", zh: "表格" } },
  { id: "asset", icon: Image, label: { en: "Asset", zh: "资源" } },
  { id: "role", icon: Shapes, label: { en: "Role", zh: "角色节点" } },
  { id: "agent", icon: Sparkles, label: { en: "Agent tool", zh: "Agent 工具" } }
];

export function WorkspaceUtilityBar({ promptPreview }: { promptPreview: string }) {
  const { locale } = useI18n();
  const hasPrompt = promptPreview.trim().length > 0;

  return (
    <aside className="board-tool-dock" aria-label={locale === "zh" ? "画板工具栏" : "Board toolbar"}>
      <div className="board-tool-group">
        {primaryTools.map((tool) => (
          <BoardToolButton active={tool.id === "select"} key={tool.id} tool={tool} locale={locale} />
        ))}
      </div>
      <div className="board-tool-divider" aria-hidden="true" />
      <div className="board-tool-group">
        {creationTools.map((tool) => (
          <BoardToolButton disabled={tool.id !== "agent" && tool.id !== "document" && tool.id !== "note"} key={tool.id} tool={tool} locale={locale} />
        ))}
      </div>
      <div className="board-tool-divider" aria-hidden="true" />
      <button
        className="board-tool-button board-tool-add"
        type="button"
        title={locale === "zh" ? "后续增加工具" : "Add tools later"}
        aria-label={locale === "zh" ? "后续增加工具" : "Add tools later"}
      >
        <Plus {...iconProps} size={18} aria-hidden="true" />
      </button>
      {hasPrompt ? <span className="board-tool-status">{locale === "zh" ? "Prompt 已生成" : "Prompt ready"}</span> : null}
    </aside>
  );
}

function BoardToolButton({
  active,
  disabled,
  locale,
  tool
}: {
  active?: boolean;
  disabled?: boolean;
  locale: "en" | "zh";
  tool: BoardTool;
}) {
  const Icon = tool.icon;
  const label = tool.label[locale];

  return (
    <button
      className={`board-tool-button${active ? " is-active" : ""}`}
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon {...iconProps} size={18} aria-hidden="true" />
    </button>
  );
}
