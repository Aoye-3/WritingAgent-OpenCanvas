import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../shared/icons";
import { Button, IconButton, SelectField, TextareaField, TextField } from "../../../shared/ui";
import type { BriefSaveStatus, ProjectBrief, TaskBrief } from "../../agents/types";
import type { Locale } from "../../i18n/types";

type AgentInputDrawerProps = {
  collapsed: boolean;
  locale: Locale;
  projectTitle: string;
  projectBrief: ProjectBrief;
  taskBrief: TaskBrief;
  projectBriefStatus: BriefSaveStatus;
  taskBriefStatus: BriefSaveStatus;
  onCollapse: () => void;
  onExpand: () => void;
  onProjectTitleChange: (title: string) => Promise<void>;
  onProjectBriefChange: (brief: ProjectBrief) => void;
  onTaskBriefChange: (brief: TaskBrief) => void;
  onRetryProjectBrief: () => Promise<void>;
  onRetryTaskBrief: () => Promise<void>;
};

export function AgentInputDrawer(props: AgentInputDrawerProps) {
  const {
    collapsed, locale, projectTitle, projectBrief, taskBrief, projectBriefStatus, taskBriefStatus,
    onCollapse, onExpand, onProjectTitleChange, onProjectBriefChange, onTaskBriefChange,
    onRetryProjectBrief, onRetryTaskBrief
  } = props;
  const [projectTitleDraft, setProjectTitleDraft] = useState(projectTitle);

  useEffect(() => setProjectTitleDraft(projectTitle), [projectTitle]);

  const commitProjectTitle = async () => {
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle || nextTitle === projectTitle) {
      setProjectTitleDraft(projectTitle);
      return;
    }
    await onProjectTitleChange(nextTitle);
  };

  const clearProjectBrief = () => {
    const confirmed = window.confirm(locale === "zh" ? "确定清空项目 Brief？这会影响项目中的所有对话。" : "Clear the Project Brief for every conversation in this project?");
    if (confirmed) onProjectBriefChange({});
  };

  return (
    <aside className="input-drawer ui-drawer" aria-label="Project and task Briefs" data-collapsed={collapsed}>
      {collapsed ? (
        <button className="drawer-rail drawer-rail-left" type="button" onClick={onExpand} aria-label={locale === "zh" ? "展开项目面板" : "Expand Project panel"}>
          <span>{projectTitle.slice(0, 1)}</span><small>Briefs</small><b><ChevronRightIcon aria-hidden="true" size={18} /></b>
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
          <TextField label={locale === "zh" ? "项目名称" : "Project name"} maxLength={120} placeholder={locale === "zh" ? "输入项目名称" : "Name this project"} value={projectTitleDraft}
            onBlur={() => { void commitProjectTitle(); }} onChange={(event) => setProjectTitleDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </div>

        <div className="brief-form">
          <BriefSection
            brief={projectBrief}
            defaultOpen={false}
            locale={locale}
            onClear={clearProjectBrief}
            onRetry={onRetryProjectBrief}
            status={projectBriefStatus}
            title="Project Brief"
          >
            <TextField label={locale === "zh" ? "项目目标" : "Project goal"} value={projectBrief.goal ?? ""} onChange={(event) => onProjectBriefChange({ ...projectBrief, goal: event.target.value })} />
            <TextField label={locale === "zh" ? "目标受众" : "Target audience"} value={projectBrief.audience ?? ""} onChange={(event) => onProjectBriefChange({ ...projectBrief, audience: event.target.value })} />
            <TextareaField label={locale === "zh" ? "背景与已知事实" : "Background and known facts"} value={projectBrief.background ?? ""} onChange={(event) => onProjectBriefChange({ ...projectBrief, background: event.target.value })} />
            <TextareaField label={locale === "zh" ? "长期约束与表达原则" : "Standing constraints and expression principles"} value={projectBrief.standingConstraints ?? ""} onChange={(event) => onProjectBriefChange({ ...projectBrief, standingConstraints: event.target.value })} />
          </BriefSection>

          <BriefSection
            brief={taskBrief}
            defaultOpen
            locale={locale}
            onRetry={onRetryTaskBrief}
            status={taskBriefStatus}
            title="Current Task Brief"
          >
            <TextField label={locale === "zh" ? "任务目标" : "Task objective"} value={taskBrief.objective ?? ""} onChange={(event) => onTaskBriefChange({ ...taskBrief, objective: event.target.value })} />
            <SelectField label={locale === "zh" ? "预期交付物" : "Expected deliverable"} value={taskBrief.deliverableType ?? "auto"} onChange={(event) => onTaskBriefChange({ ...taskBrief, deliverableType: event.target.value as TaskBrief["deliverableType"] })}>
              {deliverableOptions(locale).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectField>
            <TextareaField label={locale === "zh" ? "交付物补充说明" : "Deliverable supplemental details"} value={taskBrief.deliverableDetails ?? ""} onChange={(event) => onTaskBriefChange({ ...taskBrief, deliverableDetails: event.target.value })} />
            <TextareaField label={locale === "zh" ? "必须覆盖" : "Must cover"} value={taskBrief.mustCover ?? ""} onChange={(event) => onTaskBriefChange({ ...taskBrief, mustCover: event.target.value })} />
            <TextareaField label={locale === "zh" ? "临时约束与补充要求" : "Temporary constraints and supplemental requirements"} value={taskBrief.temporaryConstraints ?? ""} onChange={(event) => onTaskBriefChange({ ...taskBrief, temporaryConstraints: event.target.value })} />
          </BriefSection>
        </div>

        <div className="drawer-footer">
          <Button type="button" onClick={() => onTaskBriefChange({})}>{locale === "zh" ? "清空当前任务" : "Clear current task"}</Button>
        </div>
      </div>
    </aside>
  );
}

function BriefSection({ brief, children, defaultOpen, locale, onClear, onRetry, status, title }: {
  brief: Record<string, unknown>;
  children: React.ReactNode;
  defaultOpen?: boolean;
  locale: Locale;
  onClear?: () => void;
  onRetry: () => Promise<void>;
  status: BriefSaveStatus;
  title: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const values = Object.values(brief).filter((value) => typeof value === "string" && value.trim());
  return (
    <details className="brief-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><strong>{title}</strong><small>{values.length} {locale === "zh" ? "项已填写" : "filled"}</small></span>
        <em>{String(values[0] ?? (locale === "zh" ? "尚未填写" : "Not filled yet"))}</em>
      </summary>
      <div className="brief-section-body">
        <div className="brief-section-toolbar">
          <SaveStatus locale={locale} onRetry={onRetry} status={status} />
          {onClear ? <button type="button" onClick={onClear}>{locale === "zh" ? "清空项目 Brief" : "Clear Project Brief"}</button> : null}
        </div>
        {children}
      </div>
    </details>
  );
}

function SaveStatus({ locale, onRetry, status }: { locale: Locale; onRetry: () => Promise<void>; status: BriefSaveStatus }) {
  const label = status === "saving"
    ? (locale === "zh" ? "正在保存" : "Saving")
    : status === "saved"
      ? (locale === "zh" ? "已保存" : "Saved")
      : status === "error"
        ? (locale === "zh" ? "保存失败" : "Save failed")
        : (locale === "zh" ? "尚未修改" : "No changes");
  return <span className={`brief-save-status is-${status}`}>{label}{status === "error" ? <button type="button" onClick={() => { void onRetry().catch(() => undefined); }}>{locale === "zh" ? "重试" : "Retry"}</button> : null}</span>;
}

function deliverableOptions(locale: Locale) {
  return [
    { value: "auto", label: locale === "zh" ? "自动判断" : "Auto" },
    { value: "document", label: locale === "zh" ? "文档" : "Document" },
    { value: "outline", label: locale === "zh" ? "大纲" : "Outline" },
    { value: "analysis", label: locale === "zh" ? "分析" : "Analysis" },
    { value: "checklist", label: locale === "zh" ? "清单" : "Checklist" },
    { value: "proposal", label: locale === "zh" ? "方案" : "Proposal" }
  ] as const;
}
