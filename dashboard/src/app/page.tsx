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
} from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { LiveFeed } from "@/components/live-feed";
import { HealingHistory } from "@/components/healing-history";
import { StatsBar } from "@/components/stats-bar";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { StatusBadge } from "@/components/status-badge";
import { startScan, type HealingEntry, type PRResult, type SSEEvent } from "@/lib/api";

const DEFAULT_LOCAL = "E:\\Personal\\SentinelG3\\target_code";

type ScanMode = "local" | "github";

// Regex to detect "[N/M] Fixing file:line (severity)" log lines
const FIXING_RE = /\[(\d+)\/(\d+)\]\s+Fixing\s+(.+?):(\d+)\s+\((\w+)\)/;

export default function Dashboard() {
  const [scanning, setScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [entries, setEntries] = useState<HealingEntry[]>([]);
  const [stats, setStats] = useState({ scannedFiles: 0, found: 0, healed: 0 });
  const [scanMode, setScanMode] = useState<ScanMode>("github");
  const [targetDir, setTargetDir] = useState(DEFAULT_LOCAL);
  const [repoUrl, setRepoUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [createPr, setCreatePr] = useState(true);
  const [prResult, setPrResult] = useState<PRResult | null>(null);
  // Track which fix is currently in progress + live thinking text
  const [activeFix, setActiveFix] = useState<string | null>(null);
  const [liveThinking, setLiveThinking] = useState("");
  const [activeVulnCode, setActiveVulnCode] = useState<string>("");
  const [activeFilePath, setActiveFilePath] = useState<string>("");
  // Phase tracking for status badge
  const [phase, setPhase] = useState<"idle" | "scanning" | "patching" | "complete">("idle");
  const controllerRef = useRef<AbortController | null>(null);

  const activeTarget = scanMode === "github" ? repoUrl : targetDir;

  const handleScan = useCallback(() => {
    if (!activeTarget.trim()) return;

    // Reset state
    setScanning(true);
    setLogs([]);
    setEntries([]);
    setStats({ scannedFiles: 0, found: 0, healed: 0 });
    setPrResult(null);
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

            // Detect patching phase
            if (msg.includes("Stage 2") || msg.includes("Generating patches")) {
              setPhase("patching");
            }

            // Detect when a fix is starting
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
            // Live chain-of-thought chunk from Gemini streaming
            setLiveThinking((prev) => prev + event.data.text);
            break;
          case "vuln":
            setStats((prev) => ({ ...prev, found: prev.found + 1 }));
            break;
          case "patch":
            // Fix complete — clear thinking indicator, add entry
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
            setStats({
              scannedFiles: event.data.scanned_files,
              found: event.data.vulnerabilities_found,
              healed: event.data.vulnerabilities_healed,
            });
            if (event.data.entries) {
              setEntries(event.data.entries);
            }
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
        ? { githubToken, createPr }
        : undefined,
    );
  }, [activeTarget, githubToken, createPr, scanMode, phase]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] bg-grid-pattern">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="border-b border-[var(--color-border)] glass sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          {/* Left: Logo + Title + Badges */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="h-8 w-8 text-[var(--color-emerald)]" />
              {/* Pulsing green status dot */}
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)] animate-ping" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)] shadow-[0_0_6px_var(--color-emerald)]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  Sentinel-G3
                </h1>
                {/* Agents Active badge */}
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

          {/* Right: Inputs + Scan button */}
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
            <ScanButton scanning={scanning} complete={phase === "complete"} onClick={handleScan} />
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <StatsBar
          scannedFiles={stats.scannedFiles}
          found={stats.found}
          healed={stats.healed}
          scanning={scanning}
        />

        {/* PR Result Banner */}
        {prResult && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/5 px-5 py-3 glass">
            <GitPullRequest className="h-5 w-5 text-[var(--color-emerald)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                Pull Request #{prResult.number} created
              </p>
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
              View PR
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Live Feed */}
        <LiveFeed logs={logs} scanning={scanning} />

        {/* Active Fix Thinking Indicator — Split view above Healing History */}
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
          <h2 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Healing History
          </h2>
          <HealingHistory entries={entries} />
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-[var(--color-text-muted)] pt-8 pb-4">
          Sentinel-G3 — Powered by Google Gemini 3 &middot; Built for the{" "}
          <a
            href="https://gemini3.devpost.com/"
            className="text-[var(--color-emerald)] hover:underline"
            target="_blank"
            rel="noopener"
          >
            Gemini 3 Hackathon
          </a>
        </footer>
      </main>
    </div>
  );
}
