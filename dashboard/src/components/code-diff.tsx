"use client";

import { useMemo, useState } from "react";
import { SyntaxHighlight } from "@/components/syntax-highlight";
import { Download, Columns2, AlignLeft } from "lucide-react";

// ── Side-by-side pane ──────────────────────────────────

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

// ── Connector SVG gutter ───────────────────────────────

function DiffGutter({
  originalLines,
  fixedLines,
}: {
  originalLines: number;
  fixedLines: number;
}) {
  const LINE_HEIGHT = 19.2;
  const HEADER = 33;
  const maxLines = Math.max(originalLines, fixedLines, 1);

  const curves = useMemo(() => {
    const result: { y1: number; y2: number; changed: boolean }[] = [];
    const count = Math.min(originalLines, fixedLines);

    for (let i = 0; i < count; i++) {
      const y1 = HEADER + 12 + i * LINE_HEIGHT + LINE_HEIGHT / 2;
      const y2 = HEADER + 12 + i * LINE_HEIGHT + LINE_HEIGHT / 2;
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

// ── Unified diff view ──────────────────────────────────

function UnifiedDiffView({
  original,
  fixed,
}: {
  original: string;
  fixed: string;
}) {
  const lines = useMemo(() => {
    const origLines = original.split("\n");
    const fixLines  = fixed.split("\n");
    const result: { type: "context" | "removed" | "added"; text: string; lineNo: number }[] = [];
    const maxLen = Math.max(origLines.length, fixLines.length);

    for (let i = 0; i < maxLen; i++) {
      const ol = origLines[i];
      const fl = fixLines[i];
      if (ol === fl) {
        if (ol !== undefined) result.push({ type: "context", text: ol, lineNo: i + 1 });
      } else {
        if (ol !== undefined) result.push({ type: "removed", text: ol, lineNo: i + 1 });
        if (fl !== undefined) result.push({ type: "added",   text: fl, lineNo: i + 1 });
      }
    }
    return result;
  }, [original, fixed]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden font-[var(--font-mono)] text-[12px] leading-[1.6]">
      <div className="overflow-x-auto bg-[var(--color-bg-terminal)]">
        {lines.map((line, i) => {
          const bg =
            line.type === "removed" ? "rgba(127,29,29,0.18)" :
            line.type === "added"   ? "rgba(6,95,70,0.18)" :
            "transparent";
          const prefix =
            line.type === "removed" ? "-" :
            line.type === "added"   ? "+" : " ";
          const color =
            line.type === "removed" ? "var(--color-red)" :
            line.type === "added"   ? "var(--color-emerald)" :
            "var(--color-text-secondary)";

          return (
            <div
              key={i}
              className="flex items-start select-text"
              style={{ background: bg }}
            >
              <span
                className="w-8 shrink-0 text-right pr-2 pt-px select-none text-[11px] text-[var(--color-text-muted)]"
                style={{ minWidth: "2rem" }}
              >
                {line.type === "context" ? line.lineNo : ""}
              </span>
              <span
                className="w-4 shrink-0 text-center font-bold select-none"
                style={{ color }}
              >
                {prefix}
              </span>
              <span
                className="flex-1 whitespace-pre pl-1"
                style={{ color }}
              >
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Public CodeDiff component ──────────────────────────

export function CodeDiff({
  original,
  fixed,
  filePath = "file",
  patchId,
}: {
  original: string;
  fixed: string;
  filePath?: string;
  patchId?: string;
}) {
  const [view, setView] = useState<"split" | "unified">("split");

  if (!original && !fixed) return null;

  const originalLines = original ? original.split("\n").length : 0;
  const fixedLines    = fixed    ? fixed.split("\n").length    : 0;

  const handleDownload = () => {
    const origLines = original.split("\n").map((l) => `-${l}`).join("\n");
    const fixLines  = fixed.split("\n").map((l) => `+${l}`).join("\n");
    const diff = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${originalLines} +1,${fixLines.split("\n").length} @@\n${origLines}\n${fixLines}\n`;

    const blob = new Blob([diff], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinel-${patchId ? patchId.slice(0, 8) : "patch"}.patch`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Toolbar: view toggle + download */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5 bg-[var(--color-bg-secondary)]">
          <button
            onClick={() => setView("split")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition-all ${
              view === "split"
                ? "bg-[var(--color-cyan)]/20 text-[var(--color-cyan)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
            title="Side-by-side view"
          >
            <Columns2 className="h-3 w-3" />
            Split
          </button>
          <button
            onClick={() => setView("unified")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition-all ${
              view === "unified"
                ? "bg-[var(--color-cyan)]/20 text-[var(--color-cyan)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
            title="Unified diff view"
          >
            <AlignLeft className="h-3 w-3" />
            Unified
          </button>
        </div>

        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-all"
          title="Download as .patch file"
        >
          <Download className="h-3 w-3" />
          .patch
        </button>
      </div>

      {/* Diff view */}
      {view === "split" ? (
        <div className="flex gap-0">
          <DiffPane title="Original (vulnerable)" code={original} variant="removed" />
          <DiffGutter originalLines={originalLines} fixedLines={fixedLines} />
          <DiffPane title="Healed (patched)" code={fixed} variant="added" />
        </div>
      ) : (
        <UnifiedDiffView original={original} fixed={fixed} />
      )}
    </div>
  );
}
