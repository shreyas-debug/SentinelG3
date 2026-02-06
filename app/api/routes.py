"""
Sentinel-G3 | API Routes

Exposes REST endpoints that trigger the agentic security pipeline,
including SSE streaming for real-time dashboard updates.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.auditor import AuditorAgent
from app.agents.fixer import FixerAgent
from app.models.schemas import (
    AuditRequest,
    AuditResponse,
    Finding,
    HealingCycleSummary,
    PipelineStatusResponse,
    Vulnerability,
)
from app.orchestrator import SentinelOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(tags=["audit"])


# ── Request / Response helpers ──────────────────────────

class ScanRequest(BaseModel):
    directory: str = Field(description="Local directory path to scan.")


# ── SSE helper ──────────────────────────────────────────

def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


# ── POST /scan  (SSE streaming) ─────────────────────────

@router.post("/scan")
async def run_scan(request: ScanRequest):
    """Trigger a full self-healing cycle and stream progress via SSE.

    The response is a `text/event-stream` that emits:
      - `log`     : real-time log lines
      - `vuln`    : each vulnerability as it is found
      - `patch`   : each patch result as it is applied
      - `summary` : final HealingCycleSummary when done
      - `error`   : if something goes wrong
    """
    root = Path(request.directory).resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory not found: {root}")

    async def _stream() -> AsyncGenerator[str, None]:
        run_id = uuid.uuid4().hex[:12]

        yield _sse_event("log", {"message": f"[{run_id}] Healing cycle started for {root}"})

        orchestrator = SentinelOrchestrator()

        # ── Stage 1: Audit ──────────────────────────────
        yield _sse_event("log", {"message": "▶ Stage 1 — Auditing repository…"})

        try:
            audit_result = await orchestrator.auditor.analyze_repository(str(root))
        except Exception as exc:
            yield _sse_event("error", {"message": f"Audit failed: {exc}"})
            return

        # Capture the auditor's chain-of-thought from its last response
        auditor_thought = orchestrator.extract_full_thinking(
            orchestrator.auditor.last_response,
        )

        yield _sse_event("log", {
            "message": f"  Found {len(audit_result.vulnerabilities)} vulnerability(ies) "
                       f"across {audit_result.scanned_files} file(s)."
        })

        for vuln in audit_result.vulnerabilities:
            yield _sse_event("vuln", vuln.model_dump())

        if not audit_result.vulnerabilities:
            yield _sse_event("summary", HealingCycleSummary(
                run_id=run_id,
                repository_path=str(root),
                scanned_files=audit_result.scanned_files,
                vulnerabilities_found=0,
                vulnerabilities_healed=0,
                entries=[],
            ).model_dump())
            return

        # ── Stage 2: Fix ────────────────────────────────
        yield _sse_event("log", {"message": "▶ Stage 2 — Generating patches…"})

        healed_count = 0
        entries = []

        for idx, vuln in enumerate(audit_result.vulnerabilities):
            if idx > 0:
                await asyncio.sleep(1)

            yield _sse_event("log", {
                "message": f"  [{idx+1}/{len(audit_result.vulnerabilities)}] "
                           f"Fixing {vuln.file_path}:{vuln.line_number} ({vuln.severity})"
            })

            # Read file
            file_abs = root / vuln.file_path
            try:
                original_code = file_abs.read_text(encoding="utf-8")
            except OSError as exc:
                yield _sse_event("log", {"message": f"    ✗ Cannot read file: {exc}"})
                entries.append({
                    "vulnerability": vuln.model_dump(),
                    "patch": {"file_path": vuln.file_path, "success": False, "message": str(exc),
                              "original_code": "", "fixed_code": ""},
                    "healed": False,
                })
                continue

            # Generate patch
            patch = await orchestrator.fixer.generate_patch(vuln, original_code)

            # Extract the fixer's full chain-of-thought
            fixer_thought = orchestrator.extract_full_thinking(
                orchestrator.fixer.last_response,
            )

            healed = False
            if patch.success and patch.fixed_code:
                try:
                    await orchestrator.fixer.apply_patch(str(file_abs), patch.fixed_code)
                    healed = True
                    healed_count += 1
                    yield _sse_event("log", {"message": f"    ✓ Patched {vuln.file_path}"})
                except Exception as exc:
                    yield _sse_event("log", {"message": f"    ✗ Apply failed: {exc}"})
            else:
                yield _sse_event("log", {"message": f"    ✗ No patch generated"})

            entry = {
                "vulnerability": vuln.model_dump(),
                "patch": patch.model_dump(),
                "healed": healed,
                "auditor_thought": auditor_thought,
                "fixer_thought": fixer_thought,
            }
            entries.append(entry)

            yield _sse_event("patch", entry)

        # ── Write manifest ──────────────────────────────
        summary = HealingCycleSummary(
            run_id=run_id,
            repository_path=str(root),
            scanned_files=audit_result.scanned_files,
            vulnerabilities_found=len(audit_result.vulnerabilities),
            vulnerabilities_healed=healed_count,
            entries=[],  # entries are streamed individually
        )

        # Write manifest to disk
        try:
            await orchestrator._write_manifest(
                root, run_id, entries, summary,
            )
        except Exception:
            pass

        yield _sse_event("summary", {
            **summary.model_dump(),
            "entries": entries,
        })

        yield _sse_event("log", {
            "message": f"═══ Cycle {run_id} complete — "
                       f"{len(audit_result.vulnerabilities)} found, {healed_count} healed ═══"
        })

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── GET /history ────────────────────────────────────────

@router.get("/history")
async def get_history(directory: str = Query(..., description="Repo root path")):
    """Return the run_manifest.json for a given repo directory."""
    manifest_path = Path(directory).resolve() / "run_manifest.json"
    if not manifest_path.exists():
        return {"runs": []}

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read manifest: {exc}")


# ── Legacy endpoints ────────────────────────────────────

@router.post("/audit", response_model=AuditResponse)
async def run_audit(request: AuditRequest):
    """Kick off the Auditor agent on a local directory."""
    if not request.directory:
        raise HTTPException(
            status_code=400,
            detail="A 'directory' path is required for local audits.",
        )

    auditor = AuditorAgent()
    result = await auditor.analyze_repository(request.directory)

    run_id = uuid.uuid4().hex[:12]

    findings = [
        Finding(
            id=f"VULN-{idx:03d}",
            severity=v.severity,
            title=v.issue[:120],
            description=v.issue,
            file=v.file_path,
            line=v.line_number,
            suggested_fix=v.fix_suggestion,
        )
        for idx, v in enumerate(result.vulnerabilities, start=1)
    ]

    return AuditResponse(
        run_id=run_id,
        status="completed",
        findings=findings,
        scanned_files=result.scanned_files,
    )


@router.get("/audit/{run_id}", response_model=PipelineStatusResponse)
async def get_audit_status(run_id: str):
    """Poll the status of a running audit pipeline."""
    return PipelineStatusResponse(
        run_id=run_id,
        stage="not_started",
        message="Pipeline orchestration not yet implemented.",
    )
