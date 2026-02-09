"use client";

import { ShieldAlert, ShieldCheck, FileSearch, Activity, type LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  iconColor: string;
  borderColor: string;
  bgIcon: LucideIcon;
  sparkline?: boolean;
}

function StatCard({ icon: Icon, label, value, iconColor, borderColor, bgIcon: BgIcon, sparkline }: StatCardProps) {
  return (
    <div
      className={`
        relative flex items-center gap-3 rounded-xl overflow-hidden
        border-b-[3px] border-t border-l border-r
        border-t-[var(--color-border)] border-l-[var(--color-border)] border-r-[var(--color-border)]
        bg-[var(--color-bg-card)] px-5 py-5 min-w-[200px] flex-1
        ${borderColor}
      `}
    >
      {/* Huge background icon (bottom-right, opacity 10%) */}
      <BgIcon
        className={`absolute -bottom-2 -right-2 h-16 w-16 ${iconColor} opacity-[0.07] pointer-events-none`}
      />

      {/* Sparkline background for Threats Found card */}
      {sparkline && (
        <svg
          className="absolute bottom-0 left-0 w-full h-12 opacity-[0.06] pointer-events-none"
          viewBox="0 0 200 50"
          preserveAspectRatio="none"
        >
          <path
            d="M0 45 L20 38 L40 42 L60 25 L80 35 L100 15 L120 28 L140 10 L160 22 L180 18 L200 30"
            fill="none"
            stroke="var(--color-red)"
            strokeWidth="2"
          />
          <path
            d="M0 45 L20 38 L40 42 L60 25 L80 35 L100 15 L120 28 L140 10 L160 22 L180 18 L200 30 L200 50 L0 50Z"
            fill="var(--color-red)"
            fillOpacity="0.3"
          />
        </svg>
      )}

      {/* Content */}
      <Icon className={`h-9 w-9 ${iconColor} shrink-0 relative z-10`} />
      <div className="relative z-10">
        <p className="text-5xl font-bold text-[var(--color-text-primary)] tabular-nums leading-none">
          {value}
        </p>
        <p className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-[0.2em] font-bold mt-1">
          {label}
        </p>
      </div>
    </div>
  );
}

interface StatsBarProps {
  scannedFiles: number;
  found: number;
  healed: number;
  scanning: boolean;
}

export function StatsBar({ scannedFiles, found, healed, scanning }: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        icon={FileSearch}
        bgIcon={FileSearch}
        label="Files Scanned"
        value={scannedFiles}
        iconColor="text-[var(--color-cyan)]"
        borderColor="border-b-[var(--color-cyan)]"
      />
      <StatCard
        icon={ShieldAlert}
        bgIcon={ShieldAlert}
        label="Threats Found"
        value={found}
        iconColor="text-[var(--color-red)]"
        borderColor="border-b-[var(--color-red)]"
        sparkline
      />
      <StatCard
        icon={ShieldCheck}
        bgIcon={ShieldCheck}
        label="Healed"
        value={healed}
        iconColor="text-[var(--color-emerald)]"
        borderColor="border-b-[var(--color-emerald)]"
      />
      <StatCard
        icon={Activity}
        bgIcon={Activity}
        label="Agents"
        value={scanning ? "Active" : found > 0 ? "Complete" : "Standby"}
        iconColor={scanning ? "text-[var(--color-amber)] animate-pulse" : "text-[var(--color-text-muted)]"}
        borderColor={scanning ? "border-b-[var(--color-amber)]" : "border-b-[var(--color-border)]"}
      />
    </div>
  );
}
