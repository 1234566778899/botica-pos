import { ImageIcon } from "lucide-react";
import { cn } from "./cn";

export function Thumbnail({ src, alt = "", size = "md", className }: { src?: string | null; alt?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const url = src || null;
  const box = size === "sm" ? "size-8 rounded-[8px]" : size === "lg" ? "size-16 rounded-[12px]" : "size-10 rounded-[10px]";
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08)]", box, className)}>
      {url ? <img src={url} alt={alt} className="size-full object-contain" loading="lazy" /> : <ImageIcon className="size-4 text-ink-tertiary" strokeWidth={1.5} />}
    </span>
  );
}
