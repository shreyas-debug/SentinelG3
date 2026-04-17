const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1";

// ── Enums & Constants ──────────────────────────────────

export type PatchApprovalStatus = "pending" | "approved" | "rejected" | "applied";

// ── Core Types ─────────────────────────────────────────

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
  /** AI confidence in this finding (0–1). */
  confidence_score?: number;
  /** Estimated false positive likelihood. */
  false_positive_likelihood?: "low" | "medium" | "high";
}

export interface PatchResult {
  patch_id: string;
  file_path: string;
  original_code: string;
  fixed_code: string;
  success: boolean;
  message: string;
  /** Lifecycle state of this patch. */
  status?: PatchApprovalStatus;
  /** Risk score 1–10. */
  risk_score?: number;
  /** Backup file path if patch was applied. */
  backup_path?: string | null;
  /** Review timestamp. */
  reviewed_at?: string | null;
  /** Reason if rejected. */
  rejection_reason?: string;
}

export interface ExploitAttempt {
  description: string;
  payload: string;
  attack_type: string;
  would_work_on_original: boolean;
  blocked_by_patch: boolean;
  confidence: number;
}

export interface ValidationResult {
  vulnerability_fixed: boolean;
  confidence_score: number;
  exploit_tests: ExploitAttempt[];
  functional_impact: string;
  recommendation: string;
  reasoning: string;
}

export interface TestCase {
  name: string;
  description: string;
  code: string;
  priority: "critical" | "high" | "medium" | "low";
}

export interface GeneratedTestSuite {
  framework: string;
  test_cases: TestCase[];
  imports: string;
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
  validation?: ValidationResult | null;
  generated_tests?: GeneratedTestSuite | null;
  /** True if the user chose to skip validation for this patch. */
  validation_skipped?: boolean;
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
  | { type: "validation"; data: { patch_id: string; validation: ValidationResult } }
  | { type: "tests_generated"; data: { patch_id: string; tests: GeneratedTestSuite } }
  | { type: "error"; data: { message: string } };

// ── Helper ─────────────────────────────────────────────

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

// ── Patch Operations ───────────────────────────────────

/**
 * Apply a batch of pre-generated patches. (Incremental Healing mode)
 * Handles both local directories and remote GitHub repos.
 */
export async function applyBatchPatches(
  target: string,
  patches: { file_path: string; new_content: string }[],
  options?: { createPr?: boolean; githubToken?: string }
): Promise<{ success: boolean; message: string; pr_url?: string; applied_files?: string[] }> {
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
 * Approve a patch by patch_id. Persists to run_manifest.json on the backend.
 */
export async function approvePatch(
  patchId: string,
  directory: string,
  comments = ""
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/patches/${encodeURIComponent(patchId)}/approve?directory=${encodeURIComponent(directory)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { success: true, message: data.message ?? "Approved" };
}

/**
 * Reject a patch by patch_id. Persists to run_manifest.json on the backend.
 */
export async function rejectPatch(
  patchId: string,
  directory: string,
  rejectionReason = ""
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/patches/${encodeURIComponent(patchId)}/reject?directory=${encodeURIComponent(directory)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejection_reason: rejectionReason }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { success: true, message: data.message ?? "Rejected" };
}

// ── Report Export ──────────────────────────────────────

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
 * Download a SARIF 2.1.0 report (GitHub Advanced Security compatible).
 */
export async function downloadSarifReport(summary: HealingSummary): Promise<void> {
  const res = await fetch(`${API_BASE}/report/sarif`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
  if (!res.ok) throw new Error(`SARIF export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sentinel-g3-results.sarif";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download a machine-readable JSON report.
 */
export async function downloadJsonReport(summary: HealingSummary): Promise<void> {
  const res = await fetch(`${API_BASE}/report/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
  if (!res.ok) throw new Error(`JSON export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sentinel-g3-report.json";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download a spreadsheet-friendly CSV report.
 */
export async function downloadCsvReport(summary: HealingSummary): Promise<void> {
  const res = await fetch(`${API_BASE}/report/csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
  if (!res.ok) throw new Error(`CSV export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sentinel-g3-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Client-side: download a patch diff as a .patch file (no backend needed).
 */
export function downloadPatchDiff(
  originalCode: string,
  fixedCode: string,
  filePath: string,
  patchId: string
): void {
  const origLines = originalCode.split("\n");
  const fixLines  = fixedCode.split("\n");
  // Simple unified diff (client-side)
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const context = `@@ -1,${origLines.length} +1,${fixLines.length} @@\n`;
  const removed = origLines.map((l) => `-${l}`).join("\n");
  const added   = fixLines.map((l) => `+${l}`).join("\n");
  const diff = `${header}${context}${removed}\n${added}\n`;

  const blob = new Blob([diff], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sentinel-${patchId.slice(0, 8)}.patch`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Fix Generation ─────────────────────────────────────

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

// ── Rollback ───────────────────────────────────────────

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

// ── Scan ───────────────────────────────────────────────

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

// ── On-demand Patch Validation ──────────────────────────

/** Per-vulnerability result inside a file-batch validation. */
export interface VulnValidationItem {
  issue_key: string;
  vulnerability_fixed: boolean;
  confidence_score: number;
  exploit_tests: ExploitAttempt[];
  recommendation: string;
}

/** Full result for a single file validated in one Gemini call. */
export interface FileBatchValidation {
  file_path: string;
  all_fixed: boolean;
  overall_confidence: number;
  per_vuln: VulnValidationItem[];
  functional_impact: string;
  reasoning: string;
  generated_tests: GeneratedTestSuite | null;
}

/**
 * Validates ALL vulnerabilities in one file in a single Gemini call.
 * Called by the Validation Suite panel — token-efficient.
 */
export async function validatePatchBatch(data: {
  file_path: string;
  vulnerabilities: Vulnerability[];
  original_code: string;
  patched_code: string;
}): Promise<FileBatchValidation> {
  const res = await fetch(`${API_BASE}/validate-patch-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Calls ValidatorAgent + SecurityTestGenerator for a single patch.
 * Kept for single-issue use cases.
 */
export async function validatePatch(data: {
  vulnerability: Vulnerability;
  original_code: string;
  patched_code: string;
}): Promise<{ validation: ValidationResult; generated_tests: GeneratedTestSuite | null }> {
  const res = await fetch(`${API_BASE}/validate-patch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
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
