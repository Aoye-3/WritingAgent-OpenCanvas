import { useState } from "react";
import type { PlanRun } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

export function PlanClarificationCard({ plan, busy, variant = "message", onAnswer }: {
  plan: PlanRun;
  busy: boolean;
  variant?: "message" | "composer";
  onAnswer: (answer: { optionId?: string; customAnswer?: string }) => Promise<void>;
}) {
  const { t } = useI18n();
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
      <strong>{t("plan.chooseDirection")}</strong>
      {answered ? <span>{t("plan.answered")}</span> : <span>{t("plan.required")}</span>}
    </div>
    <p>{clarification.question}</p>
    <div className="plan-clarification-options" role="group" aria-label={clarification.question}>
      {clarification.options.map((option) => {
        const label = `${option.label}${option.recommended ? `, ${t("plan.recommended")}` : ""}${option.description ? `: ${option.description}` : ""}`;
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
            {option.recommended ? <em>{t("plan.recommended")}</em> : null}
            {option.description ? <b className="plan-clarification-detail" title={option.description}>?</b> : null}
          </span>
        </button>;
      })}
      {!answered ? <button className={customOpen ? "is-selected" : ""} disabled={busy} onClick={() => setCustomOpen(true)} type="button">
        <span>
          <strong>{t("plan.other")}</strong>
          <b className="plan-clarification-detail" title={t("plan.otherFocusTitle")}>?</b>
        </span>
      </button> : clarification.customAnswer ? <div className="plan-clarification-custom-answer"><strong>{t("plan.other")}</strong><small>{clarification.customAnswer}</small></div> : null}
    </div>
    {customOpen && !answered ? <div className="plan-clarification-custom">
      <input
        aria-label={t("plan.otherFocus")}
        autoFocus
        disabled={busy}
        onChange={(event) => setCustomAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitCustom();
          }
        }}
        placeholder={t("plan.otherFocusPlaceholder")}
        value={customAnswer}
      />
      <button disabled={busy || !customAnswer.trim()} onClick={submitCustom} type="button">{t("common.submit")}</button>
    </div> : null}
  </section>;
}
