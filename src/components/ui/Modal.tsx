import { X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./Button";
import { cn } from "./cn";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  primaryAction?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean; destructive?: boolean };
  secondaryLabel?: string;
  size?: "sm" | "md" | "lg";
};

export function Modal({ open, onClose, title, children, primaryAction, secondaryLabel = "Cancelar", size = "md" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className={cn("w-full rounded-[16px] bg-white shadow-popover", size === "sm" ? "max-w-[420px]" : size === "lg" ? "max-w-[760px]" : "max-w-[560px]")}>
        <header className="flex items-center justify-between rounded-t-[16px] border-b border-border bg-surface-muted px-4 py-2.5">
          <h2 className="text-[14px] font-[650]">{title}</h2>
          <Button variant="plain" size="icon" icon={X} onClick={onClose}>
            Cerrar
          </Button>
        </header>
        <div className="p-4">{children}</div>
        {primaryAction && (
          <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button onClick={onClose}>{secondaryLabel}</Button>
            <Button
              variant={primaryAction.destructive ? "critical" : "primary"}
              onClick={primaryAction.onClick}
              loading={primaryAction.loading}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
