"use client";

import { useCallback, useRef, useState } from "react";
import {
  Shield,
  FolderOpen,
  Github,
  GitPullRequest,
  ExternalLink,
  KeyRound,
  Bot,
  FileDown,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { LiveFeed } from "@/components/live-feed";
import { HealingHistory } from "@/components/healing-history";
import { StatsBar } from "@/components/stats-bar";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { StatusBadge } from "@/components/status-badge";
import { startScan, generateReport, applyBatchPatches, type HealingEntry, type HealingSummary, type PRResult, type SSEEvent } from "@/lib/api";

const DEFAULT_LOCAL = "E:\\Personal\\SentinelG3\\target_code";
type ScanMode = "local" | "github";
const FIXING_RE = /\[(\d+)\/(\d+)\]\s+Fixing\s+(.+?):(\d+)\s+\((\w+)\)/;

/* ── Auto-Apply confirmation modal ──────────────────────── */
function AutoApplyModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-red)]/30 bg-[var(--color-bg-card)] shadow-2xl p-6 mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[var(--color-red)]/10 shrink-0">
            <AlertTriangle className="h-5 w-5 text-[var(--color-red)]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-primary)] mb-1">
              Enable Auto-Apply Fixes?
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
              When Auto-Apply is <strong className="text-[var(--color-red)]">enabled</strong>, Sentinel-G3 will
              write patched code directly to disk without asking you to review each change first.
              <br /><br />
              This is fast, but patches cannot be automatically undone. A <code className="text-[var(--color-amber)] text-[11px]">.bak</code> backup is created for each file.
              <br /><br />
              <strong className="text-[var(--color-text-primary)]">Recommended:</strong> Keep Auto-Apply OFF and review each fix manually.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-[12px] font-semibold border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Cancel — Keep Review Mode
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-md text-[12px] font-semibold bg-[var(--color-red)]/15 border border-[var(--color-red)]/40 text-[var(--color-red)] hover:bg-[var(--color-red)]/25 transition-colors"
          >
            ⚠️ Enable Auto-Apply
          </button>
        </div>
        <button onClick={onCancel} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [scanning, setScanning]     = useState(false);
  const [logs, setLogs]             = useState<string[]>([]);
  const [entries, setEntries]       = useState<HealingEntry[]>([]);
  const [stats, setStats]           = useState({ scannedFiles: 0, found: 0, healed: 0 });
  const [scanMode, setScanMode]     = useState<ScanMode>("github");
  const [targetDir, setTargetDir]   = useState(DEFAULT_LOCAL);
  const [repoUrl, setRepoUrl]       = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [createPr, setCreatePr]     = useState(true);
  const [prResult, setPrResult]     = useState<PRResult | null>(null);
  const [summary, setSummary]       = useState<HealingSummary | null>(null);

  /**
   * Auto-Apply: defaults to FALSE (review-first is the safe default).
   * User must consciously opt in via the toggle with a confirmation modal.
   */
  const [autoApply, setAutoApply]   = useState(false);
  const [showAutoApplyModal, setShowAutoApplyModal] = useState(false);

  const [activeFix, setActiveFix]       = useState<string | null>(null);
  const [liveThinking, setLiveThinking] = useState("");
  const [activeVulnCode, setActiveVulnCode] = useState("");
  const [activeFilePath, setActiveFilePath] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "patching" | "complete">("idle");
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const activeTarget = scanMode === "github" ? repoUrl : targetDir;

  const handleApplyPatches = async (patches: { file_path: string; new_content: string }[]) => {
    return await applyBatchPatches(activeTarget, patches, {
      createPr,
      githubToken: githubToken || undefined,
    });
  };

  const handleApplyAllUnfixed = async () => {
    const unfixed = entries
      .filter((e) => e.patch.success && e.patch.fixed_code && !e.healed)
      .map((e) => ({ file_path: e.patch.file_path, new_content: e.patch.fixed_code }));

    if (unfixed.length === 0) return;
    
    setIsApplyingAll(true);
    pushLog(`▶ Applying exactly ${unfixed.length} patches to ${activeTarget}…`);
    
    const result = await handleApplyPatches(unfixed);
    
    if (result.success) {
      pushLog(`  ✓ Successfully applied ${unfixed.length} patches.`);
      if (result.pr_url) {
        setPrResult({ url: result.pr_url, number: parseInt(result.pr_url.split("/").pop() || "0", 10), branch: result.pr_url });
        pushLog(`  ✓ Created Pull Request: ${result.pr_url}`);
      }
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.patch.success && entry.patch.fixed_code && !entry.healed) {
            return { ...entry, healed: true };
          }
          return entry;
        })
      );
      setStats((s) => ({ ...s, healed: s.healed + unfixed.length }));
    } else {
      pushLog(`  ✗ Failed to bulk-apply patches: ${result.message}`);
    }
    
    setIsApplyingAll(false);
  };

  /** Push a message into the live terminal feed (used by HealingHistory on Approve) */
  const pushLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const handleScan = useCallback(() => {
    if (!activeTarget.trim()) return;
    setScanning(true);
    setLogs([]);
    setEntries([]);
    setStats({ scannedFiles: 0, found: 0, healed: 0 });
    setPrResult(null);
    setSummary(null);
    setActiveFix(null);
    setLiveThinking("");
    setActiveVulnCode("");
    setActiveFilePath("");
    setPhase("scanning");

    controllerRef.current = startScan(
      activeTarget,
      (event: SSEEvent) => {
        switch (event.type) {
          case "log": {
            const msg = event.data.message;
            setLogs((prev) => [...prev, msg]);
            if (msg.includes("Stage 2") || msg.includes("Generating patches")) setPhase("patching");
            const match = FIXING_RE.exec(msg);
            if (match) {
              const [, idx, total, file, line, severity] = match;
              setActiveFix(`[${idx}/${total}] ${file}:${line} (${severity})`);
              setActiveFilePath(`${file}:${line}`);
              setLiveThinking("");
            }
            break;
          }
          case "thinking":
            setLiveThinking((prev) => prev + event.data.text);
            break;
          case "vuln":
            setStats((prev) => ({ ...prev, found: prev.found + 1 }));
            break;
          case "patch":
            setActiveFix(null);
            setLiveThinking("");
            setActiveVulnCode("");
            setActiveFilePath("");
            setEntries((prev) => [...prev, event.data as HealingEntry]);
            if ((event.data as HealingEntry).healed) {
              setStats((prev) => ({ ...prev, healed: prev.healed + 1 }));
            }
            break;
          case "summary":
            setActiveFix(null);
            setPhase("complete");
            setSummary(event.data as HealingSummary);
            setStats({
              scannedFiles: event.data.scanned_files,
              found: event.data.vulnerabilities_found,
              healed: event.data.vulnerabilities_healed,
            });
            if (event.data.entries) setEntries(event.data.entries);
            break;
          case "pr":
            setPrResult(event.data);
            break;
          case "error":
            setLogs((prev) => [...prev, `ERROR: ${event.data.message}`]);
            break;
        }
      },
      () => {
        setScanning(false);
        setActiveFix(null);
        setLiveThinking("");
        if (phase !== "complete") setPhase("complete");
      },
      scanMode === "github"
        ? { githubToken, createPr, autoApply }
        : { autoApply },
    );
  }, [activeTarget, githubToken, createPr, autoApply, scanMode, phase]);

  const handleExportReport = async () => {
    const scanSummary = summary ?? {
      run_id: "manual",
      repository_path: activeTarget,
      scanned_files: stats.scannedFiles,
      vulnerabilities_found: stats.found,
      vulnerabilities_healed: stats.healed,
      entries,
    };
    const htmlUrl = await generateReport(scanSummary);
    window.open(htmlUrl, "_blank");
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] bg-grid-pattern">
      {/* Auto-Apply confirmation modal */}
      {showAutoApplyModal && (
        <AutoApplyModal
          onConfirm={() => { setAutoApply(true); setShowAutoApplyModal(false); }}
          onCancel={() => setShowAutoApplyModal(false)}
        />
      )}

      {/* ── Header ──────────────────────────────────────── */}
      <header className="border-b border-[var(--color-border)] glass sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          {/* Left: Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="h-8 w-8 text-[var(--color-emerald)]" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)] animate-ping" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)] shadow-[0_0_6px_var(--color-emerald)]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">Sentinel-G3</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-cyan)]/10 border border-[var(--color-cyan)]/20 text-[10px] font-bold uppercase tracking-wider text-[var(--color-cyan)]">
                  <Bot className="h-3 w-3" />
                  Agents Active: 2
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-[0.2em]">
                  Autonomous Security War Room
                </p>
                <StatusBadge status={scanning ? (activeFix ? "patching" : phase === "patching" ? "patching" : "scanning") : phase === "complete" ? "complete" : "idle"} />
              </div>
            </div>
          </div>

          {/* Right: Scan controls */}
          <div className="flex items-center gap-4">


            <div className="hidden sm:block">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 mb-1.5">
                <button
                  onClick={() => setScanMode("github")}
                  disabled={scanning}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold transition-all ${
                    scanMode === "github"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent"
                  }`}
                >
                  <Github className="h-3 w-3" />
                  GitHub
                </button>
                <button
                  onClick={() => setScanMode("local")}
                  disabled={scanning}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold transition-all ${
                    scanMode === "local"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent"
                  }`}
                >
                  <FolderOpen className="h-3 w-3" />
                  Local
                </button>
              </div>

              {/* Input fields */}
              {scanMode === "github" ? (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-md px-3 py-1.5 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)] w-96 focus:outline-none focus:border-[var(--color-emerald)] placeholder:text-[var(--color-text-muted)]/50"
                  />
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <KeyRound className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                      <input
                        type="password"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        placeholder="GitHub token (for PR)"
                        className="bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-md pl-7 pr-3 py-1 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)] w-full focus:outline-none focus:border-[var(--color-emerald)] placeholder:text-[var(--color-text-muted)]/50"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={createPr}
                        onChange={(e) => setCreatePr(e.target.checked)}
                        disabled={!githubToken || scanning}
                        className="accent-[var(--color-emerald)] h-3 w-3"
                      />
                      <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold whitespace-nowrap">
                        Create PR
                      </span>
                    </label>
                  </div>
                </div>
              ) : (
                <input
                  type="text"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  placeholder="C:\path\to\project"
                  className="bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-md px-3 py-1.5 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)] w-96 focus:outline-none focus:border-[var(--color-emerald)] placeholder:text-[var(--color-text-muted)]/50"
                />
              )}
            </div>
            <div className="flex items-center gap-4 border-l border-[var(--color-border)] pl-4 ml-2">
              <label
                className="hidden sm:flex items-center gap-1.5 cursor-pointer select-none print:hidden"
                title="Auto-Apply: when ON, patches are written to disk without review"
              >
                <input
                  type="checkbox"
                  checked={autoApply}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setShowAutoApplyModal(true); // Show scary confirmation
                    } else {
                      setAutoApply(false);
                    }
                  }}
                  disabled={scanning}
                  className="accent-[var(--color-red)] h-3.5 w-3.5"
                />
                <span className={`text-[11px] font-bold uppercase tracking-wider ${
                  autoApply ? "text-[var(--color-red)] shadow-[0_0_10px_rgba(255,50,50,0.5)]" : "text-[var(--color-text-muted)]"
                }`}>
                  {autoApply ? "⚠️ Auto-Apply ON" : "Auto-Apply Fixes"}
                </span>
              </label>
              <ScanButton scanning={scanning} complete={phase === "complete"} onClick={handleScan} />
            </div>
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <StatsBar scannedFiles={stats.scannedFiles} found={stats.found} healed={stats.healed} scanning={scanning} />

        {/* PR Result Banner */}
        {prResult && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/5 px-5 py-3 glass print:hidden">
            <GitPullRequest className="h-5 w-5 text-[var(--color-emerald)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Pull Request #{prResult.number} created</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Branch: <code className="font-[var(--font-mono)]">{prResult.branch}</code>
              </p>
            </div>
            <a
              href={prResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-emerald)]/40 bg-[var(--color-emerald)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-emerald)] hover:bg-[var(--color-emerald)]/20 transition-colors"
            >
              View PR <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Export Report button */}
        {phase === "complete" && entries.length > 0 && (
          <div className="flex items-center justify-between py-1 print:hidden">
            <p className="text-[11px] text-[var(--color-text-muted)]">
              {stats.found} vulnerabilities found · {stats.healed} healed · {Math.max(0, stats.found - stats.healed)} need review
            </p>
            <button
              onClick={handleExportReport}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-cyan)] bg-[var(--color-cyan)]/10 hover:bg-[var(--color-cyan)] px-6 py-3 text-[14px] font-bold text-[var(--color-cyan)] hover:text-[#050b14] shadow-[0_0_15px_rgba(0,184,217,0.3)] hover:shadow-[0_0_25px_rgba(0,184,217,0.6)] active:scale-95 transition-all"
            >
              <FileDown className="h-5 w-5" />
              Export Security Report
            </button>
          </div>
        )}

        {/* Live Feed */}
        <LiveFeed logs={logs} scanning={scanning} />

        {/* Active Fix Thinking Indicator */}
        {activeFix && (
          <ThinkingIndicator
            label={`Generating fix for ${activeFix}`}
            thinkingText={liveThinking}
            vulnerableCode={activeVulnCode || undefined}
            filePath={activeFilePath || undefined}
          />
        )}

        {/* Healing History */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Healing History
            </h2>
            
            {/* Bulk Apply Button */}
            {entries.some((e) => e.patch.success && e.patch.fixed_code && !e.healed) && (
              <button
                onClick={handleApplyAllUnfixed}
                disabled={isApplyingAll || scanning}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isApplyingAll ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Batch Applying…</>
                ) : (
                  <><Shield className="h-3.5 w-3.5" /> Apply All Pending Fixes</>
                )}
              </button>
            )}
          </div>
          <HealingHistory entries={entries} onLog={pushLog} onApplyPatches={handleApplyPatches} />
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-[var(--color-text-muted)] pt-8 pb-4">
          Sentinel-G3 — Powered by Google Gemini 3 · Built for the{" "}
          <a href="https://gemini3.devpost.com/" className="text-[var(--color-emerald)] hover:underline" target="_blank" rel="noopener">
            Gemini 3 Hackathon
          </a>
        </footer>
      </main>
    </div>
  );
}
