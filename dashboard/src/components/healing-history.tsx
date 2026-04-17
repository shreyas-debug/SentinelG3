"use client";

import { useState, useEffect, useCallback } from "react";
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
  X,
  Square,
  CheckSquare,
  Zap,
  ShieldAlert,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { CodeDiff } from "@/components/code-diff";
import { RadarAnimation } from "@/components/radar-animation";
import type { HealingEntry, PatchResult, PatchApprovalStatus, ValidationResult, GeneratedTestSuite } from "@/lib/api";

/** Maps severity string → Badge variant */
function severityVariant(s: string): "critical" | "high" | "medium" | "low" | "info" {
  const map: Record<string, "critical" | "high" | "medium" | "low" | "info"> = {
    critical: "critical", high: "high", medium: "medium", low: "low", info: "info",
  };
  return map[s.toLowerCase()] ?? "info";
}

// ── Confidence Badge ────────────────────────────────────
function ConfidenceBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 90 ? "text-[var(--color-emerald)] border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/10" :
    pct >= 70 ? "text-[var(--color-cyan)] border-[var(--color-cyan)]/30 bg-[var(--color-cyan)]/10" :
    pct >= 50 ? "text-[var(--color-amber)] border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10" :
                "text-[var(--color-red)] border-[var(--color-red)]/30 bg-[var(--color-red)]/10";
  
  const confidenceDesc = 
    pct >= 90 ? "Very high confidence - AI is highly certain this is a vulnerability" :
    pct >= 70 ? "High confidence - AI believes this is a real issue" :
    pct >= 50 ? "Medium confidence - AI thinks this might be a vulnerability" :
                "Low confidence - AI is uncertain, may be a false positive";

  return (
    <span 
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${color} cursor-help`}
      title={confidenceDesc}
    >
      <Zap className="h-2.5 w-2.5" />
      {pct}% conf.
    </span>
  );
}

// ── Risk Badge ──────────────────────────────────────────
function RiskBadge({ score }: { score?: number }) {
  if (!score) return null;
  const label =
    score >= 8 ? "Critical Risk" :
    score >= 6 ? "High Risk" :
    score >= 4 ? "Medium Risk" : "Low Risk";
  const color =
    score >= 8 ? "text-[var(--color-red)] border-[var(--color-red)]/30 bg-[var(--color-red)]/10" :
    score >= 6 ? "text-[var(--color-amber)] border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10" :
    score >= 4 ? "text-[var(--color-cyan)] border-[var(--color-cyan)]/30 bg-[var(--color-cyan)]/10" :
                 "text-[var(--color-text-muted)] border-[var(--color-border)] bg-[var(--color-bg-secondary)]";
  
  const riskDesc =
    score >= 8 ? "Critical risk - This fix changes critical logic and requires careful review" :
    score >= 6 ? "High risk - This fix modifies important code paths" :
    score >= 4 ? "Medium risk - This fix has moderate impact on behavior" :
                 "Low risk - This fix has minimal impact on existing functionality";

  return (
    <span 
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${color} cursor-help`}
      title={riskDesc}
    >
      <ShieldAlert className="h-2.5 w-2.5" />
      {label} ({score}/10)
    </span>
  );
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

      {/* Confidence + Risk metadata row */}
      {(v.confidence_score !== undefined || entry.patch?.risk_score) && (
        <div className="flex items-center gap-2 flex-wrap">
          <ConfidenceBadge score={v.confidence_score} />
          <RiskBadge score={entry.patch?.risk_score} />
          {v.false_positive_likelihood && v.false_positive_likelihood !== "low" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border text-[var(--color-amber)] border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10">
              FP: {v.false_positive_likelihood}
            </span>
          )}
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
      <CodeDiff
        original={entry.patch.original_code}
        fixed={entry.patch.fixed_code}
        filePath={entry.vulnerability.file_path}
        patchId={entry.patch.patch_id}
      />
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

/* ── Reject Fix Button ───────────────────────────────── */
function RejectFix({
  entry,
  onRejected,
  onLog,
}: {
  entry: HealingEntry;
  onRejected: () => void;
  onLog: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  if (entry.healed) return null;
  if (!entry.patch?.success || !entry.patch?.fixed_code) return null;
  if (entry.patch?.status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-red)]">
        <X className="h-3.5 w-3.5" />
        Rejected
      </span>
    );
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-red)]">
        <X className="h-3.5 w-3.5" />
        Rejected
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {errMsg || "Reject failed"}
      </span>
    );
  }

  if (showReason) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)…"
          className="flex-1 text-[11px] bg-[var(--color-bg-terminal)] border border-[var(--color-red)]/40 rounded px-2 py-1 text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-red)] placeholder:text-[var(--color-text-muted)]/40"
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              setState("loading");
              setShowReason(false);
              onLog(`  ✗ Rejecting fix for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}…`);
              setState("done");
              onRejected();
              onLog(`  ✗ Fix rejected — ${entry.vulnerability.file_path}`);
            }
            if (e.key === "Escape") setShowReason(false);
          }}
        />
        <button
          onClick={async () => {
            setState("loading");
            setShowReason(false);
            onLog(`  ✗ Rejecting fix for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}…`);
            setState("done");
            onRejected();
          }}
          className="px-2 py-1 rounded text-[11px] font-bold bg-[var(--color-red)]/20 border border-[var(--color-red)]/40 text-[var(--color-red)] hover:bg-[var(--color-red)]/30 transition-all"
        >
          Confirm
        </button>
        <button
          onClick={() => setShowReason(false)}
          className="px-2 py-1 rounded text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-all"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowReason(true)}
      disabled={state === "loading"}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold
                 bg-[var(--color-red)]/10 border border-[var(--color-red)]/40 text-[var(--color-red)]
                 hover:bg-[var(--color-red)]/20 transition-all active:scale-95 shadow-sm"
    >
      <X className="h-3.5 w-3.5" />
      Reject
    </button>
  );
}

