const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1";

export interface Vulnerability {
  severity: string;
  issue: string;
  file_path: string;
  line_number: number;
  fix_suggestion: string;
  /** Plain-English explanation for non-technical audiences. */
  eli5_explanation?: string;
  /** Concrete proof-of-concept exploit command / payload. */
  exploit_poc?: string;
  /** Step-by-step attacker narrative. */
  attack_scenario?: string;
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
  patch: PatchResult | null;
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
  | { type: "no_pr_info"; data: { message: string; instructions: string[]; reason: string; healed_count: number } }
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
  /**
   * If false, patches are NOT applied automatically — the user must click
   * "Approve Fix" in the dashboard to apply each one via POST /apply.
   * Defaults to true for backwards compatibility.
   */
  autoApply?: boolean;
}

/**
 * Apply a batch of pre-generated patches. (Incremental Healing mode)
 * Handles both local directories and remote GitHub repos.
 */
export async function applyBatchPatches(
  target: string,
  patches: { file_path: string; new_content: string }[],
  options?: { createPr?: boolean; githubToken?: string }
): Promise<{ success: boolean; message: string; pr_url?: string }> {
  const body = {
    target,
    patches,
    create_pr: options?.createPr ?? false,
    github_token: options?.githubToken ?? "",
  };

  const res = await fetch(`${API_BASE}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  }
  return res.json();
}

/**
 * Generate a professional HTML security report from a completed scan summary.
 * Posts data to the backend /report endpoint, gets back HTML, and returns a
 * Blob URL that can be opened in a new browser tab.
 */
export async function generateReport(summary: HealingSummary): Promise<string> {
  const res = await fetch(`${API_BASE}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
  if (!res.ok) {
    throw new Error(`Report generation failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  const blob = new Blob([html], { type: "text/html" });
  return URL.createObjectURL(blob);
}

/**
 * Generate a security patch for a single vulnerability on-demand.
 * Returns an SSE stream with thinking chunks and the final patch result.
 */
export function generateFix(
  vulnerability: Vulnerability,
  originalCode: string,
  onThinking: (text: string) => void,
  onComplete: (patch: PatchResult, fixerThought: string, modelUsed: string) => void,
  onError: (message: string) => void,
): AbortController {
  const controller = new AbortController();

  const body = {
    vulnerability,
    original_code: originalCode,
  };

  fetch(`${API_BASE}/fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "thinking") {
                onThinking(data.text);
              } else if (currentEvent === "patch") {
                onComplete(
                  data.patch,
                  data.fixer_thought || "",
                  data.model_used || "unknown"
                );
              } else if (currentEvent === "error") {
                onError(data.message);
              }
            } catch {
              /* skip malformed */
            }
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError(String(err));
      }
    });

  return controller;
}

/**
 * Rollback a file to its most recent backup from .sentinel-g3/backups/.
 */
export async function rollbackFile(
  filePath: string,
  repoRoot: string,
  backupTimestamp?: string
): Promise<{ success: boolean; message: string; backup_used?: string }> {
  const body = {
    file_path: filePath,
    repo_root: repoRoot,
    backup_timestamp: backupTimestamp,
  };

  const res = await fetch(`${API_BASE}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  }

  return res.json();
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

  // Always send auto_apply so the backend respects Incremental Healing mode
  body.auto_apply = options?.autoApply ?? false;

  fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => "");
        const errorMsg = errorText || `HTTP ${res.status}`;
        onEvent({ type: "error", data: { message: errorMsg } });
        onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";


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

/**
 * Upload and scan a ZIP file containing a local repository.
 * Returns an AbortController so the caller can cancel.
 */
export function startZipScan(
  file: File,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController();

  const formData = new FormData();
  formData.append("file", file);

  fetch(`${API_BASE}/scan/upload`, {
    method: "POST",
    body: formData,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => "");
        const errorMsg = errorText || `HTTP ${res.status}`;
        onEvent({ type: "error", data: { message: errorMsg } });
        onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data:")) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              if (currentEvent) {
                onEvent({ type: currentEvent, data } as SSEEvent);
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
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
