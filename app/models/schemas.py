"""
Sentinel-G3 | Pydantic Schemas

Request / response models shared across the API and agent layers.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


# ── Patch Approval Status ────────────────────────────────

class PatchApprovalStatus(str, Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED  = "applied"


# ── Request Models ───────────────────────────────────────

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
    eli5_explanation: str = Field(
        default="",
        description=(
            "A simple analogy explaining this vulnerability for a non-technical audience. "
            "Example: 'An attacker can trick your database into revealing all passwords.'"
        ),
    )
    exploit_poc: str = Field(
        default="",
        description=(
            "A concrete proof-of-concept exploit string or command demonstrating how this "
            "vulnerability can be triggered. Example: curl command, SQL payload, script snippet."
        ),
    )
    attack_scenario: str = Field(
        default="",
        description=(
            "Step-by-step narrative of how a real attacker would exploit this vulnerability, "
            "including the goal, method, and potential impact."
        ),
    )
    # AI confidence in this finding (0.0 – 1.0), set by the auditor
    confidence_score: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="AI's confidence in this finding (0–1). Higher = more certain.",
    )
    false_positive_likelihood: str = Field(
        default="low",
        description="Estimated FP likelihood: low | medium | high",
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


# ── Patch result (Fixer output) ──────────────────────────

class PatchResult(BaseModel):
    """Output of the Fixer agent for a single vulnerability."""

    patch_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this patch (UUID).",
    )
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
    status: PatchApprovalStatus = Field(
        default=PatchApprovalStatus.PENDING,
        description="Lifecycle state of this patch.",
    )
    risk_score: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Risk score 1–10 (10 = most dangerous). Derived from severity + scope.",
    )
    backup_path: str | None = Field(
        default=None,
        description="Path to the backup file created before patching.",
    )
    reviewed_at: datetime | None = Field(
        default=None,
        description="Timestamp when the patch was last reviewed.",
    )
    rejection_reason: str = Field(
        default="",
        description="Optional reason if patch was rejected.",
    )


# ── API-level Finding (public contract) ─────────────────

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


# ── Orchestrator summary ─────────────────────────────────

class HealingEntry(BaseModel):
    """One vulnerability + its fix outcome inside a healing cycle."""

    vulnerability: Vulnerability
    patch: PatchResult | None = None
    healed: bool = False
    validation: "ValidationResult | None" = None
    generated_tests: "GeneratedTestSuite | None" = None


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


# ── Validation & Test Generation ─────────────────────────

class ExploitAttempt(BaseModel):
    """Single exploit test case used during validation."""

    description: str = Field(description="What this exploit attempts.")
    payload: str = Field(description="The exploit payload or command.")
    attack_type: str = Field(description="e.g. SQL Injection, XSS, Path Traversal")
    would_work_on_original: bool = Field(description="Does this exploit work on the original code?")
    blocked_by_patch: bool = Field(description="Is this exploit blocked by the patch?")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in this assessment.")


class ValidationResult(BaseModel):
    """Result of validating a security fix."""

    vulnerability_fixed: bool = Field(description="Whether the vulnerability is confirmed fixed.")
    confidence_score: float = Field(ge=0.0, le=1.0, description="Overall fix confidence (0–1).")
    exploit_tests: list[ExploitAttempt] = Field(default_factory=list)
    functional_impact: str = Field(
        default="No breaking changes",
        description="Describes functional side-effects of the patch.",
    )
    recommendation: str = Field(
        default="Deploy",
        description="'Deploy' if fix is solid, 'Needs revision' otherwise.",
    )
    reasoning: str = Field(default="", description="AI's reasoning summary.")


class TestCase(BaseModel):
    """A single generated security test case."""

    name: str = Field(description="Function name, e.g. test_sql_injection_blocked.")
    description: str = Field(description="What this test verifies.")
    code: str = Field(description="Full pytest test code.")
    priority: str = Field(description="critical | high | medium | low")


class VulnValidationItem(BaseModel):
    """Per-vulnerability result inside a file-batch validation call."""

    issue_key: str = Field(description="Short identifier matching the vulnerability issue text.")
    vulnerability_fixed: bool = Field(description="Whether this specific vulnerability is confirmed fixed.")
    confidence_score: float = Field(ge=0.0, le=1.0, description="Confidence that this fix is effective.")
    exploit_tests: list[ExploitAttempt] = Field(default_factory=list)
    recommendation: str = Field(default="Deploy", description="'Deploy' or 'Needs revision'.")


class FileBatchValidationResult(BaseModel):
    """Gemini response schema for validating all vulnerabilities in one file."""

    all_fixed: bool = Field(description="True if ALL vulnerabilities in the file are confirmed fixed.")
    overall_confidence: float = Field(ge=0.0, le=1.0, description="Average confidence across all fixes.")
    per_vuln: list[VulnValidationItem] = Field(default_factory=list, description="One result per vulnerability.")
    functional_impact: str = Field(default="No breaking changes", description="Side-effects of the patches.")
    reasoning: str = Field(default="", description="AI reasoning summary.")


class GeneratedTestSuite(BaseModel):
    """Test suite generated for a fixed vulnerability."""

    framework: str = Field(default="pytest", description="Test framework used.")
    test_cases: list[TestCase] = Field(default_factory=list)
    imports: str = Field(default="", description="Required import statements.")


# ── Patch review request/response ─────────────────────────

class PatchReviewRequest(BaseModel):
    """Request body for approve/reject endpoints."""
    comments: str = Field(default="", description="Optional reviewer comments.")
    rejection_reason: str = Field(default="", description="Required when rejecting a patch.")


class PatchReviewResponse(BaseModel):
    """Response from patch review endpoints."""
    patch_id: str
    status: PatchApprovalStatus
    message: str
    reviewed_at: datetime | None = None