/* ── (ValidateAndApplyFix removed — validation is now handled by ValidationSuitePanel) ── */
function _unused_ValidateAndApplyFix({
  entry,
  onApproved,
  onLog,
  onApplyPatches,
  onValidated,
}: {
  entry: HealingEntry;
  onApproved: () => void;
  onLog: (msg: string) => void;
  onApplyPatches?: (patches: { file_path: string; new_content: string }[]) => Promise<{ success: boolean; message: string; pr_url?: string }>;
  onValidated?: (validation: ValidationResult, tests: GeneratedTestSuite | null) => void;
}) {
  type VState = "idle" | "validating" | "validated_pass" | "validated_fail" | "applying" | "applied" | "apply_error" | "skipped";
  const [state, setState] = useState<VState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [localValidation, setLocalValidation] = useState<ValidationResult | null>(entry.validation ?? null);
  const [localTests, setLocalTests] = useState<GeneratedTestSuite | null>(entry.generated_tests ?? null);
  const [showExploits, setShowExploits] = useState(false);

  // Sync if parent provides validation (e.g. pre-populated entry)
  useEffect(() => {
    if (entry.validation) {
      setLocalValidation(entry.validation);
      if (entry.generated_tests) setLocalTests(entry.generated_tests);
      setState(entry.validation.vulnerability_fixed ? "validated_pass" : "validated_fail");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entry.healed || state === "applied") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Patch applied
      </span>
    );
  }
  if (entry.patch?.status === "rejected") return null;
  if (!entry.patch?.success || !entry.patch?.fixed_code) return null;

  const doApply = async (skipConfirm = false) => {
    if (!onApplyPatches) {
      // ZIP/GitHub bulk mode — no per-card apply; just mark validated
      return;
    }
    if (!entry.patch) return;
    setState("applying");
    const patch = { file_path: entry.patch.file_path, new_content: entry.patch.fixed_code };
    const result = await onApplyPatches([patch]);
    if (result.success) {
      setState("applied");
      onApproved();
      onLog(`  ✓ Patch applied → ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}`);
    } else {
      setState("apply_error");
      setErrMsg(result.message);
      onLog(`  ✗ Apply failed → ${entry.vulnerability.file_path}: ${result.message}`);
    }
  };

  if (state === "validating") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-purple-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing &amp; Validating…
      </span>
    );
  }

  if (state === "applying") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying patch…
      </span>
    );
  }

  if (state === "apply_error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" /> {errMsg || "Apply failed"}
      </span>
    );
  }

  if (state === "skipped") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400 border border-yellow-500/40 bg-yellow-500/10 rounded px-2 py-0.5">
          <AlertTriangle className="h-3 w-3" /> Validation skipped
        </span>
        {onApplyPatches && (
          <button onClick={() => doApply(true)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95">
            <CheckCircle2 className="h-3.5 w-3.5" /> Apply Fix
          </button>
        )}
      </div>
    );
  }

  if ((state === "validated_pass" || state === "validated_fail") && localValidation) {
    const passed = localValidation.vulnerability_fixed;
    const pct = Math.round(localValidation.confidence_score * 100);
    return (
      <div className="flex flex-col gap-2 w-full">
        {/* Validation summary badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold border rounded px-2 py-0.5 ${
            passed
              ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
              : "text-yellow-400 border-yellow-500/40 bg-yellow-500/10"
          }`}>
            {passed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {passed ? "Validated" : "Needs Revision"} · {pct}% confidence
          </span>

          {/* Exploit tests toggle */}
          {localValidation.exploit_tests.length > 0 && (
            <button
              onClick={() => setShowExploits((v) => !v)}
              className="text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              {showExploits ? "Hide" : "Show"} {localValidation.exploit_tests.length} exploit tests
            </button>
          )}

          {/* Tests badge */}
          {localTests && localTests.test_cases.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[9px] text-purple-400 border border-purple-500/30 bg-purple-500/10 rounded px-1.5 py-0.5">
              <FlaskConical className="h-2.5 w-2.5" /> {localTests.test_cases.length} tests generated
            </span>
          )}
        </div>

        {/* Exploit tests detail */}
        {showExploits && (
          <div className="space-y-1 pl-1">
            {localValidation.exploit_tests.map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[10px] p-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                <span className="truncate text-[var(--color-text-muted)]">
                  <span className="font-semibold text-[var(--color-text)]">{t.attack_type}:</span> {t.payload}
                </span>
                {t.blocked_by_patch
                  ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                  : <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                }
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {onApplyPatches && (
            <button
              onClick={() => doApply()}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-all active:scale-95 ${
                passed
                  ? "bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30"
                  : "bg-yellow-600/20 border border-yellow-500 text-yellow-400 hover:bg-yellow-600/30"
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {passed ? "Apply Fix" : "Apply Anyway"}
            </button>
          )}
          {!passed && (
            <span className="text-[9px] text-[var(--color-text-muted)]">
              Fix may not fully resolve the vulnerability
            </span>
          )}
        </div>
      </div>
    );
  }

  // Default: idle — show "Test & Validate" button
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={async () => {
          if (!entry.patch?.original_code || !entry.patch?.fixed_code) return;
          setState("validating");
          onLog(`  🔍 Testing & validating fix for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}…`);
          try {
            const result = await validatePatch({
              vulnerability: entry.vulnerability,
              original_code: entry.patch.original_code,
              patched_code: entry.patch.fixed_code,
            });
            setLocalValidation(result.validation);
            setLocalTests(result.generated_tests);
            onValidated?.(result.validation, result.generated_tests);
            setState(result.validation.vulnerability_fixed ? "validated_pass" : "validated_fail");
            const pct = Math.round(result.validation.confidence_score * 100);
            onLog(`  ${result.validation.vulnerability_fixed ? "✅" : "⚠️"} Validation: ${result.validation.vulnerability_fixed ? "Fixed" : "Needs revision"} (${pct}% confidence)`);
            if (result.generated_tests) {
              onLog(`  🧪 Generated ${result.generated_tests.test_cases.length} test case(s)`);
            }
          } catch (err) {
            setState("idle");
            onLog(`  ✗ Validation failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold
                   bg-purple-600/20 border border-purple-500 text-purple-400
                   hover:bg-purple-600/30 transition-all active:scale-95 shadow-sm"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        Test &amp; Validate
      </button>
      <button
        onClick={() => {
          onValidated?.(
            { vulnerability_fixed: false, confidence_score: 0, exploit_tests: [], functional_impact: "", recommendation: "Skipped", reasoning: "User skipped validation." },
            null,
          );
          setState("skipped");
          onLog(`  ⚠️ Validation skipped for ${entry.vulnerability.file_path}:${entry.vulnerability.line_number}`);
        }}
        className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline transition-colors"
      >
        skip
      </button>
    </div>
  );
}

/* ── Tab definitions ──────────────────────────────────── */
type Tab = "overview" | "attack" | "reasoning" | "diff";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview",  label: "Overview",      icon: LayoutList },
  { id: "attack",    label: "Attack Vector", icon: Swords },
  { id: "reasoning", label: "AI Reasoning",  icon: Brain },
  { id: "diff",      label: "Code Diff",     icon: FileCode2 },
];

/* ── Expandable row ───────────────────────────────────── */
function EntryRow({
  entry,
  index,
  onLog,
  repoRoot,
  onPatchGenerated,
  onRollback,
  selectable,
  selected,
  onSelect,
}: {
  entry: HealingEntry;
  index: number;
  onLog: (msg: string) => void;
  repoRoot?: string;
  onPatchGenerated?: (index: number, patch: PatchResult, fixerThought: string, modelUsed: string) => void;
  onRollback?: (index: number) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (index: number, selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [healed, setHealed] = useState(entry.healed);
  const [rejected, setRejected] = useState(entry.patch?.status === "rejected");
  const [localPatch, setLocalPatch] = useState(entry.patch);

  useEffect(() => {
    if (entry.healed) setHealed(true);
  }, [entry.healed]);

  useEffect(() => {
    if (entry.patch) setLocalPatch(entry.patch);
  }, [entry.patch]);

  const [simplified, setSimplified] = useState(false);
  const v = entry.vulnerability;

  const isPendingReview = localPatch?.success && localPatch?.fixed_code && !healed && !rejected;
  const needsGeneration = !localPatch;
  const patchFailed = localPatch && !localPatch.success;
  const statusVariant = healed ? "healed" : rejected ? "unfixed" : isPendingReview ? "pending" : "unfixed";
  const statusLabel = healed ? "Healed" : rejected ? "Rejected" : isPendingReview ? "Pending Review" : patchFailed ? "Fix Failed" : needsGeneration ? "No Fix Yet" : "Unfixed";

  return (
    <div className={`mb-4 rounded-xl border overflow-hidden transition-all hover:border-[var(--color-cyan)]/30 shadow-[0_4px_12px_rgba(0,0,0,0.2)] ${
      rejected ? "border-[var(--color-red)]/30 bg-[var(--color-red)]/5" :
      healed ? "border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/5" :
      "border-[var(--color-border)] bg-[var(--color-bg-card)]"
    }`}>
      {/* ── Collapsed row ── */}
      <div className="flex items-center">
        {/* Checkbox for batch select */}
        {selectable && (
          <div className="pl-3 pr-1 py-3.5 flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onSelect?.(index, !selected)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-cyan)] transition-colors"
              aria-label={selected ? "Deselect" : "Select"}
            >
              {selected
                ? <CheckSquare className="h-4 w-4 text-[var(--color-cyan)]" />
                : <Square className="h-4 w-4" />
              }
            </button>
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center gap-3 px-4 py-3.5 text-left bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
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
      </div>

      {/* ── Expanded card ── */}
      {open && (
        <div className="mx-3 mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 overflow-hidden">
          {/* Card header: title + action buttons */}
          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <code className="text-[11px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                  {v.file_path}:{v.line_number}
                </code>
              </div>
              <p className="text-[14px] font-medium text-[var(--color-text-primary)] leading-snug">
                {v.issue}
              </p>
            </div>
            {/* Action buttons */}
            <div className="shrink-0 pt-0.5 flex items-center gap-2 flex-wrap justify-end">
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
              {patchFailed && (
                <div className="flex items-center gap-2">
                  <span 
                    className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-amber)] border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 rounded-md px-2.5 py-1 cursor-help"
                    title={localPatch?.message || "Fix generation failed"}
                  >
                    <AlertTriangle className="h-3 w-3" /> Fix Failed
                  </span>
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
                </div>
              )}
              {!needsGeneration && !rejected && !patchFailed && (
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
                  <RejectFix
                    entry={{ ...entry, patch: localPatch, healed }}
                    onRejected={() => setRejected(true)}
                    onLog={onLog}
                  />
                  {/* Validation & deploy is handled by the ValidationSuitePanel below */}
                  {!healed && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-purple-400/70 border border-purple-500/20 bg-purple-500/5 rounded px-2 py-1 font-mono">
                      awaiting validation
                    </span>
                  )}
                </>
              )}
              {rejected && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-red)] border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 rounded-md px-2.5 py-1">
                  <X className="h-3 w-3" /> Patch Rejected
                </span>
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
                entry={{ ...entry, patch: localPatch }}
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

/* ── Bulk Action Toolbar ──────────────────────────────── */
function BulkActionToolbar({
  selectedCount,
  onApproveSelected,
  onRejectSelected,
  onClearSelection,
}: {
  selectedCount: number;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-10 mx-auto max-w-xl">
      <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-[var(--color-cyan)]/30 bg-[var(--color-bg-card)]/90 backdrop-blur-md shadow-2xl">
        <span className="text-[12px] font-bold text-[var(--color-cyan)] shrink-0">
          {selectedCount} selected
        </span>
        <div className="flex-1 h-px bg-[var(--color-border)]" />
        <button
          onClick={onApproveSelected}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mark Reviewed
        </button>
        <button
          onClick={onRejectSelected}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--color-red)]/10 border border-[var(--color-red)]/40 text-[var(--color-red)] hover:bg-[var(--color-red)]/20 transition-all"
        >
          <X className="h-3.5 w-3.5" />
          Reject All
        </button>
        <button
          onClick={onClearSelection}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ── Healing History table ────────────────────────────── */

export function HealingHistory({
  entries,
  scanning,
  phase,
  onLog,
  repoRoot,
  onPatchGenerated,
  onRollback,
}: {
  entries: HealingEntry[];
  scanning?: boolean;
  phase?: string;
  onLog?: (msg: string) => void;
  repoRoot?: string;
  onPatchGenerated?: (index: number, patch: PatchResult, fixerThought: string, modelUsed: string) => void;
  onRollback?: (index: number) => void;
}) {
  const log = onLog ?? (() => {});
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const toggleSelect = useCallback((index: number, selected: boolean) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (selected) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

  const handleApproveSelected = useCallback(() => {
    // Deployment is now handled by the Validation Suite panel below
    log("  ℹ Use the Validation Suite to deploy selected patches.");
    setSelectedIndices(new Set());
  }, [log]);

  const handleRejectSelected = useCallback(() => {
    log(`  ✗ Bulk-rejected ${selectedIndices.size} patches.`);
    setSelectedIndices(new Set());
  }, [selectedIndices, log]);

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
        {scanning ? (
          <div className="p-12 text-center space-y-4">
            <div className="flex items-center justify-center">
              <Loader2 className="h-12 w-12 text-[var(--color-cyan)] animate-spin" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {phase === "scanning" ? "🔍 Scanning Repository..." : phase === "patching" ? "🔧 Generating Fixes..." : "⚡ Initializing..."}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {phase === "scanning" 
                ? "AI agents are analyzing your code for vulnerabilities" 
                : phase === "patching"
                ? "AI is reasoning through security patches"
                : "Starting security audit"}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-1">
                <Brain className="h-3 w-3 text-[var(--color-cyan)]" />
                Gemini 3 {phase === "scanning" ? "Auditor" : "Fixer"}
              </span>
              <span>•</span>
              <span>thinking_level=HIGH</span>
            </div>
          </div>
        ) : (
          <RadarAnimation />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 print:shadow-none" id="healing-history">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          {/* Select-all checkbox */}
          <button
            onClick={() => {
              if (selectedIndices.size === entries.length) {
                setSelectedIndices(new Set());
              } else {
                setSelectedIndices(new Set(entries.map((_, i) => i)));
              }
            }}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-cyan)] transition-colors"
            title={selectedIndices.size === entries.length ? "Deselect all" : "Select all"}
          >
            {selectedIndices.size === entries.length && entries.length > 0
              ? <CheckSquare className="h-4 w-4 text-[var(--color-cyan)]" />
              : <Square className="h-4 w-4" />
            }
          </button>
          <span className="w-5 text-right">#</span>
          <span className="w-3.5" />
          <span className="w-[76px]">Severity</span>
          <span className="flex-1">Issue</span>
          <span className="text-right">Confidence</span>
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
            <span className="w-2 h-2 rounded-full border border-red-500 inline-block" />
            <span className="text-[9px] text-red-400">Rejected</span>
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
            repoRoot={repoRoot}
            onPatchGenerated={onPatchGenerated}
            onRollback={onRollback}
            selectable
            selected={selectedIndices.has(i)}
            onSelect={toggleSelect}
          />
        ))}
      </div>

      {/* Bulk action toolbar */}
      <BulkActionToolbar
        selectedCount={selectedIndices.size}
        onApproveSelected={handleApproveSelected}
        onRejectSelected={handleRejectSelected}
        onClearSelection={() => setSelectedIndices(new Set())}
      />
    </div>
  );
}
