import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Database,
  FileText,
  FolderOpen,
  Home,
  History,
  LayoutDashboard,
  Lightbulb,
  Network,
  ListTree,
  Mail,
  Minus,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from "lucide-react";

export const iconProps = {
  size: 20,
  strokeWidth: 1.75,
  absoluteStrokeWidth: true
} as const;

type IconComponentProps = {
  className?: string;
  size?: number;
  "aria-hidden"?: boolean | "true" | "false";
};

function createIcon(Icon: LucideIcon) {
  return function SharedIcon({ size, ...props }: IconComponentProps) {
    return <Icon {...iconProps} size={size ?? iconProps.size} {...props} />;
  };
}

export const AddIcon = createIcon(Plus);
export const AgentIcon = createIcon(Bot);
export const ArrowLeftIcon = createIcon(ArrowLeft);
export const ArrowRightIcon = createIcon(ArrowRight);
export const BookIcon = createIcon(BookOpen);
export const BrandIcon = createIcon(FileText);
export const CheckIcon = createIcon(Check);
export const ChevronLeftIcon = createIcon(ChevronLeft);
export const ChevronRightIcon = createIcon(ChevronRight);
export const CloseIcon = createIcon(X);
export const DatabaseIcon = createIcon(Database);
export const DocumentIcon = createIcon(FileText);
export const FolderIcon = createIcon(FolderOpen);
export const HomeIcon = createIcon(Home);
export const HistoryIcon = createIcon(History);
export const KnowledgeIcon = createIcon(BookOpen);
export const LightbulbIcon = createIcon(Lightbulb);
export const ModelConfigIcon = createIcon(ListTree);
export const CanvasNodesIcon = createIcon(Network);
export const MoreIcon = createIcon(MoreHorizontal);
export const RemoveIcon = createIcon(Minus);
export const ResetIcon = createIcon(RotateCcw);
export const RuntimeIcon = createIcon(LayoutDashboard);
export const SearchIcon = createIcon(Search);
export const SendIcon = createIcon(Send);
export const SettingsIcon = createIcon(Settings2);
export const SparkleIcon = createIcon(Sparkles);
export const StopIcon = createIcon(Square);
export const StarIcon = createIcon(Star);
export const StatusIcon = createIcon(Circle);
export const TrashIcon = createIcon(Trash2);
export const ArchiveIcon = createIcon(Archive);
export const ZoomInIcon = createIcon(ZoomIn);
export const ZoomOutIcon = createIcon(ZoomOut);

export function HomeSparkleIcon({ className, size = 32, ...props }: IconComponentProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 40 40"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M20 2.75C21.82 11.9 23.6 16.12 31.25 20C23.6 23.88 21.82 28.1 20 37.25C18.18 28.1 16.4 23.88 8.75 20C16.4 16.12 18.18 11.9 20 2.75Z"
        fill="currentColor"
      />
      <path
        d="M20 8.6C21.36 14.8 23.15 17.54 28.45 20C23.15 22.46 21.36 25.2 20 31.4C18.64 25.2 16.85 22.46 11.55 20C16.85 17.54 18.64 14.8 20 8.6Z"
        fill="#78A9FF"
        opacity="0.56"
      />
    </svg>
  );
}

const taskIcons = {
  bot: Bot,
  pen: PenLine,
  lines: ClipboardList,
  mail: Mail,
  book: BookOpen,
  report: FileText,
  refresh: RefreshCcw
} satisfies Record<string, LucideIcon>;

export function TaskIcon({ icon, size = 20 }: { icon: keyof typeof taskIcons; size?: number }) {
  const Icon = taskIcons[icon];
  return <Icon {...iconProps} size={size} aria-hidden="true" />;
}
