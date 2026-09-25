import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

/** Menú desplegable anclado a un disparador. */
export function Popover({ trigger, children, align = "end", placement = "bottom", className }: { trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: "start" | "end"; placement?: "bottom" | "top"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cn("absolute z-40 min-w-[200px] rounded-[12px] bg-white p-1.5 shadow-popover", placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1", align === "end" ? "right-0" : "left-0", className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export type MenuItem = { label: string; icon?: LucideIcon; onClick: () => void; destructive?: boolean; disabled?: boolean };

export function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onClick();
            }}
            className={cn("flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-surface-hover disabled:opacity-40", item.destructive ? "text-critical-strong" : "text-ink")}
          >
            {item.icon && <item.icon className="size-4" strokeWidth={1.8} />}
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
