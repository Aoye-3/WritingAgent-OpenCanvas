import { useState } from "react";
import type { PlanRun } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

export function PlanClarificationCard({ plan, busy, variant = "message", onAnswer }: {
  plan: PlanRun;
  busy: boolean;
  variant?: "message" | "composer";
  onAnswer: (answer: { optionId?: string; customAnswer?: string }) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [customOpen, setCustomOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const clarification = plan.clarification;
  if (!clarification) return null;
  const answered = clarification.status === "answered";

  const submitCustom = () => {
    const value = customAnswer.trim();
    if (value) void onAnswer({ customAnswer: value });
  };

  return <section className={`plan-clarification-card plan-clarification-card-${variant}`} data-status={clarification.status}>
    <div className="plan-clarification-heading">
      <strong>{locale === "zh" ? "请选择一个方向" : "Choose one direction"}</strong>
      {answered ? <span>{locale === "zh" ? "已回答" : "Answered"}</span> : <span>{locale === "zh" ? "必选" : "Required"}</span>}
    </div>
    <p>{clarification.question}</p>
    <div className="plan-clarification-options" role="group" aria-label={clarification.question}>
      {clarification.options.map((option) => {
        const label = `${option.label}${option.recommended ? locale === "zh" ? "，推荐" : ", recommended" : ""}${option.description ? `: ${option.description}` : ""}`;
        return <button
          aria-label={label}
          className={clarification.selectedOptionId === option.id ? "is-selected" : ""}
          disabled={busy || answered}
          key={option.id}
          onClick={() => void onAnswer({ optionId: option.id })}
          title={option.description}
          type="button"
        >
          <span>
            <strong>{option.label}</strong>
            {option.recommended ? <em>{locale === "zh" ? "推荐" : "Recommended"}</em> : null}
            {option.description ? <b className="plan-clarification-detail" title={option.description}>?</b> : null}
          </span>
        </button>;
      })}
      {!answered ? <button className={customOpen ? "is-selected" : ""} disabled={busy} onClick={() => setCustomOpen(true)} type="button">
        <span>
          <strong>{locale === "zh" ? "其他" : "Other"}</strong>
          <b className="plan-clarification-detail" title={locale === "zh" ? "填写你希望特别关注的角度" : "Type the angle you want the agent to focus on"}>?</b>
        </span>
      </button> : clarification.customAnswer ? <div className="plan-clarification-custom-answer"><strong>{locale === "zh" ? "其他" : "Other"}</strong><small>{clarification.customAnswer}</small></div> : null}
    </div>
    {customOpen && !answered ? <div className="plan-clarification-custom">
      <input
        aria-label={locale === "zh" ? "其他关注方向" : "Other focus"}
        autoFocus
        disabled={busy}
        onChange={(event) => setCustomAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitCustom();
          }
        }}
        placeholder={locale === "zh" ? "输入你希望特别关注的角度..." : "Type another focus..."}
        value={customAnswer}
      />
      <button disabled={busy || !customAnswer.trim()} onClick={submitCustom} type="button">{locale === "zh" ? "提交" : "Submit"}</button>
    </div> : null}
  </section>;
}
