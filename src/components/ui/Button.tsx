import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { Link } from "react-router";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "tertiary" | "plain" | "critical" | "brand";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-button text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_1px_0_rgba(0,0,0,.4)] hover:bg-button-hover",
  secondary: "bg-white text-ink shadow-button hover:bg-surface-muted",
  tertiary: "bg-surface-pressed/70 text-ink hover:bg-surface-pressed",
  plain: "text-ink hover:bg-surface-hover",
  critical: "bg-critical-strong text-white hover:bg-[#a30a1f]",
  brand: "bg-brand text-white hover:bg-brand-dark",
};
const sizes: Record<Size, string> = {
  sm: "h-7 gap-1 rounded-[8px] px-2.5 text-[12px]",
  md: "h-8 gap-1.5 rounded-[10px] px-3 text-[13px]",
  icon: "size-7 justify-center rounded-[8px]",
};

type Common = { variant?: Variant; size?: Size; icon?: LucideIcon; loading?: boolean; className?: string; children?: React.ReactNode };
type ButtonProps = Common & React.ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined };
type LinkButtonProps = Common & { to: string; target?: string };

const base = "inline-flex shrink-0 items-center font-[550] whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps | LinkButtonProps>(function Button(props, ref) {
  const { variant = "secondary", size = "sm", icon: Icon, loading, className, children } = props;
  const classes = cn(base, variants[variant], sizes[size], className);
  const content = (
    <>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : Icon && <Icon className={size === "icon" ? "size-4" : "size-3.5"} strokeWidth={2} />}
      {size !== "icon" && children}
    </>
  );
  if ("to" in props && props.to) {
    return (
      <Link to={props.to} target={props.target} className={classes} aria-label={size === "icon" ? String(children ?? "") : undefined}>
        {content}
      </Link>
    );
  }
  const { variant: _v, size: _s, icon: _i, loading: _l, className: _c, children: _ch, ...rest } = props as ButtonProps;
  return (
    <button ref={ref} type="button" className={classes} disabled={rest.disabled || loading} aria-label={size === "icon" ? String(children ?? "") : undefined} {...rest}>
      {content}
    </button>
  );
});
