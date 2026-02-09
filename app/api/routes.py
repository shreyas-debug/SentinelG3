"""
Sentinel-G3 | API Routes

Exposes REST endpoints that trigger the agentic security pipeline,
including SSE streaming for real-time dashboard updates.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import urlparse

import aiohttp
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
    PatchResult,
    PipelineStatusResponse,
    Vulnerability,
)
from app.orchestrator import SentinelOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(tags=["audit"])

# ── Allowed Git hosts (SSRF protection) ─────────────────
_ALLOWED_GIT_HOSTS: set[str] = {"github.com", "gitlab.com", "bitbucket.org"}


def _validate_repo_url(url: str) -> str:
    """Validate and normalise a Git repository URL.

    Raises ``ValueError`` on disallowed schemes/hosts (SSRF protection).
    Returns a clean HTTPS clone URL.
    """
    parsed = urlparse(url.strip().rstrip("/"))

    if parsed.scheme not in ("https", ""):
        raise ValueError(f"Only HTTPS repo URLs are allowed (got {parsed.scheme!r})")

    if not parsed.scheme:
        url = f"https://{url.strip().rstrip('/')}"
        parsed = urlparse(url)

    if parsed.hostname not in _ALLOWED_GIT_HOSTS:
        raise ValueError(
            f"Host {parsed.hostname!r} is not allowed. "
            f"Supported: {', '.join(sorted(_ALLOWED_GIT_HOSTS))}"
        )

    # Strip to owner/repo (ignore tree/blob paths)
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(path_parts) < 2:
        raise ValueError("URL must include owner/repo (e.g. github.com/user/repo)")

    owner, repo = path_parts[0], path_parts[1].removesuffix(".git")
    return f"https://{parsed.hostname}/{owner}/{repo}.git"


def _parse_owner_repo(clone_url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a validated clone URL."""
    parsed = urlparse(clone_url)
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    return parts[0], parts[1].removesuffix(".git")


def _make_auth_clone_url(clone_url: str, token: str) -> str:
    """Embed a GitHub PAT into the clone URL for authenticated push.

    Never log the returned URL — it contains the token.
    """
    parsed = urlparse(clone_url)
    return f"https://x-access-token:{token}@{parsed.hostname}{parsed.path}"


# ── Git helpers (thread-based for Windows reliability) ───

def _git_sync(repo: Path, *args: str) -> str:
    """Run a git command inside *repo* (blocking) and return stdout."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    result = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {args[0]} failed (exit {result.returncode}): "
            f"{result.stderr.strip()}"
        )
    return result.stdout.strip()


async def _git(repo: Path, *args: str) -> str:
    """Run a git command inside *repo* and return stdout (async wrapper)."""
    return await asyncio.to_thread(_git_sync, repo, *args)


def _clone_sync(url: str, target: Path, *, depth: int | None = 1) -> None:
    """Clone a Git repository (blocking)."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    cmd = ["git", "clone"]
    if depth:
        cmd += ["--depth", str(depth)]
    cmd += [url, str(target)]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git clone failed (exit {result.returncode}): "
            f"{result.stderr.strip()}"
        )


async def _clone_repo(url: str, target: Path) -> None:
    """Shallow-clone a Git repository into *target* (depth=1)."""
    await asyncio.to_thread(_clone_sync, url, target, depth=1)


async def _clone_repo_full(url: str, target: Path) -> None:
    """Full clone (needed for push/branch operations)."""
    await asyncio.to_thread(_clone_sync, url, target, depth=None)


# ── GitHub API helper ────────────────────────────────────

async def _create_github_pr(
    owner: str,
    repo: str,
    token: str,
    branch: str,
    base: str,
    title: str,
    body: str,
) -> dict:
    """Create a Pull Request via the GitHub REST API.

    Returns the API response JSON with keys like ``html_url``,
    ``number``, etc.
    """
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {
        "title": title,
        "body": body,
        "head": branch,
        "base": base,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers) as resp:
            data = await resp.json()
            if resp.status not in (200, 201):
                msg = data.get("message", resp.status)
                raise RuntimeError(f"GitHub PR creation failed: {msg}")
            return data


# ── Request / Response helpers ──────────────────────────

class ScanRequest(BaseModel):
    directory: str = Field(
        default="",
        description="Local directory path to scan (mutually exclusive with repo_url).",
    )
    repo_url: str = Field(
        default="",
        description="GitHub/GitLab/Bitbucket HTTPS URL to clone and scan.",
    )
    github_token: str = Field(
        default="",
        description="GitHub Personal Access Token for pushing branches and creating PRs.",
    )
    create_pr: bool = Field(
        default=False,
        description="If True and github_token is provided, create a PR with fixes.",
    )


# ── SSE helper ──────────────────────────────────────────

def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


# ── POST /scan  (SSE streaming) ─────────────────────────

