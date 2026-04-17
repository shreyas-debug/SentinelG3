"use client";

import { useState } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronRight, Download, FlaskConical } from "lucide-react";
import type { HealingEntry, ValidationResult, GeneratedTestSuite, TestCase } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────

function confidenceColor(score: number): string {
  if (score >= 0.8) return "text-emerald-400";
  if (score >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function priorityColor(priority: string): string {
  switch (priority) {
    case "critical": return "bg-red-500/20 text-red-400 border-red-500/40";
    case "high": return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    case "medium": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
    default: return "bg-blue-500/20 text-blue-400 border-blue-500/40";
  }
}

function downloadTestFile(suite: GeneratedTestSuite, fileName: string) {
  const lines: string[] = [];
  if (suite.imports) lines.push(suite.imports, "");
  suite.test_cases.forEach((tc) => {
    lines.push(`# ${tc.description}`, tc.code, "");
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── ValidationCard ───────────────────────────────────────

function ValidationCard({ entry }: { entry: HealingEntry }) {
  const [exploitsOpen, setExploitsOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const { vulnerability, validation, generated_tests } = entry;

  if (!validation) return null;

  const pct = Math.round(validation.confidence_score * 100);
  const fixed = validation.vulnerability_fixed;

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-4 space-y-3 bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text)] truncate">
            {vulnerability.file_path}:{vulnerability.line_number}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
            {vulnerability.issue}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            fixed
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
              : "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
          }`}
        >
          {fixed ? (
            <><CheckCircle className="h-3 w-3" /> Verified Fixed</>
          ) : (
            <><XCircle className="h-3 w-3" /> Needs Revision</>
          )}
        </span>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-[var(--color-text-muted)]">Fix Confidence</span>
          <span className={`font-bold ${confidenceColor(validation.confidence_score)}`}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Recommendation */}
      <p className="text-[10px] text-[var(--color-text-muted)]">
        <span className="font-semibold text-[var(--color-text)]">Recommendation:</span>{" "}
        {validation.recommendation}
      </p>

      {/* Exploit tests collapsible */}
      {validation.exploit_tests.length > 0 && (
        <div>
          <button
            onClick={() => setExploitsOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {exploitsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Exploit Tests ({validation.exploit_tests.length})
          </button>
          {exploitsOpen && (
            <div className="mt-2 space-y-1.5">
              {validation.exploit_tests.map((t, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-[10px] p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--color-text)]">{t.attack_type}</span>
                    <code className="block text-[var(--color-text-muted)] mt-0.5 truncate">{t.payload}</code>
                  </div>
                  {t.blocked_by_patch ? (
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generated tests */}
      {generated_tests && generated_tests.test_cases.length > 0 && (
        <div className="pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={() => setTestsOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors w-full"
          >
            {testsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <FlaskConical className="h-3 w-3 text-purple-400" />
            Generated Tests ({generated_tests.test_cases.length})
          </button>
          {testsOpen && (
            <div className="mt-2 space-y-1.5">
              {generated_tests.test_cases.map((tc, i) => (
                <TestCaseRow key={i} tc={tc} />
              ))}
            </div>
          )}
          <button
            onClick={() => downloadTestFile(
              generated_tests,
              `test_${vulnerability.file_path.replace(/[/\\]/g, "_").replace(/\.py$/, "")}_security.py`,
            )}
            className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-purple-500/20 border border-purple-500/40 text-purple-400 hover:bg-purple-500/30 transition-all"
          >
            <Download className="h-3 w-3" /> Download Tests
          </button>
        </div>
      )}
    </div>
  );
}

function TestCaseRow({ tc }: { tc: TestCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[10px] rounded border border-[var(--color-border)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-2 py-1.5 bg-[var(--color-bg)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <code className="font-semibold text-[var(--color-text)] truncate">{tc.name}</code>
        </span>
        <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${priorityColor(tc.priority)}`}>
          {tc.priority}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]">
          <p className="text-[var(--color-text-muted)] mb-1">{tc.description}</p>
          <pre className="text-[var(--color-text)] bg-[var(--color-bg)] rounded p-2 overflow-x-auto text-[9px] leading-relaxed">
            {tc.code}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────

function qaStats(entries: HealingEntry[]) {
  const validated = entries.filter((e) => e.validation);
  const fixed = validated.filter((e) => e.validation?.vulnerability_fixed);
  const avgConf =
    validated.length > 0
      ? Math.round(
          (validated.reduce((s, e) => s + (e.validation?.confidence_score ?? 0), 0) / validated.length) * 100,
        )
      : 0;
  const totalTests = entries.reduce(
    (s, e) => s + (e.generated_tests?.test_cases.length ?? 0),
    0,
  );
  return { validated: validated.length, fixed: fixed.length, avgConf, totalTests };
}

// ── Main Panel ───────────────────────────────────────────

export function ValidationResultsPanel({ entries }: { entries: HealingEntry[] }) {
  const validatedEntries = entries.filter((e) => e.validation);
  const stats = qaStats(entries);

  if (validatedEntries.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">
        <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>No validation results yet.</p>
        <p className="text-xs mt-1">Run a scan with Auto-Apply enabled to generate validations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Validated", value: stats.validated, color: "text-blue-400" },
          { label: "Confirmed Fixed", value: stats.fixed, color: "text-emerald-400" },
          { label: "Avg Confidence", value: `${stats.avgConf}%`, color: confidenceColor(stats.avgConf / 100) },
          { label: "Tests Generated", value: stats.totalTests, color: "text-purple-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-bg-secondary)] text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {validatedEntries.map((entry, i) => (
          <ValidationCard key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
