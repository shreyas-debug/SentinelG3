import { cn } from "@/lib/utils";

type BadgeVariant =
  // Severity — solid filled backgrounds
  | "critical" | "high" | "medium" | "low" | "info"
  // Status — ghost outline only
  | "pending" | "healed" | "unfixed" | "patched"
  // Neutral
  | "default";

const variantClasses: Record<BadgeVariant, string> = {
  // ── Severity: solid fill so they are instantly distinguishable ──
  critical: "bg-red-600/90    text-white        border-red-500",
  high:     "bg-orange-500/90 text-white        border-orange-400",
  medium:   "bg-yellow-500/90 text-slate-900    border-yellow-400",
  low:      "bg-blue-600/80   text-white        border-blue-500",
  info:     "bg-slate-600/70  text-slate-200    border-slate-500",

  // ── Status: outline-only with distinct hue per state ──
  pending:  "bg-transparent border-purple-500  text-purple-400",
  healed:   "bg-transparent border-emerald-500 text-emerald-400",
  patched:  "bg-transparent border-emerald-500 text-emerald-400",
  unfixed:  "bg-transparent border-slate-500   text-slate-400",

  // ── Neutral ──
  default:  "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
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
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
