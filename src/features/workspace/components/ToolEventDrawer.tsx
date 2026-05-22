import { useState } from "react";
import type { StoredToolEvent } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

type ToolEventDrawerProps = {
  events: StoredToolEvent[];
};

const eventLabels: Record<string, { en: string; zh: string }> = {
  run_completed: { en: "Run completed", zh: "运行完成" },
  prompt_built: { en: "Prompt built", zh: "Prompt 已构建" },
  output_version_created: { en: "Output version", zh: "输出版本" },
  tool_state_applied: { en: "Tool state applied", zh: "工具状态已应用" },
  agent_backend_runtime_failed: { en: "AgentBackend fell back to provider", zh: "AgentBackend 已降级到 Provider" },
  internal_output_blocked: { en: "Internal output blocked", zh: "内部输出已拦截" }
};

export function ToolEventDrawer({ events }: ToolEventDrawerProps) {
  const { locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const latest = events[0];
  const latestLabel = latest ? eventLabels[latest.eventType]?.[locale] ?? latest.eventType : locale === "zh" ? "暂无事件" : "No events yet";

  return (
    <section className="tool-event-drawer" aria-label="Tool event timeline" data-expanded={expanded}>
      <button className="tool-event-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="status-dot" />
        <strong>{locale === "zh" ? "工具与运行时间线" : "Tool event timeline"}</strong>
        <small>{events.length} · {latestLabel}</small>
        <b aria-hidden="true">{expanded ? "^" : "v"}</b>
      </button>
      {expanded ? (
        <div className="tool-event-list">
          {events.length === 0 ? (
            <p className="tool-event-empty">{locale === "zh" ? "生成或协作后会显示真实事件。" : "Real events appear after generation or collaboration."}</p>
          ) : null}
          {events.slice(0, 8).map((event) => (
            <article className="tool-event-item" key={event.id}>
              <span className="status-dot" />
              <div>
                <strong>{eventLabels[event.eventType]?.[locale] ?? event.eventType}</strong>
                <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
                <pre>{formatPayload(event.payload)}</pre>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatPayload(payload: unknown) {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}
