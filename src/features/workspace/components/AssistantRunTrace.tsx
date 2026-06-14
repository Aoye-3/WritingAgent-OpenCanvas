import { useMemo, useState } from "react";
import type { RunTimelineEvent } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

type AssistantRunTraceProps = {
  events?: RunTimelineEvent[];
  onFocusNode?: (nodeId: string) => void;
};

export function deriveAssistantRunTraceState(input: {
  events: Array<Pick<RunTimelineEvent, "status">>;
  userExpanded?: boolean;
}) {
  const failed = input.events.some((event) => event.status === "failed");
  const running = input.events.some((event) => event.status === "running" || event.status === "waiting");
  return {
    expanded: input.userExpanded ?? (failed || running),
    failed,
    running
  };
}

export function visibleAssistantRunTraceEvents<T extends Pick<RunTimelineEvent, "eventType" | "title"> & { payload?: Record<string, unknown> }>(events: T[]) {
  return events.filter((event) => !isLowSignalToolEvent(event));
}

export function AssistantRunTrace({ events = [], onFocusNode }: AssistantRunTraceProps) {
  const { locale } = useI18n();
  const [userExpanded, setUserExpanded] = useState<boolean | undefined>();
  const orderedEvents = useMemo(
    () => visibleAssistantRunTraceEvents([...events].sort((left, right) => left.sequence - right.sequence)),
    [events]
  );
  const state = deriveAssistantRunTraceState({ events: orderedEvents, userExpanded });
  if (!orderedEvents.length) return null;

  const latest = orderedEvents.at(-1);
  const title = locale === "zh" ? "运行轨迹" : "Run trace";
  const countLabel = locale === "zh" ? `${orderedEvents.length} 步` : `${orderedEvents.length} steps`;

  return (
    <section className="assistant-run-trace" data-expanded={state.expanded}>
      <button
        aria-expanded={state.expanded}
        className="assistant-run-trace-summary"
        type="button"
        onClick={() => setUserExpanded((value) => !(value ?? state.expanded))}
      >
        <span className={state.failed ? "status-dot failed" : state.running ? "status-dot running" : "status-dot"} aria-hidden="true" />
        <strong>{title}</strong>
        <small>{latest?.title || countLabel}</small>
        <b aria-hidden="true">{state.expanded ? "^" : "v"}</b>
      </button>
      {state.expanded ? (
        <div className="assistant-run-trace-list">
          {orderedEvents.map((event) => {
            const nodeId = typeof event.payload?.nodeId === "string" ? event.payload.nodeId : "";
            return (
              <article className="assistant-run-trace-item" key={event.id}>
                <span className={event.status === "failed" ? "status-dot failed" : event.status === "completed" ? "status-dot" : "status-dot running"} aria-hidden="true" />
                <div>
                  <strong>{event.title}</strong>
                  {event.summary ? <p>{event.summary}</p> : null}
                  {nodeId && onFocusNode ? (
                    <button type="button" onClick={() => onFocusNode(nodeId)}>
                      {locale === "zh" ? "定位节点" : "Focus node"}
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

function isLowSignalToolEvent(event: Pick<RunTimelineEvent, "eventType" | "title"> & { payload?: Record<string, unknown> }) {
  if (!event.eventType.startsWith("tool_")) return false;
  const payload = event.payload ?? {};
  const toolName = typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool === "string" ? payload.tool : "";
  return toolName === "quick_messages" || event.title.toLowerCase() === "quick messages";
}
