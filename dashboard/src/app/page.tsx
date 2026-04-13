"use client";

import { useCallback, useRef, useState, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
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
  LogOut,
  User,
  ChevronDown,
  Download,
  Info,
} from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { LiveFeed } from "@/components/live-feed";
import { HealingHistory } from "@/components/healing-history";
import { StatsBar } from "@/components/stats-bar";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { StatusBadge } from "@/components/status-badge";
import { VulnerabilityFilters, type SeverityFilter } from "@/components/vulnerability-filters";
import { startScan, startZipScan, generateReport, downloadSarifReport, downloadJsonReport, downloadCsvReport, applyBatchPatches, type HealingEntry, type HealingSummary, type PRResult, type SSEEvent, type PatchResult } from "@/lib/api";
import JSZip from "jszip";

const DEFAULT_LOCAL = "E:\\Personal\\SentinelG3\\target_code";
type ScanMode = "local" | "github" | "upload";
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
  uploadedFile,
  setUploadedFile,
  scanning,
  onScan,
  onShowTokenInfo,
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
  uploadedFile: File | null;
  setUploadedFile: (file: File | null) => void;
  scanning: boolean;
  onScan: () => void;
  onShowTokenInfo: () => void;
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
                  GitHub
                </button>
                <button
                  onClick={() => setScanMode("upload")}
                  disabled={scanning}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold transition-all ${
                    scanMode === "upload"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border-2 border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-2 border-[var(--color-border)]"
                  }`}
                  role="radio"
                  aria-checked={scanMode === "upload"}
                  aria-label="Upload ZIP file"
                >
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                  Upload ZIP
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
                  Local
                </button>
              </div>
            ) : (
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
                  onClick={() => setScanMode("upload")}
                  disabled={scanning}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold transition-all ${
                    scanMode === "upload"
                      ? "bg-[var(--color-emerald)]/20 text-[var(--color-emerald)] border-2 border-[var(--color-emerald)]/40"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-2 border-[var(--color-border)]"
                  }`}
                  role="radio"
                  aria-checked={scanMode === "upload"}
                  aria-label="Upload ZIP file"
                >
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                  Upload ZIP
                </button>
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
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="github-token" className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    GitHub Token (for PR)
                  </label>
                  <button
                    onClick={onShowTokenInfo}
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--color-cyan)] hover:text-[var(--color-cyan)]/80 transition-colors"
                    type="button"
                  >
                    <Info className="h-3 w-3" />
                    How to get token?
                  </button>
                </div>
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
          ) : scanMode === "upload" ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="zip-file" className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 block">
                  Upload Repository ZIP
                </label>
                <div className="relative">
                  <input
                    id="zip-file"
                    type="file"
                    accept=".zip"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setUploadedFile(file);
                      }
                    }}
                    disabled={scanning}
                    className="w-full bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-[13px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-emerald)] focus:ring-2 focus:ring-[var(--color-emerald)]/20 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[var(--color-emerald)]/10 file:text-[var(--color-emerald)] hover:file:bg-[var(--color-emerald)]/20"
                    aria-required="true"
                  />
                </div>
                {uploadedFile && (
                  <p className="text-[10px] text-[var(--color-emerald)] mt-1 flex items-center gap-1">
                    ✓ {uploadedFile.name} ({(uploadedFile.size / 1024 / 1024).toFixed(2)}MB)
                  </p>
                )}
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  Max size: 50MB. Fixes are generated for review only (not applied to uploaded files)
                </p>
              </div>
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
                placeholder="/absolute/path/to/your/project"
                className="w-full bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-[13px] font-[var(--font-mono)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-emerald)] focus:ring-2 focus:ring-[var(--color-emerald)]/20 placeholder:text-[var(--color-text-muted)]/50"
                aria-required="true"
                aria-describedby="directory-help"
              />
              <p id="directory-help" className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Must be an absolute path (e.g., Windows: <code>C:\Users\YourName\project</code>, Unix: <code>/home/user/project</code>)
              </p>
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
  const { data: session, status } = useSession();
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
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [noTokenWarning, setNoTokenWarning] = useState<{message: string; instructions: string[]} | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Filtering state
  const [activeSeverity, setActiveSeverity] = useState<SeverityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [errorBanner, setErrorBanner] = useState<{message: string; detail: string; retryable: boolean} | null>(null);

  const activeTarget = scanMode === "github" ? repoUrl : scanMode === "upload" ? (uploadedFile?.name || "") : targetDir;

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

  const handleDownloadPatchedFiles = async () => {
    const readyEntries = filteredEntries.filter(
      (e) => e.patch?.success && e.patch?.fixed_code && !e.healed
    );

    if (readyEntries.length === 0) {
      setLogs((prev) => [...prev, "⚠️ No patched files available to download"]);
      return;
    }

    try {
      const zip = new JSZip();
      const patchedFolder = zip.folder("patched_files");

      readyEntries.forEach((entry) => {
        if (entry.patch?.fixed_code) {
          // Sanitize file path for ZIP
          const fileName = entry.vulnerability.file_path.replace(/^\//, "");
          patchedFolder?.file(fileName, entry.patch.fixed_code);
        }
      });

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sentinel-g3-patched-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLogs((prev) => [
        ...prev,
        `📦 Downloaded ${readyEntries.length} patched file(s) as ZIP`,
      ]);
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `❌ Failed to create ZIP: ${error instanceof Error ? error.message : "Unknown error"}`,
      ]);
    }
  };

  const handleApplyAllUnfixed = async () => {
    const unfixed = filteredEntries
      .filter((e) => e.patch?.success && e.patch?.fixed_code && !e.healed)
      .map((e) => ({ file_path: e.patch!.file_path, new_content: e.patch!.fixed_code }));

    if (unfixed.length === 0) return;
    
    setIsApplyingAll(true);
    pushLog(`▶ Applying ${unfixed.length} patch(es) to ${activeTarget}...`);
    
    const result = await handleApplyPatches(unfixed);
    
    if (result.success) {
      pushLog(`✅ Successfully applied ${unfixed.length} patch(es)`);
      if (result.pr_url) {
        setPrResult({ url: result.pr_url, number: parseInt(result.pr_url.split("/").pop() || "0", 10), branch: result.pr_url });
        pushLog(`🔗 Pull Request created: ${result.pr_url}`);
        pushLog(`✨ Review and merge the PR to apply fixes to your repository`);
      } else if (result.applied_files && Array.isArray(result.applied_files)) {
        pushLog(`📁 Modified files in: ${activeTarget}`);
        result.applied_files.forEach((file: string) => {
          pushLog(`   ✓ ${file}`);
        });
        pushLog(`💾 Backups saved to: ${activeTarget}\\.sentinel-g3\\backups\\`);
        pushLog(`📥 Tip: Use "Download as ZIP" to save a copy of all fixed files`);
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
      pushLog(`❌ Failed to apply patches: ${result.message}`);
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
    setNoTokenWarning(null);
    setActiveFix(null);
    setLiveThinking("");
    setActiveVulnCode("");
    setActiveFilePath("");
    setPhase("scanning");

    // Handle ZIP upload mode
    if (scanMode === "upload" && uploadedFile) {
      controllerRef.current = startZipScan(
        uploadedFile,
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
              setLogs((prev) => [
                ...prev,
                `❌ ERROR: ${message}${detail ? ` — ${detail}` : ""}`,
              ]);
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
      );
      return;
    }

    // Regular scan (GitHub or local directory)
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
            setLogs((prev) => [
              ...prev,
              `❌ ERROR: ${message}${detail ? ` — ${detail}` : ""}`,
            ]);
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
  }, [activeTarget, uploadedFile, githubToken, createPr, autoApply, scanMode, phase]);

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
        uploadedFile={uploadedFile}
        setUploadedFile={setUploadedFile}
        scanning={scanning}
        onScan={handleScan}
        onShowTokenInfo={() => setShowTokenInfo(true)}
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
            {phase === "complete" && entries.length > 0 && summary && (
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-cyan)] bg-[var(--color-cyan)]/10 hover:bg-[var(--color-cyan)]/20 px-4 py-2 text-[12px] font-bold text-[var(--color-cyan)] transition-all active:scale-95"
                >
                  <FileDown className="h-4 w-4" />
                  Export
                  <ChevronDown className="h-3 w-3" />
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl z-20 overflow-hidden">
                    {[
                      { label: "HTML Report",   action: () => { handleExportReport(); setExportMenuOpen(false); } },
                      { label: "SARIF (.sarif)", action: async () => { setExportMenuOpen(false); try { await downloadSarifReport(summary); } catch { setLogs((p) => [...p, "❌ SARIF export failed"]); } } },
                      { label: "JSON Report",   action: async () => { setExportMenuOpen(false); try { await downloadJsonReport(summary); } catch { setLogs((p) => [...p, "❌ JSON export failed"]); } } },
                      { label: "CSV Report",    action: async () => { setExportMenuOpen(false); try { await downloadCsvReport(summary); } catch { setLogs((p) => [...p, "❌ CSV export failed"]); } } },
                    ].map(({ label, action }) => (
                      <button
                        key={label}
                        onClick={action}
                        className="w-full text-left px-4 py-2.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (scanning) {
                  // Stop the current scan
                  if (controllerRef.current) {
                    controllerRef.current.abort();
                    controllerRef.current = null;
                  }
              setScanning(false);
              setActiveFix(null);
              setLiveThinking("");
              setPhase("idle");
              setLogs((prev) => [...prev, "⚠️ Scan cancelled by user"]);
                } else {
                  setSettingsPanelOpen(true);
                }
              }}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[12px] font-bold transition-all active:scale-95 ${
                scanning
                  ? "border-[var(--color-red)] bg-[var(--color-red)]/10 hover:bg-[var(--color-red)]/20 text-[var(--color-red)]"
                  : "border-[var(--color-emerald)] bg-[var(--color-emerald)]/10 hover:bg-[var(--color-emerald)]/20 text-[var(--color-emerald)]"
              }`}
            >
              {scanning ? (
                <>
                  <X className="h-4 w-4" />
                  Stop Scan
                </>
              ) : (
                <>
                  <Settings className="h-4 w-4" />
                  New Scan
                </>
              )}
            </button>
            
            {/* User Menu */}
            {session?.user && (
              <div className="relative group">
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">
                  {session.user.image ? (
                    <img src={session.user.image} alt={session.user.name || ''} className="h-6 w-6 rounded-full" />
                  ) : (
                    <User className="h-4 w-4 text-[var(--color-text-muted)]" />
                  )}
                  <span className="text-xs text-[var(--color-text-secondary)] hidden sm:inline">
                    {session.user.name || session.user.email}
                  </span>
                </button>
                
                {/* Dropdown */}
                <div className="absolute right-0 mt-2 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                  <div className="p-3 border-b border-[var(--color-border)]">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)]">{session.user.name}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{session.user.email}</p>
                  </div>
                  <button
                    onClick={() => signOut()}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-red)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <LogOut className="h-3 w-3" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
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

        {/* GitHub Token Info Modal */}
        {showTokenInfo && (
          <div 
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowTokenInfo(false)}
          >
            <div 
              className="relative max-w-2xl w-full mx-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-[var(--color-cyan)]" />
                  <h3 className="text-lg font-bold text-[var(--color-text-primary)]">How to Get a GitHub Token</h3>
                </div>
                <button
                  onClick={() => setShowTokenInfo(false)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  A Personal Access Token allows Sentinel-G3 to create Pull Requests on your behalf. Follow these steps to generate one:
                </p>

                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">1</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Go to GitHub Settings</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Visit{" "}
                        <a 
                          href="https://github.com/settings/tokens/new" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[var(--color-cyan)] hover:underline inline-flex items-center gap-1"
                        >
                          github.com/settings/tokens/new
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">2</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Set Token Name</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Give it a descriptive name like "Sentinel-G3"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">3</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Select Expiration</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Choose an expiration (recommended: 30 days)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">4</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Select Scopes</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-2">
                        Check these permissions:
                      </p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <code className="px-2 py-1 rounded bg-[var(--color-bg-terminal)] text-[var(--color-emerald)] font-[var(--font-mono)]">repo</code>
                          <span className="text-[var(--color-text-muted)]">Full control of private repositories</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <code className="px-2 py-1 rounded bg-[var(--color-bg-terminal)] text-[var(--color-emerald)] font-[var(--font-mono)]">workflow</code>
                          <span className="text-[var(--color-text-muted)]">Update GitHub Action workflows</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">5</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Generate Token</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Click "Generate token" at the bottom
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] text-xs font-bold">6</span>
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-semibold">Copy & Paste</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Copy the token (starts with <code className="text-[var(--color-amber)]">ghp_</code>) and paste it above
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-[var(--color-amber)] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-amber)]">Security Note</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Your token is only used for this browser session and is never stored on our servers. Keep it secret and don't share it publicly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <button
                  onClick={() => setShowTokenInfo(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] transition-colors"
                >
                  Close
                </button>
                <a
                  href="https://github.com/settings/tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-emerald)]/20 border border-[var(--color-emerald)] text-[var(--color-emerald)] text-sm font-semibold hover:bg-[var(--color-emerald)]/30 transition-colors"
                >
                  <Github className="h-4 w-4" />
                  Create Token
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
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
            
            {/* Bulk Action Buttons - Conditional based on scan mode */}
            {filteredEntries.some((e) => e.patch?.success && e.patch?.fixed_code && !e.healed) && (
              <div className="flex items-center gap-2">
                {/* Show Download button for: GitHub without token OR Upload mode */}
                {((scanMode === "github" && (!githubToken || !createPr)) || scanMode === "upload") && (
                  <button
                    onClick={handleDownloadPatchedFiles}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold bg-cyan-600/20 border border-cyan-500 text-cyan-400 hover:bg-cyan-600/30 transition-all active:scale-95 shadow-sm"
                    title="Download patched files as a ZIP archive"
                  >
                    <Download className="h-3.5 w-3.5" /> Download as ZIP
                  </button>
                )}
                
                {/* Show Apply to Local Files for local mode */}
                {scanMode === "local" && (
                  <button
                    onClick={handleApplyAllUnfixed}
                    disabled={isApplyingAll || scanning}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Apply patches directly to your local files (creates backups)"
                  >
                    {isApplyingAll ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying to Files…</>
                    ) : (
                      <><Shield className="h-3.5 w-3.5" /> Apply to Local Files</>
                    )}
                  </button>
                )}
                
                {/* Show Create PR button for GitHub with token */}
                {scanMode === "github" && githubToken && createPr && (
                  <button
                    onClick={handleApplyAllUnfixed}
                    disabled={isApplyingAll || scanning}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold bg-emerald-600/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-600/30 transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Create a Pull Request on GitHub with the fixes"
                  >
                    {isApplyingAll ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating PR…</>
                    ) : (
                      <><GitPullRequest className="h-3.5 w-3.5" /> Create Pull Request</>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
          <HealingHistory
            entries={filteredEntries}
            scanning={scanning}
            phase={phase}
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
