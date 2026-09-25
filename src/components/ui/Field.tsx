import { ChevronsUpDown } from "lucide-react";
import { forwardRef, useId } from "react";
import { cn } from "./cn";

const fieldBase =
  "w-full rounded-[10px] bg-white px-3 text-[13px] text-ink shadow-field outline-none placeholder:text-ink-tertiary focus:shadow-[0_0_0_2px_var(--color-brand)] disabled:bg-surface-muted disabled:text-ink-tertiary aria-[invalid=true]:shadow-[0_0_0_1px_var(--color-critical-strong)]";

type LabelProps = { label?: React.ReactNode; help?: React.ReactNode; error?: string; className?: string; hideLabel?: boolean };

function FieldWrapper({ id, label, help, error, className, hideLabel, children }: LabelProps & { id: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className={cn("mb-1 block text-[13px] font-medium text-ink", hideLabel && "sr-only")}>
          {label}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-[12px] text-critical-strong">{error}</p> : help && <p className="mt-1 text-[12px] text-ink-secondary">{help}</p>}
    </div>
  );
}

type InputProps = LabelProps & React.InputHTMLAttributes<HTMLInputElement> & { prefix?: React.ReactNode; suffix?: React.ReactNode };

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField({ label, help, error, className, hideLabel, prefix, suffix, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrapper id={fid} label={label} help={help} error={error} className={className} hideLabel={hideLabel}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-secondary">{prefix}</span>}
        <input ref={ref} id={fid} aria-invalid={!!error} className={cn(fieldBase, "h-[30px]", prefix ? "pl-8" : "", suffix ? "pr-12" : "")} {...rest} />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-secondary">{suffix}</span>}
      </div>
    </FieldWrapper>
  );
});

type TextAreaProps = LabelProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, help, error, className, hideLabel, id, rows = 4, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrapper id={fid} label={label} help={help} error={error} className={className} hideLabel={hideLabel}>
      <textarea ref={ref} id={fid} rows={rows} aria-invalid={!!error} className={cn(fieldBase, "resize-y py-1.5 leading-5")} {...rest} />
    </FieldWrapper>
  );
});

type SelectProps = LabelProps & React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, help, error, className, hideLabel, id, options, placeholder, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrapper id={fid} label={label} help={help} error={error} className={className} hideLabel={hideLabel}>
      <div className="relative">
        <select ref={ref} id={fid} aria-invalid={!!error} className={cn(fieldBase, "h-[30px] cursor-pointer appearance-none pr-8")} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-secondary" />
      </div>
    </FieldWrapper>
  );
});

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: React.ReactNode; help?: React.ReactNode };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, help, className, ...rest }, ref) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2", className)}>
      <input ref={ref} type="checkbox" className="mt-[3px] size-[14px] shrink-0 cursor-pointer rounded-[4px] accent-[#303030]" {...rest} />
      {(label || help) && (
        <span>
          {label && <span className="block text-ink">{label}</span>}
          {help && <span className="block text-[12px] text-ink-secondary">{help}</span>}
        </span>
      )}
    </label>
  );
});

/** Interruptor (p. ej. "Inventario con seguimiento", "Producto físico"). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-[12px] text-ink-secondary", disabled && "opacity-50")}>
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-4 w-7 rounded-full transition-colors", checked ? "bg-button" : "bg-[#cfcfcf]")}
      >
        <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-all", checked ? "left-[14px]" : "left-0.5")} />
      </button>
    </label>
  );
}
