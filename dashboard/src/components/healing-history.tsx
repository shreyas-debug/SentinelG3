"use client";

import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  SearchCheck,
  Wrench,
  FileCode2,
  Sparkles,
  Brain,
  Terminal,
  Swords,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  BookOpen,
  Eye,
  LayoutList,
  Radio,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { CodeDiff } from "@/components/code-diff";
import { RadarAnimation } from "@/components/radar-animation";
import type { HealingEntry } from "@/lib/api";
/** Maps severity string → Badge variant */
function severityVariant(s: string): "critical" | "high" | "medium" | "low" | "info" {
  const map: Record<string, "critical" | "high" | "medium" | "low" | "info"> = {
    critical: "critical", high: "high", medium: "medium", low: "low", info: "info",
  };
  return map[s.toLowerCase()] ?? "info";
}

/* ── Markdown renderer shared across tabs ─────────────── */
function MarkdownBlock({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`text-[12px] leading-[1.8] text-[var(--color-text-secondary)] ${className}`}>
      <ReactMarkdown
        components={{
          strong: ({ children }) => <strong className="text-[var(--color-cyan)] font-semibold">{children}</strong>,
          code: ({ children }) => <code className="font-[var(--font-mono)] text-[11px] bg-[var(--color-bg-card)] text-[var(--color-amber)] px-1 py-0.5 rounded">{children}</code>,
          pre: ({ children }) => <pre className="font-[var(--font-mono)] text-[11px] bg-[var(--color-bg-card)] p-2 rounded-md my-2 overflow-x-auto border border-[var(--color-border)]">{children}</pre>,
          p: ({ children }) => <p className="my-1">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside pl-3 my-1 space-y-0.5">{children}</ul>,
          li: ({ children }) => <li className="text-[var(--color-text-secondary)]">{children}</li>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ── Overview Tab ─────────────────────────────────────── */
function OverviewTab({ entry, simplified, onSetSimplified }: {
  entry: HealingEntry;
  simplified: boolean;
  onSetSimplified: (val: boolean) => void;
}) {
  const v = entry.vulnerability;
  const hasEli5 = Boolean(v.eli5_explanation);

  return (
    <div className="space-y-4">
      {/* Developer/Executive toggle */}
      {hasEli5 && (
        <div className="flex items-center gap-1 p-0.5 bg-[var(--color-bg-secondary)] rounded-lg w-fit">
          <button
            onClick={() => onSetSimplified(false)}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
              !simplified
                ? "bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            Developer Details
          </button>
          <button
            onClick={() => onSetSimplified(true)}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
              simplified
                ? "bg-[var(--color-amber)]/20 text-[var(--color-amber)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            <Sparkles className="inline h-2.5 w-2.5 mr-1" />
            Executive Summary
          </button>
        </div>
      )}

      {/* Explanation */}
      {simplified && v.eli5_explanation ? (
        <div className="rounded-lg border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <BookOpen className="h-3.5 w-3.5 text-[var(--color-amber)]" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-amber)]">
              Plain-English Summary
            </span>
          </div>
          <p className="text-[13px] text-[var(--color-text-primary)] leading-relaxed">{v.eli5_explanation}</p>
        </div>
      ) : (
        <div className="rounded-lg bg-[var(--color-bg-secondary)]/40 px-4 py-3 border border-[var(--color-border)]">
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">{v.issue}</p>
        </div>
      )}

      {/* Fix suggestion */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-emerald)] mt-0.5 shrink-0">Recommended Fix</span>
        <p className="text-[12px] text-[var(--color-text-secondary)]">{v.fix_suggestion}</p>
      </div>
    </div>
  );
}

/* ── Attack Vector Tab ────────────────────────────────── */
function AttackVectorTab({ vulnerability: v }: { vulnerability: HealingEntry["vulnerability"] }) {
  const hasData = v.exploit_poc || v.attack_scenario;
  if (!hasData) {
    return (
      <p className="text-[12px] text-[var(--color-text-muted)] italic text-center py-6">
        No attack simulation data was generated for this finding.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {v.attack_scenario && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Eye className="h-3.5 w-3.5 text-[var(--color-red)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-red)]">Attack Scenario</span>
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed pl-4 border-l-2 border-[var(--color-red)]/30">
            {v.attack_scenario}
          </p>
        </div>
      )}
      {v.exploit_poc && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Terminal className="h-3.5 w-3.5 text-[var(--color-red)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-red)]">Proof of Concept</span>
          </div>
          <pre className="font-[var(--font-mono)] text-[11px] bg-[var(--color-bg-terminal)] text-[var(--color-red)]/90 p-3 rounded-md border border-[var(--color-red)]/20 whitespace-pre-wrap break-all overflow-x-auto">
            {v.exploit_poc}
          </pre>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
            <Swords className="h-3 w-3" />
            This is a simulated exploit — for educational use only.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── AI Reasoning Tab ─────────────────────────────────── */
function AIReasoningTab({ entry }: { entry: HealingEntry }) {
  const hasThoughts = entry.auditor_thought || entry.fixer_thought;
  if (!hasThoughts) {
    return (
      <p className="text-[12px] text-[var(--color-text-muted)] italic text-center py-6">
        No reasoning data captured for this finding.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {entry.model_used && (
        <p className="text-[10px] text-[var(--color-cyan)] uppercase tracking-widest font-semibold">
          Model: {entry.model_used}
        </p>
      )}
      {entry.auditor_thought && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <SearchCheck className="h-3.5 w-3.5 text-[var(--color-amber)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-amber)]">Auditor Reasoning</span>
          </div>
          <div className="rounded-lg border border-[var(--color-amber)]/20 bg-[var(--color-bg-terminal)] p-3 max-h-52 overflow-y-auto terminal-scroll">
            <MarkdownBlock text={entry.auditor_thought} />
          </div>
        </div>
      )}
      {entry.fixer_thought && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wrench className="h-3.5 w-3.5 text-[var(--color-emerald)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-emerald)]">Fixer Reasoning</span>
          </div>
          <div className="rounded-lg border border-[var(--color-emerald)]/20 bg-[var(--color-bg-terminal)] p-3 max-h-52 overflow-y-auto terminal-scroll">
            <MarkdownBlock text={entry.fixer_thought} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Code Diff Tab ────────────────────────────────────── */
function CodeDiffTab({ entry }: { entry: HealingEntry }) {
  if (!entry.patch?.original_code) {
    return (
      <p className="text-[12px] text-[var(--color-text-muted)] italic text-center py-6">
        No code diff available for this finding.
      </p>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FileCode2 className="h-3.5 w-3.5 text-[var(--color-emerald)]" />
        <span className="text-[10px] font-bold tracking-[0.15em] text-[var(--color-emerald)] uppercase">
          Original (Vulnerable) vs. Healed (Patched)
        </span>
      </div>
      <CodeDiff original={entry.patch.original_code} fixed={entry.patch.fixed_code} />
    </div>
  );
}

/* ── Generate Fix Button (On-Demand Fix Generation) ───── */
function GenerateFix({
  entry,
  onGenerated,
  onLog,
}: {
  entry: HealingEntry;
  onGenerated: (patch: PatchResult, fixerThought: string, modelUsed: string) => void;
  onLog: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [thinking, setThinking] = useState("");

  if (entry.patch) {
    return null;
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {errMsg || "Generation failed"}
      </span>
    );
  }

  if (state === "generating") {
    return (
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-cyan)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating fix…
        </span>
        {thinking && (
          <div className="text-[10px] text-[var(--color-text-muted)] font-mono bg-[var(--color-bg-terminal)] p-2 rounded border border-[var(--color-border)] max-h-24 overflow-y-auto">
            {thinking}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setState("generating");
        setThinking("");
        onLog(`  🔧 Generating fix for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}…`);

        const { generateFix } = require("@/lib/api");
        generateFix(
          entry.vulnerability,
          "",
          (text: string) => setThinking((prev) => prev + text),
          (patch: PatchResult, fixerThought: string, modelUsed: string) => {
            setState("done");
            onGenerated(patch, fixerThought, modelUsed);
            onLog(`  ✓ Fix generated for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}`);
          },
          (message: string) => {
            setState("error");
            setErrMsg(message);
            onLog(`  ✗ Fix generation failed: ${message}`);
          }
        );
      }}
      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold
                 bg-[var(--color-cyan)]/20 border border-[var(--color-cyan)]/40 text-[var(--color-cyan)]
                 hover:bg-[var(--color-cyan)]/30 transition-all active:scale-95 shadow-sm"
    >
      <Wrench className="h-3.5 w-3.5" />
      Generate Fix
    </button>
  );
}

/* ── Rollback Button ─────────────────────────────────── */
function RollbackButton({
  entry,
  repoRoot,
  onRollback,
  onLog,
}: {
  entry: HealingEntry;
  repoRoot: string;
  onRollback: () => void;
  onLog: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  if (!entry.healed) {
    return null;
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-amber)]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Rolled back
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {errMsg || "Rollback failed"}
      </span>
    );
  }

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Rolling back…
      </span>
    );
  }

  return (
    <button
      onClick={async () => {
        setState("loading");
        onLog(`  ⏪ Rolling back ${entry.vulnerability.file_path}…`);

        const { rollbackFile } = await import("@/lib/api");
        const result = await rollbackFile(entry.vulnerability.file_path, repoRoot);

        if (result.success) {
          setState("done");
          onRollback();
          onLog(`  ✓ Rolled back ${entry.vulnerability.file_path} from backup`);
        } else {
          setState("error");
          setErrMsg(result.message);
          onLog(`  ✗ Rollback failed: ${result.message}`);
        }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold
                 bg-[var(--color-amber)]/20 border border-[var(--color-amber)]/40 text-[var(--color-amber)]
                 hover:bg-[var(--color-amber)]/30 transition-all active:scale-95 shadow-sm"
    >
      Rollback
    </button>
  );
}

/* ── Approve Fix ─────────────────────────────────────── */
function ApproveFix({
  entry,
  onApproved,
  onLog,
  onApplyPatches,
}: {
  entry: HealingEntry;
  onApproved: () => void;
  onLog: (msg: string) => void;
  onApplyPatches?: (patches: { file_path: string; new_content: string }[]) => Promise<{ success: boolean; message: string; pr_url?: string }>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  if (entry.healed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Patch applied
      </span>
    );
  }
  if (!entry.patch?.success || !entry.patch?.fixed_code) return null;

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Patch applied to disk
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {errMsg || "Apply failed"}
      </span>
    );
  }

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Applying patch…
      </span>
    );
  }

  return (
    <button
      onClick={async () => {
        if (!onApplyPatches || !entry.patch) {
          setState("error");
          setErrMsg("Missing target");
          return;
        }
        setState("loading");
        const patch = { file_path: entry.patch.file_path, new_content: entry.patch.fixed_code };
        const result = await onApplyPatches([patch]);
        if (result.success) {
          setState("done");
          onApproved();
          onLog(`  ✓ Patch approved and applied → ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}`);
        } else {
          setState("error");
          setErrMsg(result.message);
          onLog(`  ✗ Patch apply failed → ${entry.vulnerability.file_path}: ${result.message}`);
        }
      }}
      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold
                 bg-emerald-600/20 border border-emerald-500 text-emerald-400
                 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      Approve &amp; Apply Fix
    </button>
  );
}

/* ── Tab definitions ──────────────────────────────────── */
type Tab = "overview" | "attack" | "reasoning" | "diff";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview",   label: "Overview",       icon: LayoutList },
  { id: "attack",     label: "Attack Vector",  icon: Swords },
  { id: "reasoning",  label: "AI Reasoning",   icon: Brain },
  { id: "diff",       label: "Code Diff",      icon: FileCode2 },
];

/* ── Expandable row ───────────────────────────────────── */
function EntryRow({
  entry,
  index,
  onLog,
  onApplyPatches,
  repoRoot,
  onPatchGenerated,
  onRollback,
}: {
  entry: HealingEntry;
  index: number;
  onLog: (msg: string) => void;
  onApplyPatches?: (patches: { file_path: string; new_content: string }[]) => Promise<{ success: boolean; message: string; pr_url?: string }>;
  repoRoot?: string;
  onPatchGenerated?: (index: number, patch: PatchResult, fixerThought: string, modelUsed: string) => void;
  onRollback?: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [healed, setHealed] = useState(entry.healed);
  const [localPatch, setLocalPatch] = useState(entry.patch);

  useEffect(() => {
    if (entry.healed) setHealed(true);
  }, [entry.healed]);
  
  useEffect(() => {
    if (entry.patch) setLocalPatch(entry.patch);
  }, [entry.patch]);

  const [simplified, setSimplified] = useState(false);
  const v = entry.vulnerability;

  const isPendingReview = localPatch?.success && localPatch?.fixed_code && !healed;
  const needsGeneration = !localPatch;
  const statusVariant = healed ? "healed" : isPendingReview ? "pending" : "unfixed";
  const statusLabel   = healed ? "Healed"  : isPendingReview ? "Pending Review" : needsGeneration ? "No Fix Yet" : "Unfixed";

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_4px_12px_rgba(0,0,0,0.2)] overflow-hidden transition-all hover:border-[var(--color-cyan)]/30">
      {/* ── Collapsed row ── */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <span className="text-[var(--color-text-muted)] text-[10px] font-mono w-5 shrink-0 text-right">
          {index + 1}
        </span>
        {open
          ? <ChevronDown  className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
        }
        <Badge variant={severityVariant(v.severity)} className="shrink-0 w-[76px] justify-center text-[10px]">
          {v.severity}
        </Badge>
        <span className="text-[13px] text-[var(--color-text-primary)] truncate flex-1">
          {v.issue.length > 90 ? v.issue.slice(0, 90) + "…" : v.issue}
        </span>
        <span className="text-[11px] text-[var(--color-text-muted)] font-mono shrink-0">
          {v.file_path}:{v.line_number}
        </span>
        <Badge variant={statusVariant} className="shrink-0 min-w-[100px] justify-center text-[10px]">
          {statusLabel}
        </Badge>
      </button>

      {/* ── Expanded card ── */}
      {open && (
        <div className="mx-3 mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 overflow-hidden">
          {/* Card header: title + action buttons */}
          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant={severityVariant(v.severity)} className="text-[10px]">{v.severity}</Badge>
                <code className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                  {v.file_path}:{v.line_number}
                </code>
              </div>
              <p className="text-[13px] font-medium text-[var(--color-text-primary)] leading-snug">
                {v.issue.length > 120 ? v.issue.slice(0, 120) + "…" : v.issue}
              </p>
            </div>
            {/* Action buttons */}
            <div className="shrink-0 pt-0.5 flex items-center gap-2">
              {needsGeneration && (
                <GenerateFix
                  entry={entry}
                  onGenerated={(patch, fixerThought, modelUsed) => {
                    setLocalPatch(patch);
                    if (onPatchGenerated) {
                      onPatchGenerated(index, patch, fixerThought, modelUsed);
                    }
                  }}
                  onLog={onLog}
                />
              )}
              {!needsGeneration && (
                <>
                  {repoRoot && (
                    <RollbackButton
                      entry={{ ...entry, healed }}
                      repoRoot={repoRoot}
                      onRollback={() => {
                        setHealed(false);
                        if (onRollback) onRollback(index);
                      }}
                      onLog={onLog}
                    />
                  )}
                  <ApproveFix
                    entry={{ ...entry, patch: localPatch, healed }}
                    onApproved={() => setHealed(true)}
                    onLog={onLog}
                    onApplyPatches={onApplyPatches}
                  />
                </>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold transition-all border-b-2 ${
                  activeTab === id
                    ? "border-[var(--color-cyan)] text-[var(--color-cyan)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "overview" && (
              <OverviewTab
                entry={entry}
                simplified={simplified}
                onSetSimplified={setSimplified}
              />
            )}
            {activeTab === "attack" && <AttackVectorTab vulnerability={v} />}
            {activeTab === "reasoning" && <AIReasoningTab entry={entry} />}
            {activeTab === "diff" && localPatch && <CodeDiffTab entry={{ ...entry, patch: localPatch }} />}
            {activeTab === "diff" && !localPatch && (
              <p className="text-[12px] text-[var(--color-text-muted)] italic text-center py-6">
                Generate a fix to see the code diff.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Healing History table ────────────────────────────── */

export function HealingHistory({
  entries,
  onLog,
  onApplyPatches,
  repoRoot,
  onPatchGenerated,
  onRollback,
}: {
  entries: HealingEntry[];
  onLog?: (msg: string) => void;
  onApplyPatches?: (patches: { file_path: string; new_content: string }[]) => Promise<{ success: boolean; message: string; pr_url?: string }>;
  repoRoot?: string;
  onPatchGenerated?: (index: number, patch: PatchResult, fixerThought: string, modelUsed: string) => void;
  onRollback?: (index: number) => void;
}) {
  const log = onLog ?? (() => {});

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
        <RadarAnimation />
      </div>
    );
  }

  return (
    <div className="space-y-4 print:shadow-none" id="healing-history">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          <span className="w-5 text-right">#</span>
          <span className="w-3.5" />
          <span className="w-[76px]">Severity</span>
          <span className="flex-1">Issue</span>
          <span className="w-32 text-right">Location</span>
          <span className="min-w-[100px] text-center">Status</span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-1.5 bg-[var(--color-bg-secondary)]/20">
          <span className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-widest font-semibold">Status legend:</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-purple-500 inline-block" />
            <span className="text-[9px] text-purple-400">Pending Review</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-emerald-500 inline-block" />
            <span className="text-[9px] text-emerald-400">Healed</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-slate-500 inline-block" />
            <span className="text-[9px] text-slate-400">Unfixed</span>
          </span>
          <span className="flex items-center gap-1 ml-2">
            <Radio className="h-2.5 w-2.5 text-[var(--color-text-muted)]" />
            <span className="text-[9px] text-[var(--color-text-muted)]">Click any row to expand</span>
          </span>
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-4">
        {entries.map((entry, i) => (
          <EntryRow
            key={i}
            entry={entry}
            index={i}
            onLog={log}
            onApplyPatches={onApplyPatches}
            repoRoot={repoRoot}
            onPatchGenerated={onPatchGenerated}
            onRollback={onRollback}
          />
        ))}
      </div>
    </div>
  );
}
