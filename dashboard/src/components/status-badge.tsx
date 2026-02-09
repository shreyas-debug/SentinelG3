"use client";

type StatusType = "idle" | "scanning" | "patching" | "complete";

const STATUS_CONFIG: Record<StatusType, { label: string; color: string; bg: string; animate: boolean }> = {
  idle:     { label: "Systems Idle",       color: "text-[var(--color-text-muted)]",  bg: "bg-[var(--color-text-muted)]/10 border-[var(--color-text-muted)]/20", animate: false },
  scanning: { label: "Scanning Target...", color: "text-[var(--color-amber)]",       bg: "bg-[var(--color-amber)]/10 border-[var(--color-amber)]/30",           animate: true },
  patching: { label: "Patching...",        color: "text-[var(--color-blue)]",        bg: "bg-[var(--color-blue)]/10 border-[var(--color-blue)]/30",             animate: true },
  complete: { label: "Scan Complete",      color: "text-[var(--color-emerald)]",     bg: "bg-[var(--color-emerald)]/10 border-[var(--color-emerald)]/30",       animate: false },
};

export function StatusBadge({ status }: { status: StatusType }) {
  const cfg = STATUS_CONFIG[status];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        text-[10px] font-bold uppercase tracking-wider border
        ${cfg.color} ${cfg.bg}
        ${cfg.animate ? "animate-pulse" : ""}
      `}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "idle" ? "bg-[var(--color-text-muted)]" :
          status === "scanning" ? "bg-[var(--color-amber)] status-dot-pulse" :
          status === "patching" ? "bg-[var(--color-blue)] status-dot-pulse" :
          "bg-[var(--color-emerald)]"
        }`}
      />
      {cfg.label}
    </span>
  );
}
