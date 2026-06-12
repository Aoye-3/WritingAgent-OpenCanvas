import { useState } from "react";
import type { PlanRun } from "../../agents/types";
import { approvePlan, cancelPlan, retryPlanStep } from "../../agents/agentClient";
import { useI18n } from "../../i18n/I18nProvider";

export function PlanTaskBoard({ plan, threadId, onChanged, onContinue, onRevise, onFocusArtifact }: {
  plan: PlanRun;
  threadId: string;
  onChanged: () => Promise<void>;
  onContinue: (plan: PlanRun) => Promise<void>;
  onRevise: (plan: PlanRun) => void;
  onFocusArtifact: (targetId: string) => void;
}) {
  const { locale } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const completed = plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await onChanged(); } finally { setBusy(false); }
  };

  return <section className="plan-task-board" data-plan-status={plan.status}>
    <button className="plan-task-board-header" type="button" onClick={() => setCollapsed((value) => !value)}>
      <strong>{completed}/{plan.steps.length} {completed === plan.steps.length ? (locale === "zh" ? "已完成" : "Completed") : "Plan"}</strong>
      <span>{collapsed ? "+" : "-"}</span>
    </button>
    {!collapsed ? <div className="plan-task-board-body">
      <h4>{plan.title}</h4>
      <p>{plan.goal}</p>
      <ol>{plan.steps.map((step) => <li className={`plan-step is-${step.status}`} key={step.id}>
        <span className="plan-step-state">{step.status === "completed" ? "OK" : step.status === "running" ? ">" : step.status === "failed" ? "!" : "-"}</span>
        <div><strong>{step.title}</strong>{step.detail ? <small>{step.detail}</small> : null}{step.error ? <small className="is-error">{step.error}</small> : null}</div>
        {step.status === "failed" ? <button disabled={busy} type="button" onClick={() => void act(async () => { await retryPlanStep(threadId, plan.id, step.id); await onContinue(plan); })}>{locale === "zh" ? "重试" : "Retry"}</button> : null}
      </li>)}</ol>
      {plan.artifacts.length ? <div className="plan-artifacts">{plan.artifacts.map((artifact) => <button key={artifact.id} disabled={!artifact.canvasTargetId} type="button" onClick={() => artifact.canvasTargetId && onFocusArtifact(artifact.canvasTargetId)}>{artifact.type === "image" ? "Image" : "Text"}: {artifact.title}</button>)}</div> : null}
      {plan.statusMessage ? <p className="plan-status-message">{plan.statusMessage}</p> : null}
      {plan.status === "awaiting_approval" ? <div className="plan-actions">
        <button disabled={busy} type="button" onClick={() => void act(async () => { const approved = await approvePlan(threadId, plan.id); await onContinue(approved); })}>{locale === "zh" ? "确认执行" : "Confirm and run"}</button>
        <button disabled={busy} type="button" onClick={() => onRevise(plan)}>{locale === "zh" ? "修改计划" : "Modify plan"}</button>
        <button disabled={busy} type="button" onClick={() => void act(() => cancelPlan(threadId, plan.id))}>{locale === "zh" ? "取消" : "Cancel"}</button>
      </div> : null}
      {plan.status === "running" && !plan.steps.some((step) => step.status === "running") && plan.steps.some((step) => step.status === "pending" || step.status === "failed") ? <div className="plan-actions">
        <button disabled={busy} type="button" onClick={() => void act(() => onContinue(plan))}>{locale === "zh" ? "继续下一步" : "Continue next step"}</button>
      </div> : null}
    </div> : null}
  </section>;
}
