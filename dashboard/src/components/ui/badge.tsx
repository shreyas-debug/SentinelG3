import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "healed" | "critical" | "high" | "medium" | "low" | "info";

const variantClasses: Record<BadgeVariant, string> = {
  default:  "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
  healed:   "bg-[var(--color-emerald-dim)] text-[var(--color-emerald)] border-[var(--color-emerald)]",
  critical: "bg-[var(--color-red-dim)] text-[var(--color-red)] border-[var(--color-red)]",
  high:     "bg-[#7c2d1220] text-[#f97316] border-[#f97316]",
  medium:   "bg-[var(--color-amber-dim)] text-[var(--color-amber)] border-[var(--color-amber)]",
  low:      "bg-[#1e3a5f20] text-[var(--color-cyan)] border-[var(--color-cyan)]",
  info:     "bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border-[var(--color-text-muted)]",
};

export function Badge({
  variant = "default",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
