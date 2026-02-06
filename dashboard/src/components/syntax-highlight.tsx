"use client";

import { useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

// Singleton highlighter – initialised once, reused across all mounts
let _highlighter: Highlighter | null = null;
let _loading: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (_highlighter) return Promise.resolve(_highlighter);
  if (_loading) return _loading;

  _loading = createHighlighter({
    themes: ["github-dark-default"],
    langs: ["python", "javascript", "typescript", "json", "sql", "bash"],
  }).then((h) => {
    _highlighter = h;
    return h;
  });

  return _loading;
}

/**
 * Detect language from file extension or content heuristics.
 */
function detectLang(code: string): string {
  // Quick heuristic from common patterns
  if (/^import\s+\w|^from\s+\w|def\s+\w|class\s+\w.*:/.test(code)) return "python";
  if (/^(const|let|var|function|import|export)\s/.test(code)) return "javascript";
  if (/SELECT|INSERT|CREATE TABLE|DROP/i.test(code)) return "sql";
  return "python"; // default for this project
}

export function SyntaxHighlight({
  code,
  lang,
}: {
  code: string;
  lang?: string;
}) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    getHighlighter().then((highlighter) => {
      if (cancelled) return;

      const resolved = lang || detectLang(code);
      const result = highlighter.codeToHtml(code, {
        lang: resolved,
        theme: "github-dark-default",
      });
      setHtml(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // While Shiki loads, show plain text with mono styling
  if (!html) {
    return (
      <pre className="text-[12px] leading-[1.6] font-[var(--font-mono)] text-[var(--color-text-secondary)] whitespace-pre-wrap">
        {code}
      </pre>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
