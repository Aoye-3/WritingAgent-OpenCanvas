import { useMemo, useState } from "react";
import type { RunTimelineEvent } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

type AssistantRunTraceProps = {
  events?: RunTimelineEvent[];
  planId?: string;
  stepId?: string;
  onFocusNode?: (nodeId: string) => void;
};

export function deriveAssistantRunTraceState(input: {
  events: Array<Pick<RunTimelineEvent, "status" | "eventType" | "sequence">>;
  userExpanded?: boolean;
}) {
  const ordered = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const latestTerminal = [...ordered].reverse().find((event) => /run_(?:completed|failed|waiting)$/.test(event.eventType));
  const failed = latestTerminal
    ? latestTerminal.status === "failed"
    : ordered.some((event) => event.status === "failed");
  const running = latestTerminal
    ? latestTerminal.status === "running" || latestTerminal.status === "waiting"
    : ordered.some((event) => event.status === "running" || event.status === "waiting");
  return {
    expanded: input.userExpanded ?? (failed || running),
    failed,
    running
  };
}

export function formatAssistantRunTraceDetail(event: Pick<RunTimelineEvent, "status" | "payload">) {
  if (event.status !== "failed") return "";
  const payload = event.payload ?? {};
  const detail = readPayloadString(payload.reason)
    || readPayloadString(payload.error)
    || readPayloadString(payload.message);
  const diagnostics = [
    readPayloadString(payload.optionCount) ? `options=${readPayloadString(payload.optionCount)}` : "",
    readPayloadString(payload.optionShape) ? `shape=${readPayloadString(payload.optionShape)}` : "",
    readPayloadString(payload.hasQuestion) ? `hasQuestion=${readPayloadString(payload.hasQuestion)}` : ""
  ].filter(Boolean);
  return [detail, ...diagnostics].filter(Boolean).join(" · ").slice(0, 220);
}

export function filterAssistantRunTraceEvents(events: RunTimelineEvent[], target: { planId?: string; stepId?: string } = {}) {
  return events.filter((event) => {
    if (!isVisibleRunTraceEvent(event)) return false;
    if (!target.planId && !target.stepId) return true;
    const payload = event.payload ?? {};
    const planId = readPayloadString(payload.planId) || readPayloadString(payload.agentPlanId);
    const stepId = readPayloadString(payload.stepId) || readPayloadString(payload.agentPlanStepId);
    if (target.planId && planId !== target.planId) return false;
    if (target.stepId && stepId !== target.stepId) return false;
    return true;
  });
}

function isVisibleRunTraceEvent(event: Pick<RunTimelineEvent, "eventType" | "status" | "payload">) {
  if (event.payload?.kind === "progress_report") return false;
  if (event.status === "failed" || event.status === "waiting") return true;
  return event.eventType === "phase_started"
    || event.eventType === "decision"
    || event.eventType === "canvas_node_committed"
    || event.eventType === "artifact_committed"
    || event.eventType === "run_completed"
    || event.eventType === "run_failed";
}

export function AssistantRunTrace({ events = [], planId, stepId, onFocusNode }: AssistantRunTraceProps) {
  const { t } = useI18n();
  const [userExpanded, setUserExpanded] = useState<boolean | undefined>();
  const orderedEvents = useMemo(
    () => filterAssistantRunTraceEvents(events, { planId, stepId }).sort((left, right) => left.sequence - right.sequence),
    [events, planId, stepId]
  );
  const state = deriveAssistantRunTraceState({ events: orderedEvents, userExpanded });
  if (!orderedEvents.length) return null;

  const latest = orderedEvents.at(-1);
  const countLabel = t("workspace.runTraceSteps", { count: orderedEvents.length });

  return (
    <section className="assistant-run-trace" data-expanded={state.expanded}>
      <button
        aria-expanded={state.expanded}
        className="assistant-run-trace-summary"
        type="button"
        onClick={() => setUserExpanded((value) => !(value ?? state.expanded))}
      >
        <span className={state.failed ? "status-dot failed" : state.running ? "status-dot running" : "status-dot"} aria-hidden="true" />
        <strong>{t("workspace.runTrace")}</strong>
        <small>{latest?.title || countLabel}</small>
        <b aria-hidden="true">{state.expanded ? "^" : "v"}</b>
      </button>
      {state.expanded ? (
        <div className="assistant-run-trace-list">
          {orderedEvents.map((event) => {
            const nodeId = typeof event.payload?.nodeId === "string" ? event.payload.nodeId : "";
            const detail = formatAssistantRunTraceDetail(event);
            return (
              <article className="assistant-run-trace-item" key={event.id}>
                <span className={event.status === "failed" ? "status-dot failed" : event.status === "completed" ? "status-dot" : "status-dot running"} aria-hidden="true" />
                <div>
                  <strong>{event.title}</strong>
                  {event.summary ? <p>{event.summary}</p> : null}
                  {detail ? <small>{detail}</small> : null}
                  {nodeId && onFocusNode ? (
                    <button type="button" onClick={() => onFocusNode(nodeId)}>
                      {t("workspace.focusNode")}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function readPayloadString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
