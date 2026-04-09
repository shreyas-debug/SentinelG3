"use client";

import { useCallback, useRef, useState, useMemo } from "react";
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
  Settings,
} from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { LiveFeed } from "@/components/live-feed";
import { HealingHistory } from "@/components/healing-history";
import { StatsBar } from "@/components/stats-bar";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { StatusBadge } from "@/components/status-badge";
import { VulnerabilityFilters, type SeverityFilter } from "@/components/vulnerability-filters";
import { startScan, generateReport, applyBatchPatches, type HealingEntry, type HealingSummary, type PRResult, type SSEEvent, type PatchResult } from "@/lib/api";

const DEFAULT_LOCAL = "E:\\Personal\\SentinelG3\\target_code";
type ScanMode = "local" | "github";
const FIXING_RE = /\[(\d+)\/(\d+)\]\s+Fixing\s+(.+?):(\d+)\s+\((\w+)\)/;

/* ── Settings Panel (Slide-out) ──────────────────────── */
function SettingsPanel({
  open,
  onClose,
  scanMode,
  setScanMode,
  repoUrl,
  setRepoUrl,
  targetDir,
  setTargetDir,
  githubToken,
  setGithubToken,
  createPr,
  setCreatePr,
  autoApply,
  setAutoApply,
  scanning,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  scanMode: ScanMode;
  setScanMode: (mode: ScanMode) => void;
  repoUrl: string;
  setRepoUrl: (url: string) => void;
  targetDir: string;
  setTargetDir: (dir: string) => void;
  githubToken: string;
  setGithubToken: (token: string) => void;
  createPr: boolean;
  setCreatePr: (create: boolean) => void;
  autoApply: boolean;
  setAutoApply: (apply: boolean) => void;
  scanning: boolean;
  onScan: () => void;
}) {
  const [showAutoApplyModal, setShowAutoApplyModal] = useState(false);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-md bg-[var(--color-bg-card)] border-l border-[var(--color-border)] shadow-2xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[var(--color-cyan)]" aria-hidden="true" />
              <h2 id="settings-title" className="text-lg font-bold text-[var(--color-text-primary)]">
                Scan Settings
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Close settings panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Mode Toggle - Only show Local mode in development */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 block">
              Scan Target
            </label>
            {process.env.NODE_ENV === 'development' || typeof window !== 'undefined' && window.location.hostname === 'localhost' ? (
              <div className="flex gap-2" role="radiogroup" aria-label="Scan target type">
                <button
                  onClick={() => setScanMode("github")}
                  disabled={scanning}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold transition-all ${
                    scanMode === "github"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border-2 border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-2 border-[var(--color-border)]"
                  }`}
                  role="radio"
                  aria-checked={scanMode === "github"}
                  aria-label="Scan GitHub repository"
                >
                  <Github className="h-4 w-4" aria-hidden="true" />
                  GitHub Repo
                </button>
                <button
                  onClick={() => setScanMode("local")}
                  disabled={scanning}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold transition-all ${
                    scanMode === "local"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border-2 border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-2 border-[var(--color-border)]"
                  }`}
                  role="radio"
                  aria-checked={scanMode === "local"}
                  aria-label="Scan local directory"
                >
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  Local Directory
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border-2 border-[var(--color-emerald)]/40">
                  <Github className="h-4 w-4" aria-hidden="true" />
                  GitHub Repository Scanning
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)] text-center">
                  Local directory scanning is only available in development mode
                </p>
              </div>
            )}
          </div>

          {/* Input Fields */}
          {scanMode === "github" ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="repo-url" className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 block">
                  Repository URL
                </label>
                <input
                  id="repo-url"
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-[13px] font-[var(--font-mono)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-emerald)] focus:ring-2 focus:ring-[var(--color-emerald)]/20 placeholder:text-[var(--color-text-muted)]/50"
                  aria-required="true"
                />
              </div>

              <div>
                <label htmlFor="github-token" className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 block">
                  GitHub Token (for PR)
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
                  <input
                    id="github-token"
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg pl-10 pr-4 py-3 text-[13px] font-[var(--font-mono)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-emerald)] focus:ring-2 focus:ring-[var(--color-emerald)]/20 placeholder:text-[var(--color-text-muted)]/50"
                    aria-describedby="token-help"
                  />
                </div>
                <p id="token-help" className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  Token is only used for this session and never stored
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createPr}
                  onChange={(e) => setCreatePr(e.target.checked)}
                  disabled={!githubToken || scanning}
                  className="accent-[var(--color-emerald)] h-4 w-4"
                  aria-label="Create pull request after scan"
                />
                <span className="text-[13px] text-[var(--color-text-secondary)] font-medium">
                  Create Pull Request after scan
                </span>
              </label>
            </div>
          ) : (
            <div>
              <label htmlFor="directory-path" className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 block">
                Directory Path
              </label>
              <input
                id="directory-path"
                type="text"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="C:\path\to\project"
                className="w-full bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-[13px] font-[var(--font-mono)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-emerald)] focus:ring-2 focus:ring-[var(--color-emerald)]/20 placeholder:text-[var(--color-text-muted)]/50"
                aria-required="true"
              />
            </div>
          )}

          {/* Auto-Apply Toggle */}
          <div className="border-t border-[var(--color-border)] pt-4">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => {
                  if (e.target.checked) {
                    setShowAutoApplyModal(true);
                  } else {
                    setAutoApply(false);
                  }
                }}
                disabled={scanning}
                className="accent-[var(--color-red)] h-4 w-4 mt-0.5"
                aria-describedby="auto-apply-desc"
              />
              <div className="flex-1">
                <span className={`text-[13px] font-bold ${
                  autoApply ? "text-[var(--color-red)]" : "text-[var(--color-text-secondary)]"
                }`}>
                  {autoApply ? "⚠️ Auto-Apply Fixes (ON)" : "Auto-Apply Fixes"}
                </span>
                <p id="auto-apply-desc" className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  {autoApply
                    ? "Patches will be written to disk automatically during scan."
                    : "Review and approve each fix manually (recommended)."}
                </p>
              </div>
            </label>
          </div>

          {/* Scan Button */}
          <div className="border-t border-[var(--color-border)] pt-4">
            <ScanButton
              scanning={scanning}
              complete={false}
              onClick={() => {
                onScan();
                onClose();
              }}
            />
          </div>
        </div>
      </div>

      {/* Auto-Apply confirmation modal */}
      {showAutoApplyModal && (
        <AutoApplyModal
          onConfirm={() => { setAutoApply(true); setShowAutoApplyModal(false); }}
          onCancel={() => setShowAutoApplyModal(false)}
        />
      )}
    </>
  );
}

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
  const [autoApply, setAutoApply]   = useState(false);
  const [activeFix, setActiveFix]       = useState<string | null>(null);
  const [liveThinking, setLiveThinking] = useState("");
  const [activeVulnCode, setActiveVulnCode] = useState("");
  const [activeFilePath, setActiveFilePath] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "patching" | "complete">("idle");
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [noTokenWarning, setNoTokenWarning] = useState<{message: string; instructions: string[]} | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Filtering state
  const [activeSeverity, setActiveSeverity] = useState<SeverityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [errorBanner, setErrorBanner] = useState<{message: string; detail: string; retryable: boolean} | null>(null);

  const activeTarget = scanMode === "github" ? repoUrl : targetDir;

  // Compute severity counts
  const severityCounts = useMemo(() => {
    const counts = { all: entries.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    entries.forEach((e) => {
      const sev = e.vulnerability.severity.toLowerCase();
      if (sev === "critical") counts.critical++;
      else if (sev === "high") counts.high++;
      else if (sev === "medium") counts.medium++;
      else if (sev === "low") counts.low++;
      else if (sev === "info") counts.info++;
    });
    return counts;
  }, [entries]);

  // Filter entries based on severity and search query
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const severityMatch =
        activeSeverity === "all" || e.vulnerability.severity.toLowerCase() === activeSeverity;

      const query = searchQuery.toLowerCase();
      const searchMatch =
        !query ||
        e.vulnerability.file_path.toLowerCase().includes(query) ||
        e.vulnerability.issue.toLowerCase().includes(query) ||
        (e.patch?.original_code || "").toLowerCase().includes(query);

      return severityMatch && searchMatch;
    });
  }, [entries, activeSeverity, searchQuery]);

  const handleApplyPatches = async (patches: { file_path: string; new_content: string }[]) => {
    return await applyBatchPatches(activeTarget, patches, {
      createPr,
      githubToken: githubToken || undefined,
    });
  };

  const handleApplyAllUnfixed = async () => {
    const unfixed = filteredEntries
      .filter((e) => e.patch?.success && e.patch?.fixed_code && !e.healed)
      .map((e) => ({ file_path: e.patch!.file_path, new_content: e.patch!.fixed_code }));

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
          if (entry.patch?.success && entry.patch?.fixed_code && !entry.healed) {
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
    setErrorBanner(null);
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
          case "no_pr_info":
            setNoTokenWarning({
              message: event.data.message,
              instructions: event.data.instructions
            });
            break;
          case "error": {
            const { message, detail, retryable } = event.data as {
              message: string;
              detail?: string;
              retryable?: boolean;
            };
            // Push a concise line to the terminal log
            setLogs((prev) => [
              ...prev,
              `✗ ERROR: ${message}${detail ? ` — ${detail}` : ""}`,
            ]);
            // Also surface as a dismissible banner with full detail
            setErrorBanner({ message, detail: detail ?? "", retryable: retryable ?? false });
            break;
          }
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
      {/* Settings Panel */}
      <SettingsPanel
        open={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        scanMode={scanMode}
        setScanMode={setScanMode}
        repoUrl={repoUrl}
        setRepoUrl={setRepoUrl}
        targetDir={targetDir}
        setTargetDir={setTargetDir}
        githubToken={githubToken}
        setGithubToken={setGithubToken}
        createPr={createPr}
        setCreatePr={setCreatePr}
        autoApply={autoApply}
        setAutoApply={setAutoApply}
        scanning={scanning}
        onScan={handleScan}
      />

      {/* ── Header (Clean & Minimal) ──────────────────────── */}
      <header className="border-b border-[var(--color-border)] glass sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          {/* Left: Logo & Status */}
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

          {/* Right: Action buttons */}
          <div className="flex items-center gap-3">
            {phase === "complete" && entries.length > 0 && (
              <button
                onClick={handleExportReport}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-cyan)] bg-[var(--color-cyan)]/10 hover:bg-[var(--color-cyan)]/20 px-4 py-2 text-[12px] font-bold text-[var(--color-cyan)] transition-all active:scale-95"
              >
                <FileDown className="h-4 w-4" />
                Export Report
              </button>
            )}
            <button
              onClick={() => setSettingsPanelOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-emerald)] bg-[var(--color-emerald)]/10 hover:bg-[var(--color-emerald)]/20 px-4 py-2 text-[12px] font-bold text-[var(--color-emerald)] transition-all active:scale-95"
            >
              <Settings className="h-4 w-4" />
              New Scan
            </button>
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

        {/* No Token Warning Banner */}
        {noTokenWarning && !prResult && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 px-5 py-4 glass print:hidden">
            <AlertTriangle className="h-5 w-5 text-[var(--color-amber)] shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{noTokenWarning.message}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">How to Apply Fixes:</p>
                <ul className="text-xs text-[var(--color-text-muted)] space-y-1">
                  {noTokenWarning.instructions.map((instruction, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[var(--color-amber)] shrink-0 mt-0.5">•</span>
                      <span>{instruction}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              onClick={() => setNoTokenWarning(null)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Global Error Banner */}
        {errorBanner && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--color-red)]/40 bg-[var(--color-red)]/5 px-5 py-4 glass print:hidden">
            <AlertTriangle className="h-5 w-5 text-[var(--color-red)] shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-[var(--color-red)]">{errorBanner.message}</p>
              {errorBanner.detail && (
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {errorBanner.detail}
                </p>
              )}
              {errorBanner.retryable && (
                <button
                  onClick={handleScan}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-red)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-red)] hover:bg-[var(--color-red)]/20 transition-colors"
                >
                  <Shield className="h-3.5 w-3.5" /> Retry Scan
                </button>
              )}
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] shrink-0"
              aria-label="Dismiss Error"
            >
              <X className="h-4 w-4" />
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

        {/* Vulnerability Filters */}
        {entries.length > 0 && (
          <VulnerabilityFilters
            activeSeverity={activeSeverity}
            onSeverityChange={setActiveSeverity}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            counts={severityCounts}
          />
        )}

        {/* Healing History */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Healing History
              {filteredEntries.length !== entries.length && (
                <span className="ml-2 text-[var(--color-cyan)]">
                  ({filteredEntries.length} of {entries.length} shown)
                </span>
              )}
            </h2>
            
            {/* Bulk Apply Button */}
            {filteredEntries.some((e) => e.patch?.success && e.patch?.fixed_code && !e.healed) && (
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
          <HealingHistory
            entries={filteredEntries}
            onLog={pushLog}
            onApplyPatches={handleApplyPatches}
            repoRoot={activeTarget}
            onPatchGenerated={(index, patch, fixerThought, modelUsed) => {
              setEntries((prev) => {
                const updated = [...prev];
                const actualIndex = entries.findIndex((e) => e === filteredEntries[index]);
                if (actualIndex !== -1) {
                  updated[actualIndex] = {
                    ...updated[actualIndex],
                    patch,
                    fixer_thought: fixerThought,
                    model_used: modelUsed,
                  };
                }
                return updated;
              });
            }}
            onRollback={(index) => {
              setEntries((prev) => {
                const updated = [...prev];
                const actualIndex = entries.findIndex((e) => e === filteredEntries[index]);
                if (actualIndex !== -1) {
                  updated[actualIndex] = { ...updated[actualIndex], healed: false };
                }
                return updated;
              });
              setStats((s) => ({ ...s, healed: Math.max(0, s.healed - 1) }));
            }}
          />
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
