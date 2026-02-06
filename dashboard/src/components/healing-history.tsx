"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  SearchCheck,
  Wrench,
  FileCode2,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeDiff } from "@/components/code-diff";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import type { HealingEntry } from "@/lib/api";

function severityVariant(s: string) {
  const map: Record<string, "critical" | "high" | "medium" | "low" | "info"> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    info: "info",
  };
  return map[s.toLowerCase()] || "info";
}

/* ── Single thought block ─────────────────────────────── */

function ThoughtBlock({
  label,
  icon: Icon,
  color,
  borderColor,
  text,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  borderColor: string;
  text: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className={`text-[11px] font-bold tracking-[0.15em] uppercase ${color}`}>
          {label}
        </span>
      </div>
      <div
        className={`
          rounded-lg border bg-[var(--color-bg-terminal)] p-4
          text-[13px] font-[var(--font-mono)] leading-[1.7]
          text-[var(--color-text-secondary)] whitespace-pre-wrap
          ${borderColor}
        `}
      >
        {text}
      </div>
    </div>
  );
}

/* ── Expandable row ───────────────────────────────────── */

function EntryRow({
  entry,
  index,
  scanning,
}: {
  entry: HealingEntry;
  index: number;
  scanning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const v = entry.vulnerability;
  const hasThoughts = entry.auditor_thought || entry.fixer_thought;

  // Show thinking animation if scan is running and this entry has no thoughts yet
  const isThinking = scanning && !hasThoughts;

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      {/* Collapsed row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]/50 transition-colors"
      >
        <span className="text-[var(--color-text-muted)] text-xs font-mono w-6 shrink-0">
          #{index + 1}
        </span>

        {open ? (
          <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        )}

        <Badge variant={severityVariant(v.severity)} className="shrink-0 w-20 justify-center">
          {v.severity}
        </Badge>

        <span className="text-sm text-[var(--color-text-primary)] truncate flex-1">
          {v.issue.length > 100 ? v.issue.slice(0, 100) + "…" : v.issue}
        </span>

        <span className="text-xs text-[var(--color-text-muted)] font-mono shrink-0">
          {v.file_path}:{v.line_number}
        </span>

        {entry.healed ? (
          <Badge variant="healed" className="shrink-0">Fixed</Badge>
        ) : scanning ? (
          <Badge variant="default" className="shrink-0 animate-pulse">Healing…</Badge>
        ) : (
          <Badge variant="critical" className="shrink-0">Unfixed</Badge>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-5 pt-2 space-y-5 bg-[var(--color-bg-secondary)]/30">

          {/* ── Vulnerability detail ─────────────────────── */}
          <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed pl-10">
            <p className="font-semibold text-[var(--color-text-primary)] mb-1">
              Vulnerability Detail
            </p>
            <p>{v.issue}</p>
            <p className="mt-2 text-[var(--color-amber)]">
              <strong>Suggested fix:</strong> {v.fix_suggestion}
            </p>
          </div>

          {/* ── Chain of Thought ──────────────────────────── */}
          <div className="pl-10">
            {/* Section header */}
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className={`h-4 w-4 text-[var(--color-cyan)] ${isThinking ? "animate-pulse" : ""}`} />
              <span className="text-xs font-bold tracking-[0.15em] text-[var(--color-cyan)] uppercase">
                Chain of Thought — Gemini 3 Pro Reasoning
              </span>
              {isThinking && (
                <span className="thinking-dots ml-1">
                  <span /><span /><span />
                </span>
              )}
            </div>

            {/* Thinking animation while waiting */}
            {isThinking && <ThinkingIndicator />}

            {/* Actual thoughts once available */}
            {hasThoughts && (
              <div className="flex gap-4">
                {entry.auditor_thought && (
                  <ThoughtBlock
                    label="Auditor Reasoning"
                    icon={SearchCheck}
                    color="text-[var(--color-amber)]"
                    borderColor="border-[var(--color-amber)]/30"
                    text={entry.auditor_thought}
                  />
                )}
                {entry.fixer_thought && (
                  <ThoughtBlock
                    label="Fixer Reasoning"
                    icon={Wrench}
                    color="text-[var(--color-emerald)]"
                    borderColor="border-[var(--color-emerald)]/30"
                    text={entry.fixer_thought}
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Code Diff ─────────────────────────────────── */}
          {entry.patch.original_code && (
            <div className="pl-10">
              <div className="flex items-center gap-2 mb-3">
                <FileCode2 className="h-4 w-4 text-[var(--color-emerald)]" />
                <span className="text-xs font-bold tracking-[0.15em] text-[var(--color-emerald)] uppercase">
                  Code Diff — Original vs. Healed
                </span>
              </div>
              <CodeDiff
                original={entry.patch.original_code}
                fixed={entry.patch.fixed_code}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Healing History table ────────────────────────────── */

export function HealingHistory({
  entries,
  scanning = false,
}: {
  entries: HealingEntry[];
  scanning?: boolean;
}) {
  if (entries.length === 0 && !scanning) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-8 text-center text-[var(--color-text-muted)]">
        No healing history yet. Run a scan to get started.
      </div>
    );
  }

  if (entries.length === 0 && scanning) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6">
        <ThinkingIndicator />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
      {/* Table header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        <span className="w-6">#</span>
        <span className="w-4" />
        <span className="w-20">Severity</span>
        <span className="flex-1">Issue</span>
        <span className="w-32 text-right">Location</span>
        <span className="w-16 text-center">Status</span>
      </div>

      {/* Rows */}
      {entries.map((entry, i) => (
        <EntryRow key={i} entry={entry} index={i} scanning={scanning} />
      ))}
    </div>
  );
}
