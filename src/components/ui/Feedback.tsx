import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-ink-secondary", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[8px] bg-surface-pressed", className)} />;
}

const bannerTones = {
  info: { box: "bg-info-soft text-info", icon: Info },
  success: { box: "bg-success-soft text-success", icon: CheckCircle2 },
  warning: { box: "bg-warning-soft text-warning", icon: AlertTriangle },
  critical: { box: "bg-critical-soft text-critical", icon: XCircle },
};

export function Banner({ tone = "info", title, children, action }: { tone?: keyof typeof bannerTones; title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const { box, icon: Icon } = bannerTones[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-[12px] px-3 py-2.5", box)} role={tone === "critical" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1 text-ink">
        {title && <p className="font-[650]">{title}</p>}
        {children && <div className="text-ink">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <span className="mb-4 grid size-16 place-items-center rounded-full bg-surface-muted">
          <Icon className="size-7 text-ink-tertiary" strokeWidth={1.4} />
        </span>
      )}
      <h3 className="text-[14px] font-[650]">{title}</h3>
      {description && <p className="mt-1 max-w-[420px] text-ink-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --- Toasts -------------------------------------------------------------------
type Toast = { id: number; message: string; error?: boolean };
const ToastContext = createContext<(message: string, opts?: { error?: boolean }) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, opts?: { error?: boolean }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, error: opts?.error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.error ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto rounded-[10px] px-3.5 py-2 text-[13px] font-medium text-white shadow-popover", t.error ? "bg-critical-strong" : "bg-[#1a1a1a]")}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
