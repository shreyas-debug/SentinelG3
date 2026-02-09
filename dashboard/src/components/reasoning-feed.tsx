"use client";

import { useEffect, useRef } from "react";
import { Brain, Search, Wrench } from "lucide-react";

interface ReasoningBubbleProps {
  agent: "auditor" | "fixer";
  text: string;
}

function ReasoningBubble({ agent, text }: ReasoningBubbleProps) {
  const isAuditor = agent === "auditor";
  const Icon = isAuditor ? Search : Wrench;
  const label = isAuditor ? "Auditor" : "Fixer";
  const accent = isAuditor ? "var(--color-amber)" : "var(--color-emerald)";

  return (
    <div className="flex gap-2.5 mb-3">
      {/* Avatar */}
      <div
        className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
            {label} Agent
          </span>
        </div>
        <div
          className="chat-bubble px-3 py-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[12px] leading-[1.7] text-[var(--color-text-secondary)] font-[var(--font-mono)] whitespace-pre-wrap break-words"
        >
          {text}
        </div>
      </div>
    </div>
  );
}

interface ReasoningFeedProps {
  thinkingText: string;
  agent?: "auditor" | "fixer";
  label?: string;
}

/**
 * Live reasoning feed that displays agent thoughts as chat bubbles.
 * - max-h-[60vh] with overflow-y-auto and scroll-smooth
 * - Auto-scrolls to bottom on every new chunk
 */
export function ReasoningFeed({ thinkingText, agent = "fixer", label }: ReasoningFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever new text arrives
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [thinkingText]);

  // Split on double-newline into distinct "thought" chunks
  const chunks = thinkingText
    ? thinkingText.split(/\n{2,}/).filter((c) => c.trim())
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 shrink-0">
        <Brain className="h-3.5 w-3.5 text-[var(--color-cyan)]" />
        <span className="text-[10px] font-bold tracking-[0.15em] text-[var(--color-text-secondary)] uppercase">
          Agent Reasoning
        </span>
        {label && (
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto font-[var(--font-mono)] truncate max-w-[200px]">
            {label}
          </span>
        )}
      </div>

      {/* Reasoning bubbles — scrollable */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 terminal-scroll scroll-smooth"
        style={{ maxHeight: "60vh" }}
      >
        {chunks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)] text-xs py-6">
            {/* Mini brainwave while waiting */}
            <div className="flex items-end gap-[3px] h-5 opacity-50">
              <div className="brainwave-bar" />
              <div className="brainwave-bar" />
              <div className="brainwave-bar" />
              <div className="brainwave-bar" />
              <div className="brainwave-bar" />
              <div className="brainwave-bar" />
            </div>
            <span className="italic">Waiting for agent reasoning…</span>
          </div>
        ) : (
          chunks.map((chunk, i) => (
            <ReasoningBubble key={i} agent={agent} text={chunk} />
          ))
        )}

        {/* Blinking cursor at the bottom when thinking is active */}
        {thinkingText && (
          <div className="flex items-center gap-1.5 pl-9 mt-1">
            <span className="h-2 w-2 rounded-full bg-[var(--color-cyan)] cursor-blink" />
            <span className="text-[10px] text-[var(--color-cyan)]/60 font-[var(--font-mono)]">
              thinking…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
