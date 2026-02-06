"use client";

import { useCallback, useRef, useState } from "react";
import { Shield } from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { LiveFeed } from "@/components/live-feed";
import { HealingHistory } from "@/components/healing-history";
import { StatsBar } from "@/components/stats-bar";
import { startScan, type HealingEntry, type SSEEvent } from "@/lib/api";

const DEFAULT_TARGET = "E:\\Personal\\SentinelG3\\target_code";

export default function Dashboard() {
  const [scanning, setScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [entries, setEntries] = useState<HealingEntry[]>([]);
  const [stats, setStats] = useState({ scannedFiles: 0, found: 0, healed: 0 });
  const [targetDir, setTargetDir] = useState(DEFAULT_TARGET);
  const controllerRef = useRef<AbortController | null>(null);

  const handleScan = useCallback(() => {
    // Reset state
    setScanning(true);
    setLogs([]);
    setEntries([]);
    setStats({ scannedFiles: 0, found: 0, healed: 0 });

    controllerRef.current = startScan(
      targetDir,
      (event: SSEEvent) => {
        switch (event.type) {
          case "log":
            setLogs((prev) => [...prev, event.data.message]);
            break;
          case "vuln":
            setStats((prev) => ({ ...prev, found: prev.found + 1 }));
            break;
          case "patch":
            setEntries((prev) => [...prev, event.data as HealingEntry]);
            if ((event.data as HealingEntry).healed) {
              setStats((prev) => ({ ...prev, healed: prev.healed + 1 }));
            }
            break;
          case "summary":
            setStats({
              scannedFiles: event.data.scanned_files,
              found: event.data.vulnerabilities_found,
              healed: event.data.vulnerabilities_healed,
            });
            if (event.data.entries) {
              setEntries(event.data.entries);
            }
            break;
          case "error":
            setLogs((prev) => [...prev, `ERROR: ${event.data.message}`]);
            break;
        }
      },
      () => setScanning(false),
    );
  }, [targetDir]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="h-8 w-8 text-[var(--color-emerald)]" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)] animate-ping" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-emerald)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                Sentinel-G3
              </h1>
              <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-[0.2em]">
                Autonomous Security War Room
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block">
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">
                Target Directory
              </label>
              <input
                type="text"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                className="bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-md px-3 py-1.5 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)] w-80 focus:outline-none focus:border-[var(--color-emerald)]"
              />
            </div>
            <ScanButton scanning={scanning} onClick={handleScan} />
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <StatsBar
          scannedFiles={stats.scannedFiles}
          found={stats.found}
          healed={stats.healed}
          scanning={scanning}
        />

        {/* Live Feed */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Live Feed
          </h2>
          <LiveFeed logs={logs} />
        </section>

        {/* Healing History */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Healing History
          </h2>
          <HealingHistory entries={entries} scanning={scanning} />
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-[var(--color-text-muted)] pt-8 pb-4">
          Sentinel-G3 — Powered by Google Gemini 3 Pro &middot; Built for the{" "}
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
