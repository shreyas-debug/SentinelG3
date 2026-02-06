"use client";

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
  const accent =
    variant === "removed"
      ? "text-[var(--color-red)] border-[var(--color-red)]"
      : "text-[var(--color-emerald)] border-[var(--color-emerald)]";

  const gutterColor =
    variant === "removed" ? "var(--color-red)" : "var(--color-emerald)";
  const gutterBg =
    variant === "removed" ? "rgba(127,29,29,0.12)" : "rgba(6,95,70,0.12)";

  const lines = code.split("\n");

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-terminal)] overflow-hidden">
      {/* Pane header */}
      <div
        className={`px-3 py-1.5 border-b border-[var(--color-border)] text-xs font-semibold uppercase tracking-wider ${accent}`}
      >
        {title}
      </div>

      {/* Code body */}
      <div className="relative overflow-x-auto">
        {/* Line-number gutter */}
        <div className="absolute top-0 left-0 bottom-0 w-10 pointer-events-none select-none"
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

export function CodeDiff({
  original,
  fixed,
}: {
  original: string;
  fixed: string;
}) {
  if (!original && !fixed) return null;

  return (
    <div className="flex gap-3 mt-3">
      <DiffPane title="Original (vulnerable)" code={original} variant="removed" />
      <DiffPane title="Healed (patched)" code={fixed} variant="added" />
    </div>
  );
}
