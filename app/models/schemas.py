"""
Sentinel-G3 | Pydantic Schemas

Request / response models shared across the API and agent layers.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Request Models ──────────────────────────────────────────────

class AuditRequest(BaseModel):
    """Payload to start a new security audit."""

    repo_url: str | None = Field(
        default=None,
        description="URL of the repository to audit.",
    )
    source_code: str | None = Field(
        default=None,
        description="Raw source code snippet to audit (alternative to repo_url).",
    )
    directory: str | None = Field(
        default=None,
        description="Local directory path to audit.",
    )
    language: str = Field(
        default="auto",
        description="Programming language hint (e.g. 'python', 'javascript').",
    )


# ── Vulnerability (Auditor output — matches Gemini response_schema) ──

class Vulnerability(BaseModel):
    """A single security vulnerability discovered by the Auditor agent."""

    severity: str = Field(
        description="Severity level: critical | high | medium | low | info",
    )
    issue: str = Field(
        description="Technical description of the vulnerability and exploit scenario.",
    )
    file_path: str = Field(
        description="Relative path of the file containing the vulnerability.",
    )
    line_number: int = Field(
        description="Line number where the vulnerability is located.",
    )
    fix_suggestion: str = Field(
        description="Concise, actionable remediation recommendation.",
    )


class AuditResult(BaseModel):
    """Complete output of the Auditor agent for a single scan."""

    vulnerabilities: list[Vulnerability] = Field(
        default_factory=list,
        description="All vulnerabilities discovered during the audit.",
    )
    scanned_files: int = Field(
        default=0,
        description="Number of source files that were analysed.",
    )
    repository_path: str = Field(
        default="",
        description="Absolute path to the scanned repository.",
    )


# ── Patch result (Fixer output) ─────────────────────────────────

class PatchResult(BaseModel):
    """Output of the Fixer agent for a single vulnerability."""

    file_path: str = Field(
        description="Path to the file that was patched.",
    )
    original_code: str = Field(
        description="The original source code before the fix.",
    )
    fixed_code: str = Field(
        default="",
        description="The remediated source code.",
    )
    success: bool = Field(
        default=False,
        description="Whether the patch was generated successfully.",
    )
    message: str = Field(
        default="",
        description="Human-readable status or error message.",
    )


# ── API-level Finding (public contract) ─────────────────────────

class Finding(BaseModel):
    """A single security finding exposed through the REST API."""

    id: str
    severity: str = Field(description="critical | high | medium | low | info")
    title: str
    description: str
    file: str | None = None
    line: int | None = None
    cwe_id: str | None = None
    suggested_fix: str | None = None


class AuditResponse(BaseModel):
    """Response returned after an audit pipeline is initiated or completed."""

    run_id: str
    status: str = Field(description="pending | running | completed | failed")
    findings: list[Finding] = []
    scanned_files: int = 0


# ── Orchestrator summary ────────────────────────────────────────

class HealingEntry(BaseModel):
    """One vulnerability + its fix outcome inside a healing cycle."""

    vulnerability: Vulnerability
    patch: PatchResult
    healed: bool = False


class HealingCycleSummary(BaseModel):
    """Return value of ``SentinelOrchestrator.run_self_healing_cycle``."""

    run_id: str
    repository_path: str
    scanned_files: int = 0
    vulnerabilities_found: int = 0
    vulnerabilities_healed: int = 0
    entries: list[HealingEntry] = []


class PipelineStatusResponse(BaseModel):
    """Lightweight status of a running pipeline."""

    run_id: str
    stage: str = Field(
        description="not_started | auditing | fixing | validating | done",
    )
    message: str = ""
