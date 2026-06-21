import { useEffect, useRef, useState } from "react";
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
import type { SkillCatalogItem, SkillFolderItem } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { SkillFolderPicker } from "./SkillFolderPicker";
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
  activeSkillRefs,
  activeTool,
  disabledSkillRefs,
  enabledSkillRefs,
  locale,
  onToolChange,
  onCreateSkillFolder,
  onDeleteSkillFolder,
  onMoveSkillToFolder,
  onRequestSkillCatalog,
  onRenameSkillFolder,
  onToggleSkill,
  skillCatalog,
  skillFolders,
  skillCatalogStatus,
  promptPreview
}: {
  activeSkillRefs: string[];
  activeTool: CanvasTool;
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  locale: "en" | "zh";
  onCreateSkillFolder: (folderId: string) => Promise<void>;
  onDeleteSkillFolder: (folderId: string) => Promise<void>;
  onMoveSkillToFolder: (skill: SkillCatalogItem, folderId: string) => Promise<void>;
  onToolChange: (tool: CanvasTool) => void;
  onRequestSkillCatalog: () => void;
  onRenameSkillFolder: (folderId: string, nextFolderId: string) => Promise<void>;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
  promptPreview: string;
  skillCatalog: SkillCatalogItem[];
  skillFolders: SkillFolderItem[];
  skillCatalogStatus: "idle" | "loading" | "ready" | "error";
}) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const hasPrompt = promptPreview.trim().length > 0;
  const hasSkillOverrides = enabledSkillRefs.length > 0 || disabledSkillRefs.length > 0;
  const dockTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 32 };

  useEffect(() => {
    if (!skillMenuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSkillMenuOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && skillPickerRef.current?.contains(event.target)) return;
      setSkillMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [skillMenuOpen]);

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
      <div className="board-tool-skill-picker" ref={skillPickerRef}>
        <motion.button
          aria-expanded={skillMenuOpen}
          className={`board-tool-button board-tool-add${hasSkillOverrides || skillMenuOpen ? " is-active" : ""}`}
          type="button"
          title={skillLabel(locale, "skills")}
          aria-label={skillLabel(locale, "skills")}
          onClick={() => {
            setSkillMenuOpen((open) => !open);
            onRequestSkillCatalog();
          }}
          whileTap={reduceMotion ? undefined : { scale: 0.96 }}
        >
          <Plus {...iconProps} size={18} aria-hidden="true" />
        </motion.button>
        <AnimatePresence>
          {skillMenuOpen ? (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="board-skill-menu"
              data-testid="toolbar-skill-picker"
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              role="dialog"
              transition={dockTransition}
            >
              <header>
                <strong>{skillLabel(locale, "skills")}</strong>
                <small>{skillLabel(locale, "hint")}</small>
              </header>
              <SkillFolderPicker
                activeSkillRefs={activeSkillRefs}
                disabledSkillRefs={disabledSkillRefs}
                enabledSkillRefs={enabledSkillRefs}
                folders={skillFolders}
                locale={locale}
                onCreateFolder={onCreateSkillFolder}
                onDeleteFolder={onDeleteSkillFolder}
                onMoveSkill={onMoveSkillToFolder}
                onRenameFolder={onRenameSkillFolder}
                skills={skillCatalog}
                status={skillCatalogStatus}
                onToggleSkill={onToggleSkill}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
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

function skillLabel(locale: "en" | "zh", key: "hint" | "skills") {
  const labels = {
    en: {
      hint: "Enable or disable skills for the next message.",
      skills: "Skills"
    },
    zh: {
      hint: "\u4e3a\u4e0b\u4e00\u6761\u6d88\u606f\u542f\u7528\u6216\u7981\u7528\u6280\u80fd\u3002",
      skills: "\u6280\u80fd"
    }
  } as const;
  return labels[locale][key];
}

function BoardToolButton({ active, onClick, tool }: { active?: boolean; onClick: (tool: CanvasTool) => void; tool: BoardTool }) {
  const { t } = useI18n();
  const Icon = tool.icon;
  const label = t(tool.labelKey);
  const nextTool = active && tool.id !== "select" ? "select" : tool.id;
  return (
    <motion.button
      className={`board-tool-button${active ? " is-active" : ""}`}
      layout
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onClick(nextTool)}
      whileHover={active ? undefined : { y: -1 }}
      whileTap={{ scale: 0.96 }}
    >
      {active ? <motion.span className="board-tool-active-indicator" layoutId="board-tool-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
      <Icon {...iconProps} size={18} aria-hidden="true" />
    </motion.button>
  );
}
