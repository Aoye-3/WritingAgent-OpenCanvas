import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";

type Size = "sm" | "md";
type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  size?: Size;
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ children, className, disabled, loading, size = "md", variant = "secondary", ...props }: ButtonProps) {
  return (
    <button
      className={cx("ui-button", `ui-button-${variant}`, size === "sm" && "ui-button-sm", "button", `button-${variant}`, size === "sm" && "button-small", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cx("ui-icon-button", "icon-button", className)} {...props}>
      {children}
    </button>
  );
}

type FieldBaseProps = {
  helperText?: ReactNode;
  label: ReactNode;
  required?: boolean;
  wrapperClassName?: string;
};

function FieldShell({ children, helperText, label, required, wrapperClassName }: FieldBaseProps & { children: ReactNode }) {
  return (
    <label className={cx("ui-field", "field", wrapperClassName)}>
      <span>
        {label} {required ? <strong>*</strong> : null}
      </span>
      {children}
      {helperText ? <small className="field-hint">{helperText}</small> : null}
    </label>
  );
}

export function TextField({ helperText, label, required, wrapperClassName, ...props }: FieldBaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell helperText={helperText} label={label} required={required} wrapperClassName={wrapperClassName}>
      <input {...props} />
    </FieldShell>
  );
}

export function TextareaField({ helperText, label, required, wrapperClassName, ...props }: FieldBaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell helperText={helperText} label={label} required={required} wrapperClassName={wrapperClassName}>
      <textarea {...props} />
    </FieldShell>
  );
}

export function SelectField({ children, helperText, label, required, wrapperClassName, ...props }: FieldBaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell helperText={helperText} label={label} required={required} wrapperClassName={wrapperClassName}>
      <select {...props}>{children}</select>
    </FieldShell>
  );
}

type Option = {
  label: string;
  value: string;
};

type OptionGroupProps = {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: Option[];
  value: string;
};

export function SegmentedControl({ ariaLabel, className, onChange, options, value }: OptionGroupProps) {
  return (
    <div className={cx("ui-segmented", "segmented", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button className={value === option.value ? "selected" : ""} key={option.value} onClick={() => onChange(value === option.value ? "" : option.value)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ChipGroup({ ariaLabel, className, onChange, options, value }: OptionGroupProps) {
  return (
    <div className={cx("ui-chip-group", "chip-row", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button className={value === option.value ? "chip chip-selected" : "chip"} key={option.value} onClick={() => onChange(value === option.value ? "" : option.value)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ as: Component = "section", children, className, ...props }: HTMLAttributes<HTMLElement> & { as?: "article" | "aside" | "div" | "section"; children: ReactNode }) {
  return <Component className={cx("ui-panel", className)} {...props}>{children}</Component>;
}

export function Tabs({ ariaLabel, children, className }: { ariaLabel: string; children: ReactNode; className?: string }) {
  return <div className={cx("ui-tabs", className)} role="tablist" aria-label={ariaLabel}>{children}</div>;
}

export function TabButton({ active, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button className={cx("ui-tab", active && "is-active", className)} role="tab" aria-selected={Boolean(active)} type="button" {...props}>{children}</button>;
}

export function DrawerShell({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <aside className={cx("ui-drawer", className)} {...props}>{children}</aside>;
}

export function ModalDialog({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return (
    <div className="ui-modal-backdrop" role="presentation">
      <section className={cx("ui-modal", className)} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>
  );
}

export function StatusBadge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: Tone }) {
  return <span className={cx("ui-status-badge", `ui-status-${tone}`, className)}>{children}</span>;
}

export function EmptyState({ action, children, className, title }: { action?: ReactNode; children?: ReactNode; className?: string; title: ReactNode }) {
  return (
    <div className={cx("ui-empty-state", className)}>
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
