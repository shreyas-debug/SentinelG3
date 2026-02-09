"""
Sentinel-G3 | Orchestrator

Coordinates the full self-healing security cycle:
    Auditor  →  Fixer  →  apply patch
and persists a ``run_manifest.json`` audit trail that includes Gemini 3's
``thought_signature`` from every agent call.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types
from google.genai.errors import ClientError

from app.agents.auditor import AuditorAgent
from app.agents.fixer import FixerAgent
from app.models.schemas import (
    HealingCycleSummary,
    HealingEntry,
    PatchResult,
    Vulnerability,
)

logger = logging.getLogger(__name__)

# Retry settings for the raw Gemini calls made by auditor/fixer
# (re-used when we need to capture the full response ourselves)
_MAX_RETRIES: int = 3
_BASE_DELAY: float = 2.0


class SentinelOrchestrator:
    """Coordinates the Auditor → Fixer self-healing pipeline."""

    def __init__(self) -> None:
        self.auditor = AuditorAgent()
        self.fixer = FixerAgent()

    # ── Main entry-point ────────────────────────────────────

    async def run_self_healing_cycle(
        self,
        repo_path: str,
    ) -> HealingCycleSummary:
        """Execute a full Audit → Fix cycle on *repo_path*.

        1. Runs the AuditorAgent to discover vulnerabilities.
        2. For each finding, reads the original file and generates a patch.
        3. Applies the patch (with backup) and records the outcome.
        4. Writes ``run_manifest.json`` with thought_signatures for every
           Gemini call (hackathon audit trail).

        Returns:
            A ``HealingCycleSummary`` with counts and per-vuln details.
        """
        root = Path(repo_path).resolve()
        run_id = uuid.uuid4().hex[:12]
        manifest: list[dict[str, Any]] = []

        logger.info("═══ Sentinel-G3 healing cycle %s started ═══", run_id)

        # ── Stage 1: Audit ──────────────────────────────────
        logger.info("▶ Stage 1 — Auditor scanning %s …", root)
        audit_result = await self.auditor.analyze_repository(str(root))

        # Capture auditor thought signatures from a mirrored call
        # (the auditor already made the call; we re-extract signatures
        #  by inspecting the auditor's last response if possible,
        #  or by noting them in the manifest as "collected-at-agent-level")
        # For a clean approach we re-run a lightweight probe per file
        # — but to avoid burning tokens we'll collect signatures during
        #   the fixer stage which we fully control here.

        vulns = audit_result.vulnerabilities
        logger.info(
            "  Auditor found %d vulnerability(ies) across %d file(s).",
            len(vulns), audit_result.scanned_files,
        )

        if not vulns:
            summary = HealingCycleSummary(
                run_id=run_id,
                repository_path=str(root),
                scanned_files=audit_result.scanned_files,
                vulnerabilities_found=0,
                vulnerabilities_healed=0,
                entries=[],
            )
            await self._write_manifest(root, run_id, manifest, summary)
            return summary

        # ── Stage 2: Fix each vulnerability ─────────────────
        logger.info("▶ Stage 2 — Fixer generating patches …")

        entries: list[HealingEntry] = []
        healed_count = 0

        for idx, vuln in enumerate(vulns):
            if idx > 0:
                await asyncio.sleep(1)  # RPM pacing

            logger.info(
                "  [%d/%d] Fixing %s:%d (%s) — %s",
                idx + 1, len(vulns),
                vuln.file_path, vuln.line_number,
                vuln.severity, vuln.issue[:80],
            )

            # Read the current file contents
            file_abs = root / vuln.file_path
            try:
                original_code = await asyncio.to_thread(
                    file_abs.read_text, "utf-8",
                )
            except OSError as exc:
                logger.error("Cannot read %s: %s", file_abs, exc)
                entries.append(HealingEntry(
                    vulnerability=vuln,
                    patch=PatchResult(
                        file_path=vuln.file_path,
                        original_code="",
                        fixed_code="",
                        success=False,
                        message=f"File read error: {exc}",
                    ),
                    healed=False,
                ))
                continue

            # Generate the patch (fixer has its own retry logic)
            patch = await self.fixer.generate_patch(vuln, original_code)

            # Apply patch if generation succeeded
            if patch.success and patch.fixed_code:
                try:
                    await self.fixer.apply_patch(str(file_abs), patch.fixed_code)
                    healed = True
                    healed_count += 1
                    logger.info("    ✓ Patched %s", vuln.file_path)
                except Exception as exc:
                    healed = False
                    patch.message += f" | Apply failed: {exc}"
                    logger.error("    ✗ Apply failed for %s: %s", vuln.file_path, exc)
            else:
                healed = False
                logger.warning("    ✗ No patch for %s", vuln.file_path)

            entries.append(HealingEntry(
                vulnerability=vuln,
                patch=patch,
                healed=healed,
            ))

            # Collect thought signatures from agent responses
            fixer_sigs: list[dict[str, Any]] = []
            if self.fixer.last_response:
                fixer_sigs = self.extract_thought_signatures(
                    self.fixer.last_response,
                )

            auditor_sigs: list[dict[str, Any]] = []
            if self.auditor.last_response:
                auditor_sigs = self.extract_thought_signatures(
                    self.auditor.last_response,
                )

            manifest.append(
                self._build_manifest_entry(
                    stage="fixer",
                    vuln=vuln,
                    healed=healed,
                    patch=patch,
                    auditor_thought_signatures=auditor_sigs,
                    fixer_thought_signatures=fixer_sigs,
                )
            )

        # ── Compose summary ─────────────────────────────────
        summary = HealingCycleSummary(
            run_id=run_id,
            repository_path=str(root),
            scanned_files=audit_result.scanned_files,
            vulnerabilities_found=len(vulns),
            vulnerabilities_healed=healed_count,
            entries=entries,
        )

        await self._write_manifest(root, run_id, manifest, summary)

        logger.info(
            "═══ Cycle %s complete — %d found, %d healed ═══",
            run_id, len(vulns), healed_count,
        )

        return summary

    # ── Thought extraction ─────────────────────────────────

    @staticmethod
    def extract_thought_signatures(
        response: types.GenerateContentResponse,
    ) -> list[dict[str, Any]]:
        """Pull ``thought_signature`` blobs from a Gemini response.

        Returns a list of dicts with ``thought_text`` (truncated for manifest)
        and ``thought_signature`` (base64-encoded bytes).
        """
        signatures: list[dict[str, Any]] = []

        if not response.candidates:
            return signatures

        for candidate in response.candidates:
            if not candidate.content or not candidate.content.parts:
                continue
            for part in candidate.content.parts:
                if part.thought and part.thought_signature:
                    signatures.append({
                        "thought_text": (part.text or "")[:500],
                        "thought_signature": base64.b64encode(
                            part.thought_signature
                        ).decode("ascii"),
                    })

        return signatures

    @staticmethod
    def extract_full_thinking(
        response: types.GenerateContentResponse | None,
    ) -> str:
        """Extract the complete chain-of-thought text from a Gemini response.

        Concatenates all ``thought`` parts into a single string — this is
        the raw reasoning the model used before producing its answer.
        Returned **untruncated** so the dashboard can display the full CoT.
        """
        if not response or not response.candidates:
            logger.debug("extract_full_thinking: no response or no candidates")
            return ""

        parts: list[str] = []
        total_parts = 0

        for candidate in response.candidates:
            if not candidate.content or not candidate.content.parts:
                continue
            for part in candidate.content.parts:
                total_parts += 1
                is_thought = getattr(part, "thought", False)
                text = getattr(part, "text", "") or ""
                logger.debug(
                    "  part: thought=%r, text_len=%d, has_signature=%r",
                    is_thought,
                    len(text),
                    bool(getattr(part, "thought_signature", None)),
                )
                if is_thought and text:
                    parts.append(text)

        result = "\n".join(parts)
        logger.info(
            "extract_full_thinking: %d thinking parts found out of %d total parts "
            "(result length: %d chars)",
            len(parts), total_parts, len(result),
        )
        return result

    # ── Manifest helpers ────────────────────────────────────

    @staticmethod
    def _build_manifest_entry(
        *,
        stage: str,
        vuln: Vulnerability,
        healed: bool,
        patch: PatchResult,
        auditor_thought_signatures: list[dict[str, Any]] | None = None,
        fixer_thought_signatures: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Build one manifest record for a fix attempt."""
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "file_path": vuln.file_path,
            "line_number": vuln.line_number,
            "severity": vuln.severity,
            "issue": vuln.issue,
            "healed": healed,
            "patch_message": patch.message,
            "thought_signatures": {
                "auditor": auditor_thought_signatures or [],
                "fixer": fixer_thought_signatures or [],
            },
        }

    @staticmethod
    async def _write_manifest(
        root: Path,
        run_id: str,
        manifest_entries: list[dict[str, Any]],
        summary: HealingCycleSummary,
    ) -> None:
        """Persist ``run_manifest.json`` to the repo root."""
        manifest = {
            "sentinel_g3_version": "0.1.0",
            "run_id": run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "repository": str(root),
            "summary": {
                "scanned_files": summary.scanned_files,
                "vulnerabilities_found": summary.vulnerabilities_found,
                "vulnerabilities_healed": summary.vulnerabilities_healed,
            },
            "entries": manifest_entries,
        }

        manifest_path = root / "run_manifest.json"

        def _write() -> None:
            manifest_path.write_text(
                json.dumps(manifest, indent=2, default=str),
                encoding="utf-8",
            )

        await asyncio.to_thread(_write)
        logger.info("Manifest written → %s", manifest_path)
