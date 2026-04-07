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
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.agents.auditor import AuditorAgent
from app.agents.fixer import FixerAgent
from app.config import settings
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
limiter = Limiter(key_func=get_remote_address)

# ── Allowed Git hosts (SSRF protection) ─────────────────
_ALLOWED_GIT_HOSTS: set[str] = {"github.com", "gitlab.com", "bitbucket.org"}

# ── Path traversal guard ─────────────────────────────────

def _validate_local_path(path: Path) -> None:
    """Validate that a local directory path is within allowed scan roots.
    
    Raises ``HTTPException(403)`` if the path is outside all allowed roots.
    If ``ALLOWED_SCAN_ROOTS`` is empty, all paths are permitted (use with caution).
    """
    if not settings.ALLOWED_SCAN_ROOTS:
        return
    
    allowed_roots = [
        Path(p.strip()).resolve()
        for p in settings.ALLOWED_SCAN_ROOTS.split(";")
        if p.strip()
    ]
    
    if not allowed_roots:
        return
    
    resolved_path = path.resolve()
    
    for root in allowed_roots:
        try:
            resolved_path.relative_to(root)
            return
        except ValueError:
            continue
    
    raise HTTPException(
        status_code=403,
        detail=f"Path '{path}' is outside the allowed scan roots. "
               f"Allowed roots: {', '.join(str(r) for r in allowed_roots)}"
    )


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
    auto_apply: bool = Field(
        default=False,
        description=(
            "If True, patches are applied to disk automatically. "
            "If False (default, Incremental Healing mode), patches are generated and returned "
            "without modifying any files — the user must call POST /apply to approve each fix."
        ),
    )


class PatchItem(BaseModel):
    file_path: str = Field(description="Relative path to the file to patch.")
    new_content: str = Field(description="The patched source code to write.")

class ApplyBatchRequest(BaseModel):
    target: str = Field(description="Local dir path or remote repo URL.")
    github_token: str | None = Field(default=None)
    create_pr: bool = Field(default=False)
    patches: list[PatchItem] = Field(description="List of files to patch.")


# ── SSE helper ──────────────────────────────────────────

def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


# ── POST /fix  (On-Demand Fix Generation) ───────────────

class FixRequest(BaseModel):
    vulnerability: Vulnerability = Field(description="The vulnerability to fix.")
    original_code: str = Field(description="The original source code before the fix.", min_length=1)
    repo_root: str | None = Field(default=None, description="Repository root for context (optional).")
    
    @classmethod
    def model_validate(cls, obj: dict) -> "FixRequest":
        """Custom validation"""
        if isinstance(obj, dict):
            if not obj.get("original_code", "").strip():
                raise ValueError("original_code cannot be empty")
        return super().model_validate(obj)

@router.post("/fix")
@limiter.limit("5/minute")
async def generate_fix(request: Request, body: FixRequest):
    """Generate a security patch for a single vulnerability on-demand.
    
    This endpoint runs the Fixer agent only, without applying the patch.
    The scan (/scan) endpoint now runs audit-only by default.
    
    Returns SSE stream with:
      - `thinking` : real-time chain-of-thought chunks
      - `patch`    : final PatchResult
      - `error`    : if generation fails
    """
    # Validate input
    if not body.original_code or not body.original_code.strip():
        raise HTTPException(status_code=400, detail="original_code is required and cannot be empty")
    
    async def _stream() -> AsyncGenerator[str, None]:
        orchestrator = SentinelOrchestrator()
        fixer_thinking_parts: list[str] = []
        
        async def _on_thinking(text: str) -> None:
            fixer_thinking_parts.append(text)
            yield _sse_event("thinking", {"text": text})
        
        try:
            patch = await orchestrator.fixer.generate_patch(
                body.vulnerability,
                body.original_code,
                on_thinking=_on_thinking,
            )
            
            fixer_thought = "\n".join(fixer_thinking_parts)
            if not fixer_thought:
                fixer_thought = orchestrator.extract_full_thinking(
                    orchestrator.fixer.last_response,
                )
            
            yield _sse_event("patch", {
                "patch": patch.model_dump(),
                "fixer_thought": fixer_thought,
                "model_used": orchestrator.fixer.active_model,
            })
            
        except Exception as exc:
            logger.error("Fix generation failed: %s", exc, exc_info=True)
            yield _sse_event("error", {"message": f"Fix generation failed: {exc}"})
    
    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── POST /rollback  (Restore from Backup) ───────────────

