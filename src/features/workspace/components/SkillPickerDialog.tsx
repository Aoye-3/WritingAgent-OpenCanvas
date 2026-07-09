import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../../shared/icons";
import { SkillFolderPicker, type SkillFolderPickerProps } from "./SkillFolderPicker";

type SkillPickerDialogProps = SkillFolderPickerProps & {
  description?: string;
  open: boolean;
  testId?: string;
  title: string;
  onClose: () => void;
};

export function SkillPickerDialog({
  description,
  open,
  testId = "skill-picker-dialog",
  title,
  onClose,
  ...pickerProps
}: SkillPickerDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="skill-picker-dialog-backdrop"
      data-testid={testId}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="skill-picker-dialog"
        role="dialog"
      >
        <header className="skill-picker-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            aria-label={pickerProps.locale === "zh" ? "\u5173\u95ed\u6280\u80fd\u9762\u677f" : "Close skills panel"}
            className="skill-picker-dialog-close"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
          >
            <CloseIcon aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="skill-picker-dialog-body">
          <SkillFolderPicker {...pickerProps} />
        </div>
      </section>
    </div>,
    document.body
  );
}
