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
import type { TranslationKey } from "../../i18n/translations";
import type { CanvasTool } from "./canvas/toolState";

type BoardTool = {
  icon: LucideIcon;
  id: CanvasTool;
  labelKey: TranslationKey;
};

const primaryTools: BoardTool[] = [
  { id: "select", icon: MousePointer2, labelKey: "boardTool.select" },
  { id: "pan", icon: Hand, labelKey: "boardTool.pan" }
];

const nodeTools: BoardTool[] = [
  { id: "reference", icon: BookOpen, labelKey: "boardTool.reference" },
  { id: "document", icon: FileText, labelKey: "boardTool.document" },
  { id: "note", icon: StickyNote, labelKey: "boardTool.note" },
  { id: "role", icon: UserRoundCog, labelKey: "boardTool.role" }
];

const otherTools: BoardTool[] = [
  { id: "text", icon: Type, labelKey: "boardTool.text" },
  { id: "arrow", icon: ArrowUpRight, labelKey: "boardTool.arrow" },
  { id: "shape", icon: Square, labelKey: "boardTool.shape" },
  { id: "table", icon: Table2, labelKey: "boardTool.table" },
  { id: "asset", icon: Image, labelKey: "boardTool.asset" },
  { id: "agent", icon: Sparkles, labelKey: "boardTool.agent" }
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
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const hasPrompt = promptPreview.trim().length > 0;
  const dockTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 32 };

  return (
    <motion.aside
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="board-tool-dock"
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      transition={dockTransition}
      aria-label={t("workspace.boardToolbar")}
    >
      <motion.div className="board-tool-group" layout transition={dockTransition}>
        {primaryTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.div className="board-tool-group" data-testid="board-node-tools" layout transition={dockTransition}>
        {nodeTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.div className="board-tool-group" data-testid="board-other-tools" layout transition={dockTransition}>
        {otherTools.map((tool) => <BoardToolButton active={tool.id === activeTool} key={tool.id} tool={tool} onClick={onToolChange} />)}
      </motion.div>
      <div className="board-tool-divider" aria-hidden="true" />
      <motion.button
        className="board-tool-button board-tool-add"
        type="button"
        title={t("workspace.addToolsLater")}
        aria-label={t("workspace.addToolsLater")}
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
            {t("workspace.promptReady")}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  );
}

function BoardToolButton({ active, onClick, tool }: { active?: boolean; onClick: (tool: CanvasTool) => void; tool: BoardTool }) {
  const { t } = useI18n();
  const Icon = tool.icon;
  const label = t(tool.labelKey);
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
