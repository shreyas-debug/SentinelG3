"use client";

import { Sparkles } from "lucide-react";

/**
 * Animated "AI is thinking" indicator shown inside the Chain of Thought
 * section while the SSE stream is still active.
 */
export function ThinkingIndicator() {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-terminal)] p-5 thinking-glow">
      {/* Progress bar */}
      <div className="thinking-bar bg-[var(--color-border)] mb-4" />

      {/* Animated content */}
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-[var(--color-cyan)] animate-pulse shrink-0" />
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-[var(--color-cyan)]">
              Gemini 3 Pro is reasoning
            </span>
            <span className="thinking-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
            Analyzing code patterns, evaluating exploit vectors, synthesizing a fix…
          </p>
        </div>
      </div>

      {/* Secondary progress bar */}
      <div className="thinking-bar bg-[var(--color-border)] mt-4" style={{ animationDelay: "0.8s" }} />
    </div>
  );
}
