"use client";

import { useState, useRef, useCallback } from "react";
import {
  FlaskConical,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Download,
  GitPullRequest,
  Shield,
  Zap,
  TestTube2,
} from "lucide-react";
import type {
  HealingEntry,
  FileBatchValidation,
  GeneratedTestSuite,
  TestCase,
} from "@/lib/api";
import { validatePatchBatch, applyBatchPatches } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────

function confidenceBar(score: number) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  const textColor =
    pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-yellow-400" : "text-red-400";
  return { pct, color, textColor };
}

function priorityStyle(p: string) {
  switch (p) {
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

// ── TestCaseRow ───────────────────────────────────────────

function TestCaseRow({ tc }: { tc: TestCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden text-[11px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-3 py-2 bg-[var(--color-bg)] hover:bg-[var(--color-bg-secondary)] transition-colors text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
          )}
          <code className="font-semibold text-[var(--color-cyan)] truncate">{tc.name}</code>
          <span className="text-[var(--color-text-muted)] hidden sm:block truncate">— {tc.description}</span>
        </span>
        <span
          className={`shrink-0 ml-2 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${priorityStyle(tc.priority)}`}
        >
          {tc.priority}
        </span>
      </button>
      {open && (
        <div className="bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)] px-3 pb-3 pt-2">
          <p className="text-[10px] text-[var(--color-text-muted)] mb-2">{tc.description}</p>
          <pre className="text-[10px] leading-relaxed text-[var(--color-text)] bg-[var(--color-bg)] rounded p-3 overflow-x-auto">
            {tc.code}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── FileResultCard ────────────────────────────────────────

function FileResultCard({
  result,
  onDownload,
}: {
  result: FileBatchValidation;
  onDownload: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { pct, color, textColor } = confidenceBar(result.overall_confidence);

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all ${
        result.all_fixed
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-yellow-500/30 bg-yellow-500/5"
      }`}
    >
      {/* File header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <FileCode2 className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        <span className="font-mono text-[12px] font-semibold text-[var(--color-text)] flex-1 truncate">
          {result.file_path}
        </span>

        {/* Confidence badge */}
        <span className={`flex items-center gap-1 text-[11px] font-bold ${textColor}`}>
          {result.all_fixed ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {pct}% confidence
        </span>

        {/* Tests count */}
        {result.generated_tests && result.generated_tests.test_cases.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-purple-400 border border-purple-500/30 bg-purple-500/10 rounded px-1.5 py-0.5">
            <TestTube2 className="h-3 w-3" />
            {result.generated_tests.test_cases.length} tests
          </span>
        )}

        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)]">
          {/* Confidence bar */}
          <div className="pt-3">
            <div className="h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Per-vuln breakdown */}
          {result.per_vuln.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                Vulnerability Results
              </p>
              {result.per_vuln.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-2 text-[11px] p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--color-text)] truncate">{item.issue_key}</p>
                    {item.exploit_tests.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.exploit_tests.map((e, j) => (
                          <span
                            key={j}
                            className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                              e.blocked_by_patch
                                ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                : "text-red-400 border-red-500/30 bg-red-500/10"
                            }`}
                          >
                            {e.blocked_by_patch ? (
                              <CheckCircle className="h-2.5 w-2.5" />
                            ) : (
                              <XCircle className="h-2.5 w-2.5" />
                            )}
                            {e.attack_type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-bold ${confidenceBar(item.confidence_score).textColor}`}>
                      {Math.round(item.confidence_score * 100)}%
                    </span>
                    {item.vulnerability_fixed ? (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Generated test cases */}
          {result.generated_tests && result.generated_tests.test_cases.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1">
                  <TestTube2 className="h-3 w-3" /> Generated Test Cases
                </p>
                <button
                  onClick={onDownload}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </div>
              <div className="space-y-1.5">
                {result.generated_tests.test_cases.map((tc, i) => (
                  <TestCaseRow key={i} tc={tc} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileStatusRow (pre-run overview) ─────────────────────

function FileStatusRow({
  filePath,
  issueCount,
  status,
  onRunSingle,
}: {
  filePath: string;
  issueCount: number;
  status: "pending" | "validating" | "done" | "error";
  onRunSingle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-cyan)]/30 transition-all">
      <FileCode2 className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
      <span className="font-mono text-[12px] text-[var(--color-text)] flex-1 truncate">{filePath}</span>
      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>

      {/* Status indicator */}
      <div className="shrink-0 w-24 flex justify-center">
        {status === "pending" && (
          <span className="text-[10px] text-[var(--color-text-muted)] border border-[var(--color-border)] rounded px-2 py-0.5">
            Pending
          </span>
        )}
        {status === "validating" && (
          <span className="inline-flex items-center gap-1 text-[10px] text-purple-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Validating…
          </span>
        )}
        {status === "done" && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
            <CheckCircle className="h-3 w-3" /> Done
          </span>
        )}
        {status === "error" && (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
            <XCircle className="h-3 w-3" /> Error
          </span>
        )}
      </div>

      {status === "pending" && (
        <button
          onClick={onRunSingle}
          className="text-[10px] text-[var(--color-cyan)] hover:underline shrink-0"
        >
          Run only
        </button>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────

interface ValidationSuitePanelProps {
  entries: HealingEntry[];
  scanMode: "local" | "github" | "upload";
  githubToken?: string;
  createPr?: boolean;
  isApplyingAll?: boolean;
  scanning?: boolean;
  onDownloadZip: () => void;
  onApplyLocal: () => Promise<void>;
  onCreatePR: () => Promise<void>;
  onLog: (msg: string) => void;
}

type FileStatus = "pending" | "validating" | "done" | "error";

interface FileGroup {
  file_path: string;
  entries: HealingEntry[];
  status: FileStatus;
  result: FileBatchValidation | null;
  error: string | null;
}

export function ValidationSuitePanel({
  entries,
  scanMode,
  githubToken,
  createPr,
  isApplyingAll,
  scanning,
  onDownloadZip,
  onApplyLocal,
  onCreatePR,
  onLog,
}: ValidationSuitePanelProps) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [deployState, setDeployState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [deployError, setDeployError] = useState("");

  // Build file groups from entries that have a patch ready
  const readyEntries = entries.filter(
    (e) => e.patch?.success && e.patch?.fixed_code && !e.healed && e.patch.status !== "rejected",
  );

  // Group by file
  const fileMap = new Map<string, HealingEntry[]>();
  for (const e of readyEntries) {
    const fp = e.vulnerability.file_path;
    if (!fileMap.has(fp)) fileMap.set(fp, []);
    fileMap.get(fp)!.push(e);
  }
  const fileKeys = Array.from(fileMap.keys());

  const [fileGroups, setFileGroups] = useState<FileGroup[]>(() =>
    fileKeys.map((fp) => ({
      file_path: fp,
      entries: fileMap.get(fp)!,
      status: "pending" as FileStatus,
      result: null,
      error: null,
    })),
  );

  // Reset groups when entries change (new scan)
  const prevEntryCount = useRef(readyEntries.length);
  if (readyEntries.length !== prevEntryCount.current) {
    prevEntryCount.current = readyEntries.length;
    const newGroups = fileKeys.map((fp) => ({
      file_path: fp,
      entries: fileMap.get(fp)!,
      status: "pending" as FileStatus,
      result: null,
      error: null,
    }));
    // Only reset if the file set actually changed
    if (
      newGroups.length !== fileGroups.length ||
      newGroups.some((g, i) => g.file_path !== fileGroups[i]?.file_path)
    ) {
      setFileGroups(newGroups);
    }
  }

  const allDone = fileGroups.length > 0 && fileGroups.every((g) => g.status === "done");
  const anyDone = fileGroups.some((g) => g.status === "done");
  const totalTests = fileGroups.reduce(
    (s, g) => s + (g.result?.generated_tests?.test_cases.length ?? 0),
    0,
  );
  const allFixed = fileGroups.every((g) => g.result?.all_fixed !== false);

  const validateFile = useCallback(
    async (idx: number) => {
      const group = fileGroups[idx];
      if (!group || group.entries.length === 0) return;
      const firstEntry = group.entries[0];
      if (!firstEntry.patch?.original_code || !firstEntry.patch?.fixed_code) return;

      setFileGroups((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: "validating", error: null };
        return next;
      });

      onLog(`  🔍 Validating ${group.file_path} (${group.entries.length} issue(s))…`);

      try {
        const result = await validatePatchBatch({
          file_path: group.file_path,
          vulnerabilities: group.entries.map((e) => e.vulnerability),
          original_code: firstEntry.patch.original_code,
          patched_code: firstEntry.patch.fixed_code,
        });

        setFileGroups((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "done", result };
          return next;
        });

        const pct = Math.round(result.overall_confidence * 100);
        onLog(
          `  ${result.all_fixed ? "✅" : "⚠️"} ${group.file_path}: ${
            result.all_fixed ? "all fixed" : "needs revision"
          } (${pct}% confidence, ${result.generated_tests?.test_cases.length ?? 0} tests generated)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFileGroups((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "error", error: msg };
          return next;
        });
        onLog(`  ✗ Validation failed for ${group.file_path}: ${msg}`);
      }
    },
    [fileGroups, onLog],
  );

  const runAll = useCallback(async () => {
    setRunning(true);
    for (let i = 0; i < fileGroups.length; i++) {
      if (fileGroups[i].status !== "done") {
        await validateFile(i);
      }
    }
    setRunning(false);
    // Auto-scroll to results
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }, [fileGroups, validateFile]);

  if (readyEntries.length === 0) return null;

  const showDeploy =
    scanMode === "github" || scanMode === "upload" || scanMode === "local";
  const showDownload =
    (scanMode === "github" && (!githubToken || !createPr)) || scanMode === "upload";
  const showApplyLocal = scanMode === "local";
  const showCreatePR = scanMode === "github" && githubToken && createPr;

  return (
    <section className="mt-6 space-y-4">
      {/* ── Zone 2: Validation Suite header ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-sm">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40">
          <div className="flex items-center gap-3">
            <FlaskConical className="h-5 w-5 text-purple-400 shrink-0" />
            <div>
              <h2 className="text-[13px] font-bold text-[var(--color-text)]">
                Validation Suite
              </h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                {fileGroups.length} {fileGroups.length === 1 ? "file" : "files"} ·{" "}
                {readyEntries.length} patches ready ·{" "}
                {allDone
                  ? `${totalTests} tests generated`
                  : "validate before deploying"}
              </p>
            </div>
          </div>

          <button
            onClick={runAll}
            disabled={running || scanning || allDone}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-bold transition-all active:scale-95 shadow ${
              allDone
                ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 cursor-default"
                : "bg-purple-600/20 border border-purple-500 text-purple-300 hover:bg-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Validating…
              </>
            ) : allDone ? (
              <>
                <CheckCircle className="h-4 w-4" /> Validation Complete
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Run Validation Suite
              </>
            )}
          </button>
        </div>

        {/* File list */}
        <div className="p-4 space-y-2">
          {fileGroups.map((group, i) => (
            <FileStatusRow
              key={group.file_path}
              filePath={group.file_path}
              issueCount={group.entries.length}
              status={group.status}
              onRunSingle={() => validateFile(i)}
            />
          ))}
        </div>

        {/* Workflow hint */}
        {!allDone && (
          <div className="px-5 pb-4 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            <Zap className="h-3 w-3 text-yellow-500 shrink-0" />
            One Gemini call per file — all issues in a file are validated together to save tokens.
          </div>
        )}
      </div>

      {/* ── Zone 3: Results (auto-scrolled to) ── */}
      {anyDone && (
        <div ref={resultsRef} className="space-y-4 scroll-mt-8">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-2">
              <TestTube2 className="h-3.5 w-3.5 text-purple-400" />
              Test Results
            </h3>
            {totalTests > 0 && (
              <button
                onClick={() => {
                  fileGroups.forEach((g) => {
                    if (g.result?.generated_tests) {
                      const safeName = g.file_path.replace(/[/\\]/g, "_").replace(/\.\w+$/, "");
                      downloadTestFile(g.result.generated_tests, `test_${safeName}_security.py`);
                    }
                  });
                }}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors font-semibold"
              >
                <Download className="h-3.5 w-3.5" /> Download All Tests
              </button>
            )}
          </div>

          {/* Per-file result cards */}
          <div className="space-y-3">
            {fileGroups
              .filter((g) => g.status === "done" && g.result)
              .map((g) => (
                <FileResultCard
                  key={g.file_path}
                  result={g.result!}
                  onDownload={() => {
                    if (g.result?.generated_tests) {
                      const safeName = g.file_path.replace(/[/\\]/g, "_").replace(/\.\w+$/, "");
                      downloadTestFile(g.result.generated_tests, `test_${safeName}_security.py`);
                    }
                  }}
                />
              ))}
            {fileGroups
              .filter((g) => g.status === "error")
              .map((g) => (
                <div
                  key={g.file_path}
                  className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3 text-[11px]"
                >
                  <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-400 font-mono">{g.file_path}</p>
                    <p className="text-[var(--color-text-muted)] mt-0.5">{g.error}</p>
                  </div>
                </div>
              ))}
          </div>

          {/* ── Deploy bar ── */}
          {allDone && showDeploy && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[12px] font-bold text-[var(--color-text)]">
                    {allFixed ? "✅ All patches verified" : "⚠️ Some patches need revision"}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    {allFixed
                      ? "Ready to deploy — choose your deployment method below."
                      : "You can still deploy, but review the flagged issues first."}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {showDownload && (
                    <button
                      onClick={onDownloadZip}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-cyan-600/20 border border-cyan-500 text-cyan-400 hover:bg-cyan-600/30 transition-all active:scale-95 shadow-sm"
                    >
                      <Download className="h-4 w-4" /> Download as ZIP
                    </button>
                  )}
                  {showApplyLocal && (
                    <button
                      onClick={async () => {
                        setDeployState("running");
                        try {
                          await onApplyLocal();
                          setDeployState("done");
                        } catch {
                          setDeployState("error");
                        }
                      }}
                      disabled={deployState === "running" || !!isApplyingAll}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deployState === "running" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                      ) : deployState === "done" ? (
                        <><CheckCircle className="h-4 w-4" /> Applied!</>
                      ) : (
                        <><Shield className="h-4 w-4" /> Apply to Local Files</>
                      )}
                    </button>
                  )}
                  {showCreatePR && (
                    <button
                      onClick={async () => {
                        setDeployState("running");
                        try {
                          await onCreatePR();
                          setDeployState("done");
                        } catch {
                          setDeployState("error");
                        }
                      }}
                      disabled={deployState === "running" || !!isApplyingAll}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deployState === "running" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Creating PR…</>
                      ) : deployState === "done" ? (
                        <><CheckCircle className="h-4 w-4" /> PR Created!</>
                      ) : (
                        <><GitPullRequest className="h-4 w-4" /> Create Pull Request</>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {deployState === "error" && (
                <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" /> {deployError || "Deployment failed. Check the logs."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
