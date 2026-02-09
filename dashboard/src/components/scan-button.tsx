"use client";

import { cn } from "@/lib/utils";
import { ShieldCheck, Loader2, RotateCcw } from "lucide-react";

export function ScanButton({
  scanning,
  complete,
  onClick,
}: {
  scanning: boolean;
  complete?: boolean;
  onClick: () => void;
}) {
  const isReset = !scanning && complete;

  return (
    <button
      onClick={onClick}
      disabled={scanning}
      className={cn(
        "group relative inline-flex items-center gap-2.5 rounded-lg px-6 py-3",
        "font-semibold text-sm tracking-wide transition-all duration-300",
        "border text-[var(--color-emerald)]",
        // Normal vs reset styles
        isReset
          ? "border-[var(--color-cyan)] text-[var(--color-cyan)] bg-[var(--color-cyan)]/10 shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:bg-[var(--color-cyan)]/20 hover:shadow-[0_0_25px_rgba(6,182,212,0.5)]"
          : "border-[var(--color-emerald)] bg-[var(--color-emerald-dim)]/30 shadow-[0_0_15px_rgba(16,185,129,0.5)] hover:bg-[var(--color-emerald)]/20 hover:shadow-[0_0_25px_rgba(16,185,129,0.6),0_0_50px_rgba(16,185,129,0.2)]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        scanning && "animate-pulse-glow",
      )}
    >
      {scanning ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : isReset ? (
        <RotateCcw className="h-5 w-5 transition-transform group-hover:-rotate-45" />
      ) : (
        <ShieldCheck className="h-5 w-5 transition-transform group-hover:scale-110" />
      )}
      {scanning ? "Scanning…" : isReset ? "Reset / New Scan" : "Run Security Scan"}
    </button>
  );
}
