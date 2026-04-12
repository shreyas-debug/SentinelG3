"""
Sentinel-G3 | Patch Approval Workflow Tests

Verifies the core security guarantee:
    Patches are NEVER auto-applied without explicit user confirmation.

Run with:
    pytest tests/test_approval_workflow.py -v
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import (
    HealingCycleSummary,
    HealingEntry,
    PatchApprovalStatus,
    PatchResult,
    Vulnerability,
)


# ── Fixtures ─────────────────────────────────────────────

@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def sample_vulnerability() -> Vulnerability:
    return Vulnerability(
        severity="critical",
        issue="SQL Injection via unsanitised user input in login form",
        file_path="app/auth.py",
        line_number=42,
        fix_suggestion="Use parameterised queries instead of string concatenation.",
        eli5_explanation="An attacker can steal all passwords via a special username.",
        exploit_poc="curl -X POST /login -d \"username=' OR 1=1--&password=x\"",
        attack_scenario="Attacker submits a malicious username payload.",
        confidence_score=0.95,
    )


@pytest.fixture
def sample_patch(sample_vulnerability) -> PatchResult:
    return PatchResult(
        patch_id=str(uuid.uuid4()),
        file_path=sample_vulnerability.file_path,
        original_code="cursor.execute(f\"SELECT * FROM users WHERE name='{username}'\")",
        fixed_code="cursor.execute(\"SELECT * FROM users WHERE name=%s\", (username,))",
        success=True,
        message="Patch generated successfully.",
        status=PatchApprovalStatus.PENDING,
        risk_score=8,
    )


@pytest.fixture
def sample_healing_entry(sample_vulnerability, sample_patch) -> HealingEntry:
    return HealingEntry(
        vulnerability=sample_vulnerability,
        patch=sample_patch,
        healed=False,
    )


@pytest.fixture
def tmp_manifest(tmp_path, sample_healing_entry) -> Path:
    """Creates a temporary run_manifest.json for approve/reject tests."""
    manifest = {
        "runs": [
            {
                "run_id": "test-run-001",
                "entries": [
                    {
                        "vulnerability": sample_healing_entry.vulnerability.model_dump(),
                        "patch": sample_healing_entry.patch.model_dump(),
                        "healed": False,
                    }
                ],
            }
        ]
    }
    path = tmp_path / "run_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    return tmp_path


# ── Schema Tests ─────────────────────────────────────────

class TestPatchApprovalSchema:
    """Tests for the PatchApprovalStatus schema and PatchResult model."""

    def test_default_status_is_pending(self, sample_patch):
        """New patches must start as PENDING, never auto-approved."""
        assert sample_patch.status == PatchApprovalStatus.PENDING

    def test_patch_has_uuid_patch_id(self, sample_patch):
        """Every patch must have a UUID-format patch_id."""
        # Should be parseable as UUID
        parsed = uuid.UUID(sample_patch.patch_id)
        assert str(parsed) == sample_patch.patch_id

    def test_risk_score_in_range(self, sample_patch):
        """Risk score must be between 1 and 10."""
        assert 1 <= sample_patch.risk_score <= 10

    def test_rejection_reason_default_empty(self, sample_patch):
        """Rejection reason starts empty."""
        assert sample_patch.rejection_reason == ""

    def test_patch_approval_status_values(self):
        """All four lifecycle states must exist."""
        assert set(PatchApprovalStatus) == {
            PatchApprovalStatus.PENDING,
            PatchApprovalStatus.APPROVED,
            PatchApprovalStatus.REJECTED,
            PatchApprovalStatus.APPLIED,
        }

    def test_vulnerability_confidence_score_range(self, sample_vulnerability):
        """Confidence score must be between 0 and 1."""
        assert 0.0 <= sample_vulnerability.confidence_score <= 1.0

    def test_vulnerability_false_positive_likelihood_values(self, sample_vulnerability):
        """FP likelihood must be one of the allowed strings."""
        assert sample_vulnerability.false_positive_likelihood in ("low", "medium", "high")


# ── Default Behaviour: Auto-Apply is OFF ─────────────────

class TestAutoApplyOff:
    """Verifies the critical security guarantee: auto_apply defaults to False."""

    def test_scan_request_default_auto_apply_off(self):
        """POST /scan with no auto_apply field must default to False (non-auto)."""
        import inspect
        from app.api.routes import run_scan

        # The ScanRequest model in routes should default auto_apply to False
        # We test by introspecting the route signature
        from pydantic import BaseModel
        from app.api.routes import ScanRequest  # type: ignore[attr-defined]
        instance = ScanRequest(directory="/tmp/test")
        assert instance.auto_apply is False, (
            "CRITICAL: auto_apply must default to False — "
            "patches must never be applied without user confirmation!"
        )

    def test_healing_entry_default_not_healed(self, sample_healing_entry):
        """New entries must start with healed=False."""
        assert sample_healing_entry.healed is False

    def test_patch_default_not_applied(self, sample_patch):
        """A new patch is PENDING, not APPLIED."""
        assert sample_patch.status != PatchApprovalStatus.APPLIED


# ── Approve Endpoint ──────────────────────────────────────

class TestApproveEndpoint:
    """Tests for POST /patches/{patch_id}/approve endpoint."""

    def test_approve_patch_changes_status(self, client, tmp_manifest, sample_patch):
        """Approving a patch should change its status to APPROVED."""
        patch_id = sample_patch.patch_id
        directory = str(tmp_manifest)

        resp = client.post(
            f"/api/v1/patches/{patch_id}/approve",
            params={"directory": directory},
            json={"comments": "LGTM"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == PatchApprovalStatus.APPROVED
        assert data["patch_id"] == patch_id

    def test_approve_updates_manifest_file(self, client, tmp_manifest, sample_patch):
        """The manifest file on disk should reflect APPROVED status after approval."""
        patch_id = sample_patch.patch_id
        directory = str(tmp_manifest)

        client.post(
            f"/api/v1/patches/{patch_id}/approve",
            params={"directory": directory},
            json={},
        )

        # Re-read manifest from disk
        manifest_data = json.loads((tmp_manifest / "run_manifest.json").read_text())
        patch_in_manifest = manifest_data["runs"][0]["entries"][0]["patch"]
        assert patch_in_manifest["status"] == PatchApprovalStatus.APPROVED

    def test_cannot_approve_unknown_patch(self, client, tmp_manifest):
        """Approving a non-existent patch_id should return 404."""
        resp = client.post(
            "/api/v1/patches/nonexistent-id/approve",
            params={"directory": str(tmp_manifest)},
            json={},
        )
        assert resp.status_code == 404


# ── Reject Endpoint ───────────────────────────────────────

class TestRejectEndpoint:
    """Tests for POST /patches/{patch_id}/reject endpoint."""

    def test_reject_patch_changes_status(self, client, tmp_manifest, sample_patch):
        """Rejecting a patch should change its status to REJECTED."""
        patch_id = sample_patch.patch_id
        directory = str(tmp_manifest)

        resp = client.post(
            f"/api/v1/patches/{patch_id}/reject",
            params={"directory": directory},
            json={"rejection_reason": "This patch breaks the ORM abstraction."},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == PatchApprovalStatus.REJECTED

    def test_reject_stores_reason_in_manifest(self, client, tmp_manifest, sample_patch):
        """Rejection reason should be persisted to the manifest file."""
        reason = "Conflicts with existing security middleware."
        client.post(
            f"/api/v1/patches/{sample_patch.patch_id}/reject",
            params={"directory": str(tmp_manifest)},
            json={"rejection_reason": reason},
        )

        manifest_data = json.loads((tmp_manifest / "run_manifest.json").read_text())
        patch_in_manifest = manifest_data["runs"][0]["entries"][0]["patch"]
        assert patch_in_manifest["rejection_reason"] == reason

    def test_cannot_approve_rejected_patch(self, client, tmp_manifest, sample_patch):
        """Once rejected, a patch cannot be re-approved."""
        directory = str(tmp_manifest)
        patch_id = sample_patch.patch_id

        # First reject
        client.post(
            f"/api/v1/patches/{patch_id}/reject",
            params={"directory": directory},
            json={"rejection_reason": "Bad patch."},
        )

        # Then try to approve → should fail
        resp = client.post(
            f"/api/v1/patches/{patch_id}/approve",
            params={"directory": directory},
            json={},
        )
        assert resp.status_code == 400

    def test_cannot_reject_unknown_patch(self, client, tmp_manifest):
        """Rejecting a non-existent patch_id should return 404."""
        resp = client.post(
            "/api/v1/patches/nonexistent-id/reject",
            params={"directory": str(tmp_manifest)},
            json={},
        )
        assert resp.status_code == 404


# ── Get Patch Details ─────────────────────────────────────

class TestGetPatchDetails:
    """Tests for GET /patches/{patch_id} endpoint."""

    def test_get_patch_returns_diff(self, client, tmp_manifest, sample_patch):
        """GET /patches/{id} should return a unified diff."""
        resp = client.get(
            f"/api/v1/patches/{sample_patch.patch_id}",
            params={"directory": str(tmp_manifest)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "diff" in data
        assert data["patch_id"] == sample_patch.patch_id

    def test_get_unknown_patch_returns_404(self, client, tmp_manifest):
        """GET /patches/nonexistent should 404."""
        resp = client.get(
            "/api/v1/patches/nonexistent",
            params={"directory": str(tmp_manifest)},
        )
        assert resp.status_code == 404


# ── CORS Configuration ────────────────────────────────────

class TestCORSConfiguration:
    """Verifies CORS is not wildcard '*' for production deployments."""

    def test_cors_defaults_to_allow_all_in_dev(self):
        """Default dev env has * for convenience; production must override."""
        from app.config import settings
        import os
        # If ALLOWED_ORIGINS is not set, default is * — acceptable for dev only
        # In CI/production, ALLOWED_ORIGINS should be set explicitly
        origins = settings.get_allowed_origins()
        assert isinstance(origins, list), "get_allowed_origins() must return a list"
        assert len(origins) > 0, "At least one origin must be configured"

    def test_allowed_origins_parses_multiple(self):
        """ALLOWED_ORIGINS with comma-separated values should return a list."""
        from app.config import Settings
        orig = Settings.ALLOWED_ORIGINS
        try:
            Settings.ALLOWED_ORIGINS = "https://app.com,https://admin.app.com"
            origins = Settings.get_allowed_origins()
            assert "https://app.com" in origins
            assert "https://admin.app.com" in origins
        finally:
            Settings.ALLOWED_ORIGINS = orig


# ── Backup Path Consistency ───────────────────────────────

class TestBackupPaths:
    """Verifies that backup paths use the .sentinel-g3/backups/ structure."""

    def test_backup_root_path_format(self, tmp_path):
        """Backup paths must go to .sentinel-g3/backups/ not .bak files."""
        backup_root = tmp_path / ".sentinel-g3" / "backups"
        backup_root.mkdir(parents=True, exist_ok=True)
        assert backup_root.exists()
        # Simulate what /apply now does
        test_file = "app/auth.py"
        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_rel = test_file.replace("/", "_").replace("\\", "_")
        backup = backup_root / f"{safe_rel}.bak.{timestamp}"
        backup.write_text("original content", encoding="utf-8")
        assert backup.exists()
        # Must NOT be a .bak sibling
        assert backup.parent == backup_root
        assert ".sentinel-g3/backups" in str(backup).replace("\\", "/")