@router.post("/scan")
async def run_scan(request: ScanRequest):
    """Trigger a full self-healing cycle and stream progress via SSE.

    Accepts either a local ``directory`` or a remote ``repo_url``.
    If ``repo_url`` is given, the repository is shallow-cloned into a
    temporary directory, scanned, and the temp directory is cleaned up
    after the cycle finishes.

    The response is a `text/event-stream` that emits:
      - `log`     : real-time log lines
      - `vuln`    : each vulnerability as it is found
      - `patch`   : each patch result as it is applied
      - `summary` : final HealingCycleSummary when done
      - `error`   : if something goes wrong
    """
    # ── Resolve scan target ──────────────────────────────
    is_remote = bool(request.repo_url and request.repo_url.strip())
    want_pr = request.create_pr and bool(request.github_token)
    tmp_dir: Path | None = None

    if is_remote:
        try:
            clone_url = _validate_repo_url(request.repo_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if request.create_pr and not request.github_token:
            raise HTTPException(
                status_code=400,
                detail="A GitHub token is required to create a Pull Request.",
            )
        # We'll clone inside the stream so the user sees progress
        root = None  # set during stream
    else:
        if not request.directory:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'directory' or 'repo_url'.",
            )
        root = Path(request.directory).resolve()
        if not root.is_dir():
            raise HTTPException(status_code=400, detail=f"Directory not found: {root}")
        clone_url = ""

    async def _stream() -> AsyncGenerator[str, None]:
        nonlocal root, tmp_dir
        run_id = uuid.uuid4().hex[:12]

        # ── Clone if remote ──────────────────────────────
        if is_remote:
            yield _sse_event("log", {
                "message": f"[{run_id}] Cloning {clone_url} …"
            })
            try:
                parent = Path(tempfile.mkdtemp(prefix="sentinel_"))
                clone_dest = parent / "repo"
                if want_pr:
                    # Full clone with auth (needed for branch + push)
                    auth_url = _make_auth_clone_url(
                        clone_url, request.github_token,
                    )
                    await _clone_repo_full(auth_url, clone_dest)
                else:
                    await _clone_repo(clone_url, clone_dest)
                tmp_dir = parent          # track parent for cleanup
                root = clone_dest         # actual repo root
                yield _sse_event("log", {
                    "message": f"  ✓ Cloned into temp directory"
                })
            except Exception as exc:
                logger.error("Clone failed: %s", exc, exc_info=True)
                yield _sse_event("error", {
                    "message": f"Clone failed: {type(exc).__name__}: {exc}"
                })
                if tmp_dir and tmp_dir.exists():
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                return

        assert root is not None

        yield _sse_event("log", {"message": f"[{run_id}] Healing cycle started for {root}"})

        orchestrator = SentinelOrchestrator()

        # ── Stage 1: Audit ──────────────────────────────
        yield _sse_event("log", {"message": "▶ Stage 1 — Auditing repository…"})

        try:
            audit_result = await orchestrator.auditor.analyze_repository(str(root))
        except Exception as exc:
            yield _sse_event("error", {"message": f"Audit failed: {exc}"})
            return

        # Capture the auditor's chain-of-thought accumulated across all files
        auditor_thought = orchestrator.auditor.accumulated_thinking
        if not auditor_thought:
            # Fallback: try extracting from the last response
            auditor_thought = orchestrator.extract_full_thinking(
                orchestrator.auditor.last_response,
            )
        logger.info(
            "Auditor thinking captured: %d chars",
            len(auditor_thought),
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

        _SENTINEL = object()  # signals "fixer task done"

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
                yield _sse_event("log", {
                    "message": f"    ✗ Not patched — {vuln.file_path}:{vuln.line_number} (could not read file)"
                })
                skip_entry = {
                    "vulnerability": vuln.model_dump(),
                    "patch": {"file_path": vuln.file_path, "success": False, "message": str(exc),
                              "original_code": "", "fixed_code": ""},
                    "healed": False,
                }
                entries.append(skip_entry)
                yield _sse_event("patch", skip_entry)
                continue

            # ── Stream thinking in real-time ──────────────
            thinking_queue: asyncio.Queue = asyncio.Queue()
            fixer_thinking_parts: list[str] = []

            async def _on_thinking(text: str) -> None:
                fixer_thinking_parts.append(text)
                await thinking_queue.put(text)

            async def _run_fixer() -> PatchResult:
                result = await orchestrator.fixer.generate_patch(
                    vuln, original_code, on_thinking=_on_thinking,
                )
                await thinking_queue.put(_SENTINEL)
                return result

            fixer_task = asyncio.create_task(_run_fixer())

            # Drain thinking chunks into SSE events while fixer runs
            while True:
                item = await thinking_queue.get()
                if item is _SENTINEL:
                    break
                yield _sse_event("thinking", {
                    "text": item,
                    "index": idx,
                    "file": vuln.file_path,
                })

            patch = await fixer_task

            # Build fixer thought from streamed parts, or fall back
            fixer_thought = "\n".join(fixer_thinking_parts)
            if not fixer_thought:
                fixer_thought = orchestrator.extract_full_thinking(
                    orchestrator.fixer.last_response,
                )

            healed = False
            if patch.success and patch.fixed_code:
                try:
                    await orchestrator.fixer.apply_patch(str(file_abs), patch.fixed_code)
                    healed = True
                    healed_count += 1
                    yield _sse_event("log", {
                        "message": f"    ✓ Patched {vuln.file_path}:{vuln.line_number} ({vuln.severity})"
                    })
                except Exception as exc:
                    yield _sse_event("log", {
                        "message": f"    ✗ Not patched — {vuln.file_path}:{vuln.line_number} (apply failed: {exc})"
                    })
            else:
                yield _sse_event("log", {
                    "message": f"    ✗ Not patched — {vuln.file_path}:{vuln.line_number} (no fix generated)"
                })

            entry = {
                "vulnerability": vuln.model_dump(),
                "patch": patch.model_dump(),
                "healed": healed,
                "auditor_thought": auditor_thought,
                "fixer_thought": fixer_thought,
                "model_used": orchestrator.fixer.active_model,
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

        # ── Stage 3: Create PR (if requested) ────────────
        if want_pr and is_remote and healed_count > 0:
            yield _sse_event("log", {
                "message": "▶ Stage 3 — Creating Pull Request…"
            })
            try:
                owner, repo_name = _parse_owner_repo(clone_url)
                branch_name = f"sentinel-g3/fix-{run_id}"

                # Create branch, stage, commit, push
                await _git(root, "checkout", "-b", branch_name)
                await _git(root, "add", "-A")

                # Build commit message
                files_fixed = set()
                for e in entries:
                    if e.get("healed"):
                        files_fixed.add(e["vulnerability"]["file_path"])
                commit_msg = (
                    f"fix: auto-heal {healed_count} security vulnerabilities\n\n"
                    f"Sentinel-G3 detected {len(audit_result.vulnerabilities)} "
                    f"vulnerability(ies) across {audit_result.scanned_files} file(s) "
                    f"and successfully patched {healed_count}.\n\n"
                    f"Files modified:\n"
                    + "\n".join(f"  - {f}" for f in sorted(files_fixed))
                )
                await _git(root, "commit", "-m", commit_msg)
                yield _sse_event("log", {
                    "message": f"  ✓ Committed fixes on branch {branch_name}"
                })

                await _git(root, "push", "origin", branch_name)
                yield _sse_event("log", {
                    "message": f"  ✓ Pushed branch {branch_name}"
                })

                # Build PR body
                pr_body_lines = [
                    "## Sentinel-G3 — Automated Security Fixes\n",
                    f"**Run ID:** `{run_id}`\n",
                    f"| Metric | Count |",
                    f"|--------|-------|",
                    f"| Files scanned | {audit_result.scanned_files} |",
                    f"| Vulnerabilities found | {len(audit_result.vulnerabilities)} |",
                    f"| Vulnerabilities healed | {healed_count} |\n",
                    "### Fixes applied\n",
                ]
                for e in entries:
                    v = e["vulnerability"]
                    status = "Patched" if e.get("healed") else "Skipped"
                    pr_body_lines.append(
                        f"- **{v['file_path']}:{v['line_number']}** "
                        f"({v['severity']}) — {v['issue'][:100]} [{status}]"
                    )
                pr_body_lines.append(
                    "\n---\n*Generated by [Sentinel-G3]"
                    "(https://github.com/sentinel-g3) — "
                    "Powered by Google Gemini 3*"
                )
                pr_body = "\n".join(pr_body_lines)

                # Detect default branch
                default_branch = await _git(
                    root, "rev-parse", "--abbrev-ref", "origin/HEAD",
                )
                default_branch = default_branch.replace("origin/", "")

                pr_data = await _create_github_pr(
                    owner=owner,
                    repo=repo_name,
                    token=request.github_token,
                    branch=branch_name,
                    base=default_branch,
                    title=f"fix: auto-heal {healed_count} security vulnerabilities [Sentinel-G3]",
                    body=pr_body,
                )
                pr_url = pr_data.get("html_url", "")
                yield _sse_event("pr", {
                    "url": pr_url,
                    "number": pr_data.get("number"),
                    "branch": branch_name,
                })
                yield _sse_event("log", {
                    "message": f"  ✓ Pull Request created: {pr_url}"
                })
            except Exception as exc:
                logger.error("PR creation failed: %s", exc, exc_info=True)
                yield _sse_event("log", {
                    "message": f"  ✗ PR creation failed: {exc}"
                })
        elif want_pr and healed_count == 0:
            yield _sse_event("log", {
                "message": "  ⏭ Skipping PR — no vulnerabilities were healed."
            })

        # ── Cleanup temp clone ───────────────────────────
        if tmp_dir and tmp_dir.exists():
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                yield _sse_event("log", {"message": "  Cleaned up temporary clone."})
            except Exception:
                pass

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
