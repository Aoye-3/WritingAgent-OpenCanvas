import { useState } from "react";
import type { PlanRun } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

export function PlanClarificationCard({ plan, busy, onAnswer }: {
  plan: PlanRun;
  busy: boolean;
  onAnswer: (answer: { optionId?: string; customAnswer?: string }) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [customOpen, setCustomOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const clarification = plan.clarification;
  if (!clarification) return null;
  const answered = clarification.status === "answered";

  return <section className="plan-clarification-card" data-status={clarification.status}>
    <div className="plan-clarification-heading">
      <strong>{locale === "zh" ? "补充一个关键信息" : "One key question"}</strong>
      {answered ? <span>{locale === "zh" ? "已回答" : "Answered"}</span> : null}
    </div>
    <p>{clarification.question}</p>
    <div className="plan-clarification-options">
      {clarification.options.map((option) => <button
        className={clarification.selectedOptionId === option.id ? "is-selected" : ""}
        disabled={busy || answered}
        key={option.id}
        onClick={() => void onAnswer({ optionId: option.id })}
        type="button"
      >
        <span><strong>{option.label}</strong>{option.recommended ? <em>{locale === "zh" ? "推荐" : "Recommended"}</em> : null}</span>
        <small>{option.description}</small>
      </button>)}
      {!answered ? <button className={customOpen ? "is-selected" : ""} disabled={busy} onClick={() => setCustomOpen(true)} type="button">
        <span><strong>{locale === "zh" ? "其他" : "Other"}</strong></span>
        <small>{locale === "zh" ? "填写自己的答案" : "Provide your own answer"}</small>
      </button> : clarification.customAnswer ? <div className="plan-clarification-custom-answer"><strong>{locale === "zh" ? "其他" : "Other"}</strong><small>{clarification.customAnswer}</small></div> : null}
    </div>
    {customOpen && !answered ? <form className="plan-clarification-custom" onSubmit={(event) => {
      event.preventDefault();
      if (customAnswer.trim()) void onAnswer({ customAnswer: customAnswer.trim() });
    }}>
      <input autoFocus disabled={busy} onChange={(event) => setCustomAnswer(event.target.value)} value={customAnswer} />
      <button disabled={busy || !customAnswer.trim()} type="submit">{locale === "zh" ? "提交" : "Submit"}</button>
    </form> : null}
  </section>;
}