class RollbackRequest(BaseModel):
    file_path: str = Field(description="Path to the file to rollback.", min_length=1)
    repo_root: str = Field(description="Repository root directory.", min_length=1)
    backup_timestamp: str | None = Field(
        default=None,
        description="Specific backup timestamp to restore (defaults to most recent).",
    )
    
    @classmethod
    def model_validate(cls, obj: dict) -> "RollbackRequest":
        """Custom validation"""
        if isinstance(obj, dict):
            if not obj.get("file_path", "").strip():
                raise ValueError("file_path cannot be empty")
            if not obj.get("repo_root", "").strip():
                raise ValueError("repo_root cannot be empty")
        return super().model_validate(obj)

@router.post("/rollback")
async def rollback_file(request: RollbackRequest):
    """Restore a file from its most recent .sentinel-g3/backups/ backup."""
    repo_root = Path(request.repo_root).resolve()
    _validate_local_path(repo_root)
    
    backup_dir = repo_root / ".sentinel-g3" / "backups"
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail="No backups found for this repository.")
    
    target_file = repo_root / request.file_path
    
    # Find matching backups
    relative_path = Path(request.file_path)
    backup_pattern = backup_dir / f"{relative_path}.bak.*"
    backups = sorted(backup_dir.rglob(f"{relative_path}.bak.*"), reverse=True)
    
    if not backups:
        raise HTTPException(status_code=404, detail=f"No backup found for {request.file_path}")
    
    # Use specified timestamp or most recent
    selected_backup = None
    if request.backup_timestamp:
        for backup in backups:
            if backup.suffix.lstrip(".") == request.backup_timestamp:
                selected_backup = backup
                break
        if not selected_backup:
            raise HTTPException(
                status_code=404,
                detail=f"Backup with timestamp {request.backup_timestamp} not found.",
            )
    else:
        selected_backup = backups[0]
    
    # Restore the backup
    try:
        shutil.copy2(selected_backup, target_file)
        logger.info("Restored %s from %s", target_file, selected_backup)
        return {
            "success": True,
            "message": f"Restored {request.file_path} from backup {selected_backup.suffix.lstrip('.')}",
            "backup_used": str(selected_backup),
        }
    except Exception as exc:
        logger.error("Rollback failed for %s: %s", request.file_path, exc)
        raise HTTPException(status_code=500, detail=f"Rollback failed: {exc}")


# ── POST /apply  (Incremental Healing) ──────────────────

