import { useState } from "react";
import type { PlanRun, PlanStepStatus } from "../../agents/types";
import { approvePlan, cancelPlan, retryPlanStep } from "../../agents/agentClient";
import { useI18n } from "../../i18n/I18nProvider";

export function AgentPlanBoard({ plan, threadId, onChanged, onRevise, onFocusArtifact }: {
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
  const currentStep = currentPlanStep(plan);
  const phase = readPlanPhase(plan.preflight) || phaseFromStatus(plan.status);
  const budgetLabel = readBudgetLabel(plan.budget);
  const preflightSummary = readPreflightSummary(plan.preflight);
  const originLabel = plan.origin ? originDisplay(plan.origin) : "AgentPlan";
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await onChanged(); } finally { setBusy(false); }
  };

  return <section className="plan-task-board" data-plan-status={plan.status}>
    <button className="plan-task-board-header" type="button" onClick={() => setCollapsed((value) => !value)}>
      <strong>{completed}/{plan.steps.length} {completed === plan.steps.length ? t("plan.completed") : t("plan.progress")}</strong>
      <small>{originLabel} · {phase}{budgetLabel ? ` · ${budgetLabel}` : ""}</small>
      <span>{collapsed ? "+" : "-"}</span>
    </button>
    {!collapsed ? <div className="plan-task-board-body">
      <h4>{plan.title}</h4>
      <p>{plan.goal}</p>
      {preflightSummary ? <p className="agent-plan-preflight">{preflightSummary}</p> : null}
      {currentStep ? <p className="agent-plan-current-step">{currentStepLabel(plan, currentStep.id)}: {currentStep.title}</p> : null}
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

function currentPlanStep(plan: PlanRun) {
  return plan.steps.find((step) => step.id === plan.currentStepId)
    ?? plan.steps.find((step) => step.status === "running")
    ?? plan.steps.find((step) => step.status === "failed")
    ?? plan.steps.find((step) => step.status === "pending");
}

function currentStepLabel(plan: PlanRun, stepId: string) {
  const index = plan.steps.findIndex((step) => step.id === stepId);
  return index >= 0 ? `Step ${index + 1}/${plan.steps.length}` : "Current step";
}

function originDisplay(origin: PlanRun["origin"]) {
  if (origin === "explicit_plan") return "Plan";
  if (origin === "approved_execution") return "Approved run";
  return "AgentPlan";
}

function phaseFromStatus(status: PlanRun["status"]) {
  if (status === "awaiting_user") return "clarification";
  if (status === "awaiting_approval") return "planning";
  if (status === "running") return "execution";
  if (status === "completed") return "completed";
  if (status === "failed") return "recovery";
  return status;
}

function readPlanPhase(value: unknown) {
  const record = asRecord(value);
  const phase = readString(record.phase);
  return phase || readString(record.status);
}

function readBudgetLabel(value: unknown) {
  const record = asRecord(value);
  const profile = readString(record.profile) || readString(record.runtimeBudgetProfile) || readString(record.level);
  return profile ? `budget ${profile}` : "";
}

function readPreflightSummary(value: unknown) {
  const record = asRecord(value);
  return readString(record.summary) || readString(record.taskUnderstanding) || readString(record.task);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stepIcon(status: PlanStepStatus) {
  if (status === "completed" || status === "skipped") return "ok";
  if (status === "running") return "...";
  if (status === "failed") return "!";
  return "-";
}
