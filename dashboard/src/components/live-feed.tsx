"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

export function LiveFeed({ logs }: { logs: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-terminal)] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <Terminal className="h-4 w-4 text-[var(--color-emerald)]" />
        <span className="text-xs font-semibold tracking-wider text-[var(--color-text-secondary)] uppercase">
          Live Feed
        </span>
        <div className="ml-auto flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-red)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-amber)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-emerald)]" />
        </div>
      </div>

      {/* Terminal body */}
      <div className="h-64 overflow-y-auto p-4 terminal-scroll font-[var(--font-mono)] text-[13px] leading-relaxed">
        {logs.length === 0 && (
          <p className="text-[var(--color-text-muted)] italic">
            Waiting for scan to start…
          </p>
        )}
        {logs.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-[var(--color-text-muted)] select-none shrink-0">
              {String(i + 1).padStart(3, "0")}
            </span>
            <span
              className={
                line.includes("✓")
                  ? "text-[var(--color-emerald)]"
                  : line.includes("✗")
                  ? "text-[var(--color-red)]"
                  : line.includes("▶")
                  ? "text-[var(--color-amber)]"
                  : line.includes("═══")
                  ? "text-[var(--color-cyan)] font-bold"
                  : "text-[var(--color-text-secondary)]"
              }
            >
              {line}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
