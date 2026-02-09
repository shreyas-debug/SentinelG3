"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// ── Semantic log parser ─────────────────────────────────

interface ParsedSegment {
  text: string;
  cls: string;
}

/**
 * Parse a raw log line into styled segments.
 *
 * - `▶` / `Stage` lines → bold cyan
 * - Words like CRITICAL, Threat → red + pulse
 * - Fixed / Healed / ✓ → neon green
 * - ERROR / ✗ → red
 * - ═══ summary lines → amber
 */
function parseLogLine(line: string): ParsedSegment[] {
  // Stage / ▶  headers → entire line bold cyan
  if (line.includes("▶") || /Stage\s+\d/i.test(line)) {
    return [{ text: line, cls: "text-[var(--color-cyan)] font-bold" }];
  }

  // Summary bars
  if (line.includes("═══")) {
    return [{ text: line, cls: "text-[var(--color-amber)] font-bold" }];
  }

  // Skip / idle lines
  if (line.includes("⏭") || line.includes("Skipping")) {
    return [{ text: line, cls: "text-[var(--color-text-muted)] italic" }];
  }

  // Inline keyword highlighting
  const segments: ParsedSegment[] = [];
  const keywords: [RegExp, string][] = [
    [/\b(CRITICAL|Threat)\b/gi, "text-[var(--color-red)] font-bold animate-pulse"],
    [/(Not patched)/gi, "text-[var(--color-red)] font-semibold"],
    [/\b(ERROR|✗|FAIL(?:ED)?)\b/gi, "text-[var(--color-red)] font-semibold"],
    [/\b(WARNING|WARN)\b/gi, "text-[var(--color-amber)]"],
    [/(Fixed|Healed|✓|Patched)/gi, "text-[var(--color-emerald)] font-semibold crt-glow-green"],
    [/\b(INFO)\b/gi, "text-[var(--color-text-muted)]"],
    [/(Cloning|Committed|Pushed|Pull Request created)/gi, "text-[var(--color-cyan)]"],
  ];

  // Build a combined regex
  const combined = new RegExp(
    keywords.map(([r]) => `(${r.source})`).join("|"),
    "gi",
  );

  let lastIndex = 0;
  const defaultCls = line.includes("✓")
    ? "text-[var(--color-emerald)]"
    : line.includes("ERROR") || line.includes("✗") || line.includes("Not patched")
      ? "text-[var(--color-red)]"
      : "text-[var(--color-text-secondary)]";

  let match: RegExpExecArray | null;
  while ((match = combined.exec(line)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), cls: defaultCls });
    }

    // Find which keyword group matched
    const matchedText = match[0];
    let matchCls = defaultCls;
    for (const [re, cls] of keywords) {
      if (re.test(matchedText)) {
        matchCls = cls;
        re.lastIndex = 0; // reset after test
        break;
      }
    }
    segments.push({ text: matchedText, cls: matchCls });
    lastIndex = combined.lastIndex;
  }

  // Remaining text
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), cls: defaultCls });
  }

  return segments.length > 0 ? segments : [{ text: line, cls: defaultCls }];
}

/** Format current time as HH:MM:SS */
function timestamp(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

// ── LogLine component ───────────────────────────────────

function LogLine({
  line,
  index,
  isNew,
  ts,
}: {
  line: string;
  index: number;
  isNew: boolean;
  ts: string;
}) {
  const [visible, setVisible] = useState(!isNew);
  const segments = useMemo(() => parseLogLine(line), [line]);

  useEffect(() => {
    if (isNew) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  return (
    <div
      className={`
        flex gap-0 hover:bg-white/[0.03] -mx-1 px-1 rounded
        transition-all duration-300 ease-out crt-text-glow
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}
      `}
    >
      {/* Dim timestamp */}
      <span className="text-[var(--color-text-muted)]/30 select-none shrink-0 w-[70px] text-[10px] leading-[1.9] tabular-nums">
        <span className="text-[var(--color-text-muted)]/20">[</span>
        {ts}
        <span className="text-[var(--color-text-muted)]/20">]</span>
      </span>

      {/* Shell prompt */}
      <span className="text-[var(--color-emerald)]/40 select-none shrink-0 w-4 text-[12px] leading-[1.9]">
        $
      </span>

      {/* Parsed line with semantic highlighting */}
      <span className="leading-[1.9] flex-1">
        {segments.map((seg, i) => (
          <span key={i} className={seg.cls}>{seg.text}</span>
        ))}
      </span>
    </div>
  );
}

// ── Main LiveFeed component ─────────────────────────────

export function LiveFeed({ logs, scanning }: { logs: string[]; scanning?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const prevCountRef = useRef(0);

  // Generate timestamps when logs arrive
  const timestampsRef = useRef<string[]>([]);
  if (logs.length > timestampsRef.current.length) {
    const now = timestamp();
    while (timestampsRef.current.length < logs.length) {
      timestampsRef.current.push(now);
    }
  }

  // Auto-scroll ONLY the terminal container, not the page
  useEffect(() => {
    const el = containerRef.current;
    if (!collapsed && el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    prevCountRef.current = logs.length;
  }, [logs, collapsed]);

  const prevCount = prevCountRef.current;

  return (
    <div className="rounded-xl border border-slate-800 bg-black overflow-hidden shadow-lg shadow-black/50">
      {/* ── Window chrome header ─────────────────── */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 hover:from-slate-800/80 transition-all"
      >
        {/* Traffic light dots */}
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e] border border-[#d4a528]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840] border border-[#1aab29]" />
        </div>

        {/* Center title */}
        <span className="flex-1 text-center text-[11px] font-[var(--font-mono)] text-slate-500 tracking-wide">
          root@sentinel-g3:~/active_session
        </span>

        {/* Right side: status + collapse */}
        <div className="flex items-center gap-2">
          {scanning && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-emerald)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-emerald)]" />
            </span>
          )}
          <span className="text-[10px] text-slate-600 font-[var(--font-mono)] tabular-nums">
            {logs.length} lines
          </span>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
          )}
        </div>
      </button>

      {/* ── Terminal body ────────────────────────── */}
      {!collapsed && (
        <div className="relative">
          {/* CRT Scanline overlay */}
          <div
            className="crt-scanlines pointer-events-none absolute inset-0 z-10"
          />

          {/* Log content */}
          <div
            ref={containerRef}
            className="h-64 overflow-y-auto px-4 py-3 bg-black terminal-scroll font-[var(--font-mono)] text-[12px]"
          >
            {logs.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-600 text-xs">
                <span className="text-[var(--color-emerald)]/50">$</span>
                <span className="cursor-blink inline-block w-2 h-3.5 bg-[var(--color-emerald)]/60" />
                <span className="italic">awaiting command…</span>
              </div>
            ) : (
              <>
                {logs.map((line, i) => (
                  <LogLine
                    key={i}
                    line={line}
                    index={i}
                    isNew={i >= prevCount}
                    ts={timestampsRef.current[i] || "00:00:00"}
                  />
                ))}
                {/* Terminal heartbeat — blinking block cursor after last line */}
                {scanning && (
                  <div className="flex items-center gap-0 pl-[86px] mt-0.5">
                    <span className="cursor-blink inline-block w-[7px] h-[14px] bg-[var(--color-emerald)]" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
