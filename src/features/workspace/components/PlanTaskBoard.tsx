import { useState } from "react";
import type { PlanRun, PlanStepStatus } from "../../agents/types";
import { approvePlan, cancelPlan, retryPlanStep } from "../../agents/agentClient";
import { useI18n } from "../../i18n/I18nProvider";

export function PlanTaskBoard({ plan, threadId, onChanged, onRevise, onFocusArtifact }: {
  plan: PlanRun;
  threadId: string;
  onChanged: () => Promise<void>;
  onRevise: (plan: PlanRun) => void;
  onFocusArtifact: (targetId: string) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const completed = plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await onChanged(); } finally { setBusy(false); }
  };

  return <section className="plan-task-board" data-plan-status={plan.status}>
    <button className="plan-task-board-header" type="button" onClick={() => setCollapsed((value) => !value)}>
      <strong>{completed}/{plan.steps.length} {completed === plan.steps.length ? t("plan.completed") : t("plan.progress")}</strong>
      <span>{collapsed ? "+" : "-"}</span>
    </button>
    {!collapsed ? <div className="plan-task-board-body">
      <h4>{plan.title}</h4>
      <p>{plan.goal}</p>
      <ol>{plan.steps.map((step) => <li className={`plan-step is-${step.status}`} key={step.id}>
        <span className="plan-step-state">{stepIcon(step.status)}</span>
        <div><strong>{step.title}</strong>{step.detail ? <small>{step.detail}</small> : null}{step.error ? <small className="is-error">{step.error}</small> : null}</div>
        {step.status === "failed" ? <button disabled={busy} type="button" onClick={() => void act(() => retryPlanStep(threadId, plan.id, step.id))}>{t("common.retry")}</button> : null}
      </li>)}</ol>
      {plan.artifacts.length ? <div className="plan-artifacts">{plan.artifacts.map((artifact) => <button key={artifact.id} disabled={!artifact.canvasTargetId} type="button" onClick={() => artifact.canvasTargetId && onFocusArtifact(artifact.canvasTargetId)}>{artifact.type === "image" ? "Image" : "Text"}: {artifact.title}</button>)}</div> : null}
      {plan.statusMessage ? <p className="plan-status-message">{plan.statusMessage}</p> : null}
      {plan.status === "awaiting_approval" ? <div className="plan-actions">
        <button disabled={busy} type="button" onClick={() => void act(() => approvePlan(threadId, plan.id))}>{t("plan.confirmAndRun")}</button>
        <button disabled={busy} type="button" onClick={() => onRevise(plan)}>{t("plan.modifyPlan")}</button>
        <button disabled={busy} type="button" onClick={() => void act(() => cancelPlan(threadId, plan.id))}>{t("common.cancel")}</button>
      </div> : null}
    </div> : null}
  </section>;
}

function stepIcon(status: PlanStepStatus) {
  if (status === "completed" || status === "skipped") return "ok";
  if (status === "running") return "...";
  if (status === "failed") return "!";
  return "-";
}
