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
  LayoutDashboard,
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

export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="FacetWrite">
      <path d="M6.5 4.5h8.2l2.8 2.8v12.2h-11z" />
      <path d="M14.5 4.7v3.1h3.1" />
      <path d="M9.1 10.2h5.8" />
      <path d="M9.1 13.4h4.4" />
      <path d="M9.1 16.6h6" />
    </svg>
  );
}

export const AddIcon = createIcon(Plus);
export const AgentIcon = createIcon(Bot);
export const ArrowLeftIcon = createIcon(ArrowLeft);
export const ArrowRightIcon = createIcon(ArrowRight);
export const BookIcon = createIcon(BookOpen);
export const CheckIcon = createIcon(Check);
export const ChevronLeftIcon = createIcon(ChevronLeft);
export const ChevronRightIcon = createIcon(ChevronRight);
export const CloseIcon = createIcon(X);
export const DatabaseIcon = createIcon(Database);
export const DocumentIcon = createIcon(FileText);
export const FolderIcon = createIcon(FolderOpen);
export const HomeIcon = createIcon(Home);
export const KnowledgeIcon = createIcon(BookOpen);
export const ModelConfigIcon = createIcon(ListTree);
export const MoreIcon = createIcon(MoreHorizontal);
export const RemoveIcon = createIcon(Minus);
export const ResetIcon = createIcon(RotateCcw);
export const RuntimeIcon = createIcon(LayoutDashboard);
export const SearchIcon = createIcon(Search);
export const SendIcon = createIcon(Send);
export const SettingsIcon = createIcon(Settings2);
export const SparkleIcon = createIcon(Sparkles);
export const StarIcon = createIcon(Star);
export const StatusIcon = createIcon(Circle);
export const TrashIcon = createIcon(Trash2);
export const ArchiveIcon = createIcon(Archive);
export const ZoomInIcon = createIcon(ZoomIn);
export const ZoomOutIcon = createIcon(ZoomOut);

const taskIcons = {
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
