import { cn } from "./cn";

export type Tone = "neutral" | "success" | "info" | "warning" | "critical" | "attention" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-[#e3e3e3] text-[#303030]",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  attention: "bg-[#ffd6a4] text-[#5e2a00]",
  critical: "bg-critical-soft text-critical",
  brand: "bg-brand-soft text-brand",
};

/** progress: indicador tipo "pendiente / parcial / completo" como en los estados de pedido. */
export function Badge({ tone = "neutral", progress, children, className }: { tone?: Tone; progress?: "incomplete" | "partial" | "complete"; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-[8px] px-2 text-[12px] font-[550] whitespace-nowrap", tones[tone], className)}>
      {progress && (
        <span
          aria-hidden
          className={cn(
            "size-[9px] rounded-full border-[1.5px] border-current",
            progress === "complete" && "bg-current",
            progress === "partial" && "bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]",
          )}
        />
      )}
      {children}
    </span>
  );
}
