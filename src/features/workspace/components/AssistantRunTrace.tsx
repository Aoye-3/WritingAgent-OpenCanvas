import { useMemo, useState } from "react";
import type { RunTimelineEvent } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

type AssistantRunTraceProps = {
  events?: RunTimelineEvent[];
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

export function AssistantRunTrace({ events = [], onFocusNode }: AssistantRunTraceProps) {
  const { t } = useI18n();
  const [userExpanded, setUserExpanded] = useState<boolean | undefined>();
  const orderedEvents = useMemo(
    () => [...events].sort((left, right) => left.sequence - right.sequence),
    [events]
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
