"""
tests/test_multilang.py

Multi-language security audit tests for Sentinel-G3.
Runs the AuditorAgent against deliberately vulnerable files in
tests/fixtures/ and asserts that the correct vulnerability types
are detected for each language.

Usage:
    cd e:\Personal\SentinelG3
    .\.venv\Scripts\python.exe -m pytest tests/test_multilang.py -v

Requires:
    - GEMINI_API_KEY in .env
    - The .venv virtual environment activated or called via the venv python
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# ── Make sure the project root is on sys.path ──────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.agents.auditor import AuditorAgent  # noqa: E402
from app.config import settings  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


# ── Helper ──────────────────────────────────────────────────────

async def _audit(fixture_name: str) -> list[dict]:
    """Run the auditor against a single fixture file and return vulnerability dicts."""
    agent = AuditorAgent()
    file_path = FIXTURES / fixture_name
    assert file_path.exists(), f"Fixture not found: {file_path}"
    source = file_path.read_text(encoding="utf-8")
    result = await agent._audit_single_file(fixture_name, source)
    # result may be a list[Vulnerability] or an AuditResult
    if hasattr(result, "vulnerabilities"):
        vulns = [v.model_dump() for v in result.vulnerabilities]
    else:
        vulns = [v.model_dump() for v in result]
    return vulns


# ── Go: goroutine race condition ─────────────────────────────────

@pytest.mark.asyncio
async def test_go_race_condition_detected():
    """Auditor must flag the goroutine data race in vuln.go."""
    vulns = await _audit("vuln.go")
    assert len(vulns) >= 1, "Expected at least one vulnerability in the Go fixture"

    issues_text = " ".join(v.get("issue", "").lower() for v in vulns)
    # Should mention race / concurrent / mutex / sync
    assert any(kw in issues_text for kw in ["race", "concurrent", "mutex", "sync", "goroutine"]), (
        f"Expected a race condition finding, got: {[v['issue'] for v in vulns]}"
    )

    severities = {v.get("severity", "").lower() for v in vulns}
    assert severities & {"critical", "high", "medium"}, (
        f"Expected high/critical/medium severity, got: {severities}"
    )


# ── Rust: unsafe pointer dereference ────────────────────────────

@pytest.mark.asyncio
async def test_rust_unsafe_dereference_detected():
    """Auditor must flag the null pointer dereference in vuln.rs."""
    vulns = await _audit("vuln.rs")
    assert len(vulns) >= 1, "Expected at least one vulnerability in the Rust fixture"

    issues_text = " ".join(v.get("issue", "").lower() for v in vulns)
    assert any(kw in issues_text for kw in ["unsafe", "null", "pointer", "dereference", "overflow", "raw"]), (
        f"Expected an unsafe/pointer finding, got: {[v['issue'] for v in vulns]}"
    )


# ── Terraform: public S3 bucket ──────────────────────────────────

@pytest.mark.asyncio
async def test_terraform_public_s3_detected():
    """Auditor must flag at least the public S3 bucket in vuln.tf."""
    vulns = await _audit("vuln.tf")
    assert len(vulns) >= 1, "Expected at least one vulnerability in the Terraform fixture"

    issues_text = " ".join(v.get("issue", "").lower() for v in vulns)
    assert any(kw in issues_text for kw in ["s3", "public", "acl", "bucket", "world", "open", "exposed"]), (
        f"Expected an S3/public-access finding, got: {[v['issue'] for v in vulns]}"
    )

    severities = {v.get("severity", "").lower() for v in vulns}
    assert severities & {"critical", "high"}, (
        f"Expected critical or high severity for S3 misconfiguration, got: {severities}"
    )


# ── Terraform: hardcoded secret ──────────────────────────────────

@pytest.mark.asyncio
async def test_terraform_hardcoded_secret_detected():
    """Auditor must flag the hardcoded DB password in vuln.tf."""
    vulns = await _audit("vuln.tf")
    issues_text = " ".join(v.get("issue", "").lower() for v in vulns)
    assert any(kw in issues_text for kw in ["hardcoded", "password", "secret", "plaintext", "credential"]), (
        f"Expected a hardcoded-secret finding in Terraform fixture, got: {[v['issue'] for v in vulns]}"
    )


# ── New fields populated ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_new_fields_populated():
    """Verify that eli5_explanation and exploit_poc are populated by the new prompt."""
    vulns = await _audit("vuln.tf")
    assert len(vulns) >= 1
    first = vulns[0]
    # At least one of the new fields should be non-empty
    assert first.get("eli5_explanation") or first.get("exploit_poc") or first.get("attack_scenario"), (
        "Expected at least one of eli5_explanation / exploit_poc / attack_scenario to be populated. "
        f"Got: eli5='{first.get('eli5_explanation')}', poc='{first.get('exploit_poc')}'"
    )
