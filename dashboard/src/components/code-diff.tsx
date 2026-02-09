"use client";

import { useMemo } from "react";
import { SyntaxHighlight } from "@/components/syntax-highlight";

function DiffPane({
  title,
  code,
  variant,
}: {
  title: string;
  code: string;
  variant: "removed" | "added";
}) {
  const isRemoved = variant === "removed";
  const accent = isRemoved
    ? "text-[var(--color-red)] border-[var(--color-red)]"
    : "text-[var(--color-emerald)] border-[var(--color-emerald)]";

  const gutterColor = isRemoved ? "var(--color-red)" : "var(--color-emerald)";
  const gutterBg = isRemoved ? "rgba(127,29,29,0.12)" : "rgba(6,95,70,0.12)";
  // Faint background tint across the entire code area
  const codeBg = isRemoved ? "rgba(127,29,29,0.06)" : "rgba(6,95,70,0.06)";

  const lines = code.split("\n");

  return (
    <div
      className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] overflow-hidden"
      style={{ background: codeBg }}
    >
      {/* Pane header */}
      <div
        className={`px-3 py-1.5 border-b border-[var(--color-border)] text-xs font-semibold uppercase tracking-wider ${accent}`}
        style={{ background: isRemoved ? "rgba(127,29,29,0.08)" : "rgba(6,95,70,0.08)" }}
      >
        {title}
      </div>

      {/* Code body */}
      <div className="relative overflow-x-auto">
        {/* Line-number gutter */}
        <div
          className="absolute top-0 left-0 bottom-0 w-10 pointer-events-none select-none"
          style={{ background: gutterBg }}
        >
          <div className="p-3 text-[12px] leading-[1.6] font-[var(--font-mono)] text-[var(--color-text-muted)] text-right pr-2">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>

        {/* Gutter accent stripe */}
        <div
          className="absolute top-0 left-0 bottom-0 w-[3px]"
          style={{ background: gutterColor }}
        />

        {/* Highlighted code */}
        <div className="pl-12 p-3">
          <SyntaxHighlight code={code} />
        </div>
      </div>
    </div>
  );
}

/**
 * Central gutter with bezier curves connecting corresponding lines.
 * Draws a simple SVG with curves from left-pane line positions to
 * right-pane line positions, giving a visual "flow" cue.
 */
function DiffGutter({
  originalLines,
  fixedLines,
}: {
  originalLines: number;
  fixedLines: number;
}) {
  const LINE_HEIGHT = 19.2; // ~12px font * 1.6 leading
  const HEADER = 33;        // approx header height
  const maxLines = Math.max(originalLines, fixedLines, 1);

  const curves = useMemo(() => {
    const result: { y1: number; y2: number; changed: boolean }[] = [];
    const count = Math.min(originalLines, fixedLines);

    for (let i = 0; i < count; i++) {
      const y1 = HEADER + 12 + i * LINE_HEIGHT + LINE_HEIGHT / 2;
      const y2 = HEADER + 12 + i * LINE_HEIGHT + LINE_HEIGHT / 2;
      // Mark every 3rd line as "changed" for a visual hint
      result.push({ y1, y2, changed: i % 3 === 0 });
    }
    return result;
  }, [originalLines, fixedLines]);

  const svgHeight = HEADER + 12 + maxLines * LINE_HEIGHT + 12;

  return (
    <div className="w-8 shrink-0 relative">
      <svg
        className="w-full h-full absolute inset-0"
        viewBox={`0 0 32 ${svgHeight}`}
        preserveAspectRatio="none"
        style={{ height: svgHeight }}
      >
        {curves.map((c, i) => (
          <path
            key={i}
            d={`M 0 ${c.y1} C 12 ${c.y1}, 20 ${c.y2}, 32 ${c.y2}`}
            fill="none"
            stroke={c.changed ? "var(--color-amber)" : "var(--color-border)"}
            strokeWidth={c.changed ? 1.5 : 0.5}
            opacity={c.changed ? 0.5 : 0.2}
          />
        ))}
      </svg>
    </div>
  );
}

export function CodeDiff({
  original,
  fixed,
}: {
  original: string;
  fixed: string;
}) {
  if (!original && !fixed) return null;

  const originalLines = original ? original.split("\n").length : 0;
  const fixedLines = fixed ? fixed.split("\n").length : 0;

  return (
    <div className="flex gap-0 mt-3">
      <DiffPane title="Original (vulnerable)" code={original} variant="removed" />
      <DiffGutter originalLines={originalLines} fixedLines={fixedLines} />
      <DiffPane title="Healed (patched)" code={fixed} variant="added" />
    </div>
  );
}
