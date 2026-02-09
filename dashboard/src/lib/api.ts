const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1";

export interface Vulnerability {
  severity: string;
  issue: string;
  file_path: string;
  line_number: number;
  fix_suggestion: string;
}

export interface PatchResult {
  file_path: string;
  original_code: string;
  fixed_code: string;
  success: boolean;
  message: string;
}

export interface HealingEntry {
  vulnerability: Vulnerability;
  patch: PatchResult;
  healed: boolean;
  auditor_thought?: string;
  fixer_thought?: string;
  /** Which Gemini model produced the reasoning (e.g. "gemini-3-flash-preview"). */
  model_used?: string;
  /** @deprecated Use auditor_thought / fixer_thought */
  thought_text?: string;
}

export interface HealingSummary {
  run_id: string;
  repository_path: string;
  scanned_files: number;
  vulnerabilities_found: number;
  vulnerabilities_healed: number;
  entries: HealingEntry[];
}

export interface PRResult {
  url: string;
  number: number;
  branch: string;
}

export interface ThinkingChunk {
  text: string;
  index: number;
  file: string;
}

export type SSEEvent =
  | { type: "log"; data: { message: string } }
  | { type: "vuln"; data: Vulnerability }
  | { type: "thinking"; data: ThinkingChunk }
  | { type: "patch"; data: HealingEntry }
  | { type: "summary"; data: HealingSummary }
  | { type: "pr"; data: PRResult }
  | { type: "error"; data: { message: string } };

/**
 * Detect whether a target string looks like a remote Git URL.
 */
export function isRepoUrl(target: string): boolean {
  const t = target.trim();
  return (
    t.startsWith("https://github.com/") ||
    t.startsWith("https://gitlab.com/") ||
    t.startsWith("https://bitbucket.org/") ||
    t.startsWith("github.com/") ||
    t.startsWith("gitlab.com/") ||
    t.startsWith("bitbucket.org/")
  );
}

export interface ScanOptions {
  /** GitHub PAT for pushing branches / creating PRs. */
  githubToken?: string;
  /** Whether to create a PR with the fixes. */
  createPr?: boolean;
}

/**
 * Start a scan via SSE. Calls `onEvent` for each server-sent event.
 * Accepts either a local directory path or a remote Git URL.
 * Returns an AbortController so the caller can cancel.
 */
export function startScan(
  target: string,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  options?: ScanOptions,
): AbortController {
  const controller = new AbortController();

  const isRemote = isRepoUrl(target);
  const body: Record<string, unknown> = isRemote
    ? { repo_url: target }
    : { directory: target };

  if (isRemote && options?.githubToken) {
    body.github_token = options.githubToken;
    body.create_pr = options.createPr ?? false;
  }

  fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", data: { message: `HTTP ${res.status}` } });
        onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent({ type: currentEvent, data } as SSEEvent);
            } catch { /* skip malformed */ }
            currentEvent = "";
          }
        }
      }

      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onEvent({ type: "error", data: { message: String(err) } });
      }
      onDone();
    });

  return controller;
}
