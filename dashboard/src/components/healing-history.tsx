"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  SearchCheck,
  Wrench,
  FileCode2,
  Sparkles,
  Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { CodeDiff } from "@/components/code-diff";
import { RadarAnimation } from "@/components/radar-animation";
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
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className={`text-[10px] font-bold tracking-[0.15em] uppercase ${color}`}>
          {label}
        </span>
      </div>
      <div
        className={`
          rounded-lg border bg-[var(--color-bg-terminal)] p-3
          text-[12px] leading-[1.7]
          text-[var(--color-text-secondary)]
          max-h-64 overflow-y-auto terminal-scroll
          ${borderColor}
        `}
      >
        <ReactMarkdown
          components={{
            strong: ({ children }) => (
              <strong className="text-[var(--color-cyan)] font-semibold">{children}</strong>
            ),
            h1: ({ children }) => (
              <h1 className="text-sm font-bold text-[var(--color-text-primary)] mt-3 mb-1.5 border-b border-[var(--color-border)] pb-1">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-[13px] font-bold text-[var(--color-text-primary)] mt-2.5 mb-1">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-[12px] font-bold text-[var(--color-cyan)] mt-2 mb-1">{children}</h3>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-inside pl-3 my-1 space-y-0.5">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside pl-3 my-1 space-y-0.5">{children}</ol>
            ),
            li: ({ children }) => (
              <li className="text-[var(--color-text-secondary)]">{children}</li>
            ),
            code: ({ children }) => (
              <code className="font-[var(--font-mono)] text-[11px] bg-[var(--color-bg-card)] text-[var(--color-amber)] px-1 py-0.5 rounded">{children}</code>
            ),
            pre: ({ children }) => (
              <pre className="font-[var(--font-mono)] text-[11px] bg-[var(--color-bg-card)] p-2 rounded-md my-2 overflow-x-auto border border-[var(--color-border)]">{children}</pre>
            ),
            p: ({ children }) => (
              <p className="my-1 leading-[1.7]">{children}</p>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/* ── Collapsible CoT dropdown ─────────────────────────── */

function ChainOfThoughtDropdown({ entry }: { entry: HealingEntry }) {
  const [cotOpen, setCotOpen] = useState(false);
  const hasThoughts = entry.auditor_thought || entry.fixer_thought;

  if (!hasThoughts) {
    return null;
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setCotOpen(!cotOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-[var(--color-bg-secondary)]/50 hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <Brain className="h-3.5 w-3.5 text-[var(--color-cyan)]" />
        <span className="text-[11px] font-semibold tracking-wider text-[var(--color-cyan)] uppercase flex-1">
          AI Reasoning — {entry.model_used || "Gemini"}
        </span>
        {cotOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        )}
      </button>

      {cotOpen && (
        <div className="p-3 bg-[var(--color-bg-secondary)]/20 space-y-3">
          <div className="flex gap-3">
            {entry.auditor_thought && (
              <ThoughtBlock
                label="Auditor Reasoning"
                icon={SearchCheck}
                color="text-[var(--color-amber)]"
                borderColor="border-[var(--color-amber)]/20"
                text={entry.auditor_thought}
              />
            )}
            {entry.fixer_thought && (
              <ThoughtBlock
                label="Fixer Reasoning"
                icon={Wrench}
                color="text-[var(--color-emerald)]"
                borderColor="border-[var(--color-emerald)]/20"
                text={entry.fixer_thought}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Expandable row ───────────────────────────────────── */

function EntryRow({
  entry,
  index,
}: {
  entry: HealingEntry;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const v = entry.vulnerability;

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      {/* Collapsed row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-bg-secondary)]/40 transition-colors"
      >
        <span className="text-[var(--color-text-muted)] text-[10px] font-mono w-5 shrink-0 text-right">
          {index + 1}
        </span>

        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
        )}

        <Badge variant={severityVariant(v.severity)} className="shrink-0 w-[72px] justify-center text-[10px]">
          {v.severity}
        </Badge>

        <span className="text-[13px] text-[var(--color-text-primary)] truncate flex-1">
          {v.issue.length > 90 ? v.issue.slice(0, 90) + "…" : v.issue}
        </span>

        <span className="text-[11px] text-[var(--color-text-muted)] font-mono shrink-0">
          {v.file_path}:{v.line_number}
        </span>

        {entry.healed ? (
          <Badge variant="healed" className="shrink-0 text-[10px]">Fixed</Badge>
        ) : (
          <Badge variant="critical" className="shrink-0 text-[10px]">Unfixed</Badge>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-[var(--color-bg-secondary)]/20">
          {/* Vulnerability detail */}
          <div className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed pl-9">
            <p className="font-semibold text-[var(--color-text-primary)] mb-1 text-sm">
              Vulnerability Detail
            </p>
            <p>{v.issue}</p>
            <p className="mt-1.5 text-[var(--color-amber)] text-[12px]">
              <strong>Fix:</strong> {v.fix_suggestion}
            </p>
          </div>

          {/* Chain of Thought dropdown */}
          <div className="pl-9">
            <ChainOfThoughtDropdown entry={entry} />
          </div>

          {/* Code Diff */}
          {entry.patch.original_code && (
            <div className="pl-9">
              <div className="flex items-center gap-2 mb-2">
                <FileCode2 className="h-3.5 w-3.5 text-[var(--color-emerald)]" />
                <span className="text-[10px] font-bold tracking-[0.15em] text-[var(--color-emerald)] uppercase">
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
}: {
  entries: HealingEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
        <RadarAnimation />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-sm">
      {/* Table header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        <span className="w-5 text-right">#</span>
        <span className="w-3.5" />
        <span className="w-[72px]">Severity</span>
        <span className="flex-1">Issue</span>
        <span className="w-32 text-right">Location</span>
        <span className="w-16 text-center">Status</span>
      </div>

      {/* Rows */}
      {entries.map((entry, i) => (
        <EntryRow key={i} entry={entry} index={i} />
      ))}
    </div>
  );
}
