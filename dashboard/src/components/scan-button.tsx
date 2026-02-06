"use client";

import { cn } from "@/lib/utils";
import { ShieldCheck, Loader2 } from "lucide-react";

export function ScanButton({
  scanning,
  onClick,
}: {
  scanning: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={scanning}
      className={cn(
        "group relative inline-flex items-center gap-2.5 rounded-lg px-6 py-3",
        "font-semibold text-sm tracking-wide transition-all duration-300",
        "border border-[var(--color-emerald)] text-[var(--color-emerald)]",
        "bg-[var(--color-emerald-dim)]/30",
        "hover:bg-[var(--color-emerald)]/20 hover:shadow-[0_0_25px_var(--color-emerald-dim)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        scanning && "animate-pulse-glow",
      )}
    >
      {scanning ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <ShieldCheck className="h-5 w-5 transition-transform group-hover:scale-110" />
      )}
      {scanning ? "Scanning…" : "Run Security Scan"}
    </button>
  );
}
