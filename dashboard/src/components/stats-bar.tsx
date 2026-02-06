"use client";

import { ShieldAlert, ShieldCheck, FileSearch, Activity } from "lucide-react";

interface StatsBarProps {
  scannedFiles: number;
  found: number;
  healed: number;
  scanning: boolean;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 min-w-[180px]">
      <Icon className={`h-8 w-8 ${color}`} />
      <div>
        <p className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}

export function StatsBar({ scannedFiles, found, healed, scanning }: StatsBarProps) {
  return (
    <div className="flex flex-wrap gap-4">
      <StatCard
        icon={FileSearch}
        label="Files Scanned"
        value={scannedFiles}
        color="text-[var(--color-cyan)]"
      />
      <StatCard
        icon={ShieldAlert}
        label="Threats Found"
        value={found}
        color="text-[var(--color-amber)]"
      />
      <StatCard
        icon={ShieldCheck}
        label="Vulnerabilities Healed"
        value={healed}
        color="text-[var(--color-emerald)]"
      />
      <StatCard
        icon={Activity}
        label="Status"
        value={scanning ? "Scanning…" : found > 0 ? "Complete" : "Idle"}
        color={scanning ? "text-[var(--color-amber)] animate-pulse" : "text-[var(--color-text-muted)]"}
      />
    </div>
  );
}
