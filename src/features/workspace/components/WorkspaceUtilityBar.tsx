import {
  ArrowUpRight,
  BookOpen,
  FileText,
  Hand,
  Image,
  MousePointer2,
  Plus,
  Sparkles,
  Square,
  StickyNote,
  Table2,
  Type,
  UserRoundCog,
  type LucideIcon
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { iconProps } from "../../../shared/icons";
import { useI18n } from "../../i18n/I18nProvider";
import type { CanvasTool } from "./canvas/toolState";

type BoardTool = {
  icon: LucideIcon;
  id: CanvasTool;
  label: { en: string; zh: string };
};

const primaryTools: BoardTool[] = [
  { id: "select", icon: MousePointer2, label: { en: "Select", zh: "选择" } },
  { id: "pan", icon: Hand, label: { en: "Pan", zh: "拖动画布" } }
];

const nodeTools: BoardTool[] = [
  { id: "reference", icon: BookOpen, label: { en: "Reference", zh: "引用" } },
  { id: "document", icon: FileText, label: { en: "Document", zh: "文档" } },
  { id: "note", icon: StickyNote, label: { en: "Note", zh: "便签" } },
  { id: "role", icon: UserRoundCog, label: { en: "Role", zh: "角色节点" } }
];

const otherTools: BoardTool[] = [
  { id: "text", icon: Type, label: { en: "Text", zh: "自由文本" } },
  { id: "arrow", icon: ArrowUpRight, label: { en: "Arrow", zh: "箭头" } },
  { id: "shape", icon: Square, label: { en: "Shape", zh: "形状" } },
  { id: "table", icon: Table2, label: { en: "Table", zh: "表格" } },
  { id: "asset", icon: Image, label: { en: "Asset", zh: "资源" } },
  { id: "agent", icon: Sparkles, label: { en: "Agent tool", zh: "Agent 工具" } }
];

export function WorkspaceUtilityBar({
  activeTool,
  onToolChange,
  promptPreview
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  promptPreview: string;
}) {
  const { locale } = useI18n();
  const reduceMotion = useReducedMotion();
  const hasPrompt = promptPreview.trim().length > 0;
  const dockTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 32 };

  return (
    <motion.aside
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="board-tool-dock"
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      transition={dockTransition}
      aria-label={locale === "zh" ? "画板工具栏" : "Board toolbar"}
    >
      <motion.div className="board-tool-group" layout transition={dockTransition}>
        {primaryTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} locale={locale} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.div className="board-tool-group" data-testid="board-node-tools" layout transition={dockTransition}>
        {nodeTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} locale={locale} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.div className="board-tool-group" data-testid="board-other-tools" layout transition={dockTransition}>
        {otherTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} locale={locale} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.button
        className="board-tool-button board-tool-add"
        type="button"
        title={locale === "zh" ? "后续增加工具" : "Add tools later"}
        aria-label={locale === "zh" ? "后续增加工具" : "Add tools later"}
        whileTap={reduceMotion ? undefined : { scale: 0.96 }}
      >
        <Plus {...iconProps} size={18} aria-hidden="true" />
      </motion.button>
      <AnimatePresence>
        {hasPrompt ? (
          <motion.span
            animate={{ opacity: 1, width: "auto" }}
            className="board-tool-status"
            exit={{ opacity: 0, width: 0 }}
            initial={reduceMotion ? false : { opacity: 0, width: 0 }}
            transition={dockTransition}
          >
            {locale === "zh" ? "Prompt 已生成" : "Prompt ready"}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  );
}

function BoardToolButton({ active, locale, onClick, tool }: { active?: boolean; locale: "en" | "zh"; onClick: (tool: CanvasTool) => void; tool: BoardTool }) {
  const Icon = tool.icon;
  const label = tool.label[locale];
  return (
    <motion.button
      className={`board-tool-button${active ? " is-active" : ""}`}
      layout
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onClick(tool.id)}
      whileHover={active ? undefined : { y: -1 }}
      whileTap={{ scale: 0.96 }}
    >
      {active ? <motion.span className="board-tool-active-indicator" layoutId="board-tool-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
      <Icon {...iconProps} size={18} aria-hidden="true" />
    </motion.button>
  );
}
