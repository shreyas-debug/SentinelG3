"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, ChevronDown, ChevronRight } from "lucide-react";
import { ReasoningFeed } from "@/components/reasoning-feed";

// ── Dynamic status cycler texts ─────────────────────────
const STATUS_TEXTS = [
  "Parsing Abstract Syntax Tree…",
  "Simulating Attack Vectors…",
  "Validating Security Context…",
  "Synthesizing Fix…",
  "Evaluating Exploit Surface…",
  "Finalizing Patch…",
];

/** Brainwave waveform — 6 animated bars */
function BrainwaveAnimation() {
  return (
    <div className="flex items-end gap-[3px] h-5">
      <div className="brainwave-bar" />
      <div className="brainwave-bar" />
      <div className="brainwave-bar" />
      <div className="brainwave-bar" />
      <div className="brainwave-bar" />
      <div className="brainwave-bar" />
    </div>
  );
}

/** Cycles through status texts every 2.5s */
function StatusCycler() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((prev) => (prev + 1) % STATUS_TEXTS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-[10px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
      {STATUS_TEXTS[idx]}
    </span>
  );
}

/**
 * Collapsible "AI is thinking" indicator with:
 * - Brainwave waveform animation in the header bar
 * - Dynamic status cycler
 * - Expandable split-view: Code + Reasoning feed
 */
export function ThinkingIndicator({
  label,
  thinkingText,
  vulnerableCode,
  filePath,
}: {
  label?: string;
  thinkingText?: string;
  vulnerableCode?: string;
  filePath?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingText]);

  const hasCode = Boolean(vulnerableCode);

  return (
    <div className="rounded-xl border border-[var(--color-cyan)]/20 bg-gradient-to-r from-[var(--color-bg-terminal)] to-[var(--color-bg-card)] overflow-hidden thinking-glow">
      {/* Progress bar */}
      <div className="px-4 pt-3">
        <div className="thinking-bar bg-[var(--color-border)] rounded-full" />
      </div>

      {/* ── Collapsible header (always visible) ──────── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 pt-2.5 pb-2 hover:bg-[var(--color-bg-secondary)]/20 transition-colors"
      >
        <BrainwaveAnimation />

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-cyan)]">
              Gemini is reasoning
            </span>
            <span className="thinking-dots">
              <span />
              <span />
              <span />
            </span>
            {label && (
              <span className="text-[10px] text-[var(--color-text-muted)] font-[var(--font-mono)] truncate max-w-[300px] hidden sm:inline">
                {label}
              </span>
            )}
          </div>
          <StatusCycler />
        </div>

        {/* Expand/collapse chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
            {expanded ? "Collapse" : "Expand"}
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />
          )}
        </div>
      </button>

      {/* ── Collapsible body ─────────────────────────── */}
      {expanded && (
        <>
          {(thinkingText || hasCode) ? (
            <div className={`mx-4 mb-4 mt-1 ${hasCode ? "grid grid-cols-2 gap-3" : ""}`}>
              {/* Left: Vulnerable code snippet */}
              {hasCode && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-terminal)] overflow-hidden flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60">
                    <Code2 className="h-3.5 w-3.5 text-[var(--color-red)]" />
                    <span className="text-[10px] font-bold tracking-[0.15em] text-[var(--color-text-secondary)] uppercase">
                      Vulnerable Code
                    </span>
                    {filePath && (
                      <span className="text-[10px] text-[var(--color-text-muted)] ml-auto font-[var(--font-mono)] truncate max-w-[150px]">
                        {filePath}
                      </span>
                    )}
                  </div>
                  <pre className="flex-1 overflow-y-auto p-3 text-[11px] font-[var(--font-mono)] leading-[1.7] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words terminal-scroll max-h-[60vh]">
                    {vulnerableCode}
                  </pre>
                </div>
              )}

              {/* Right (or full width): Reasoning feed */}
              <div className={`rounded-lg border border-[var(--color-cyan)]/10 bg-[var(--color-bg-terminal)] overflow-hidden flex flex-col max-h-[60vh]`}>
                <ReasoningFeed
                  thinkingText={thinkingText || ""}
                  agent="fixer"
                  label={label}
                />
              </div>
            </div>
          ) : (
            <div className="px-4 pb-4 pt-1 space-y-2">
              <div className="thinking-bar bg-[var(--color-border)] rounded-full" style={{ animationDelay: "0.8s" }} />
              <div className="thinking-bar bg-[var(--color-border)] rounded-full" style={{ animationDelay: "1.2s" }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