@router.post("/apply")
async def apply_batch(request: ApplyBatchRequest):
    """Apply a batch of patches to a local or remote target.
    
    If the target is local, resolves file paths against target and overwrites.
    If the target is remote (GitHub), clones to temp dir, patches, and optionally creates a PR.
    """
    is_remote = request.target.startswith("http")
    base_dir = Path(tempfile.mkdtemp(prefix="sentinel_apply_")) if is_remote else Path(request.target).resolve()
    
    if not is_remote and not base_dir.exists():
        raise HTTPException(status_code=404, detail=f"Target directory not found: {request.target}")

    result = {"success": True, "message": f"Applied {len(request.patches)} patches"}

    try:
        from app.orchestrator import SentinelOrchestrator
        orchestrator = SentinelOrchestrator()
        
        if is_remote:
            clone_url = _validate_repo_url(request.target)
            if request.create_pr and request.github_token:
                clone_url = _make_auth_clone_url(clone_url, str(request.github_token))
            await _clone_repo_full(clone_url, base_dir)
            # configure git user for commits
            await _git(base_dir, "config", "user.name", "Sentinel-G3")
            await _git(base_dir, "config", "user.email", "bot@sentinel-g3.dev")
            
        # Apply patches
        for patch in request.patches:
            file_abs = base_dir / patch.file_path
            
            # Create backup if local and file exists
            if not is_remote and file_abs.exists():
                backup = file_abs.with_suffix(file_abs.suffix + ".bak")
                original_text = await asyncio.to_thread(file_abs.read_text, "utf-8")
                await asyncio.to_thread(backup.write_text, original_text, "utf-8")
                
            await orchestrator.fixer.apply_patch(str(file_abs), patch.new_content)
            
        # If remote and user authorized PR creation
        if is_remote and request.create_pr and request.github_token:
            owner, repo_name = _parse_owner_repo(request.target)
            branch_name = f"sentinel-g3/apply-fixes-{uuid.uuid4().hex[:8]}"

            # Create branch, stage, commit, push
            await _git(base_dir, "checkout", "-b", branch_name)
            await _git(base_dir, "add", "-A")

            commit_msg = (
                f"fix: auto-heal {len(request.patches)} security vulnerabilities\n\n"
                f"Generated by Sentinel-G3 — Powered by Google Gemini 3.\n"
            )
            await _git(base_dir, "commit", "-m", commit_msg)
            await _git(base_dir, "push", "origin", branch_name)

            # Build PR body
            pr_body = (
                f"## Sentinel-G3 — Automated Security Fixes\n"
                f"This PR was automatically generated via the Sentinel-G3 dashboard.\n\n"
                f"**Patched {len(request.patches)} file(s).**\n"
                f"---\n*Powered by Google Gemini 3*"
            )

            # Detect default branch
            default_branch = await _git(base_dir, "rev-parse", "--abbrev-ref", "origin/HEAD")
            default_branch = default_branch.replace("origin/", "")

            pr_data = await _create_github_pr(
                owner=owner,
                repo=repo_name,
                token=str(request.github_token),
                branch=branch_name,
                base=default_branch,
                title=f"fix: auto-heal {len(request.patches)} security vulnerabilities [Sentinel-G3]",
                body=pr_body,
            )
            result["pr_url"] = str(pr_data.get("html_url", ""))
            result["branch"] = str(branch_name)
            result["message"] = str(f"Created PR for {len(request.patches)} patches")
            
    except Exception as exc:
        logger.error("Failed to apply batch patch to %s: %s", request.target, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch Apply failed: {exc}")
    finally:
        if is_remote and base_dir.exists():
            shutil.rmtree(base_dir, ignore_errors=True)
            
    return result


@router.post("/scan")
@limiter.limit("3/minute")
async def run_scan(request: Request, body: ScanRequest):
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
    is_remote = bool(body.repo_url and body.repo_url.strip())
    want_pr = body.create_pr and bool(body.github_token)
    tmp_dir: Path | None = None

    if is_remote:
        try:
            clone_url = _validate_repo_url(body.repo_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if body.create_pr and not body.github_token:
            raise HTTPException(
                status_code=400,
                detail="A GitHub token is required to create a Pull Request.",
            )
        # We'll clone inside the stream so the user sees progress
        root = None  # set during stream
    else:
        if not body.directory:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'directory' or 'repo_url'.",
            )
        root = Path(body.directory).resolve()
        _validate_local_path(root)
        if not root.is_dir():
            raise HTTPException(status_code=400, detail=f"Directory not found: {root}")
        clone_url = ""

    async def _stream() -> AsyncGenerator[str, None]:
        nonlocal root, tmp_dir
        run_id = uuid.uuid4().hex[:12]
        auto_apply = body.auto_apply

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
                        clone_url, body.github_token,
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
                if auto_apply:
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
                    # Incremental Healing mode — patch NOT applied, user must approve
                    yield _sse_event("log", {
                        "message": f"    ⏳ Fix ready for review — {vuln.file_path}:{vuln.line_number} (awaiting approval)"
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
                    token=body.github_token,
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
