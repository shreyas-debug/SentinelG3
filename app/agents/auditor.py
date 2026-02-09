"""
Sentinel-G3 | Auditor Agent

Scans .py and .js source files for security vulnerabilities using
Gemini 3 Pro with thinking_level=HIGH via the google-genai AsyncClient.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from google.genai.errors import ClientError

from app.agents.base import BaseAgent
from app.models.schemas import AuditResult, Vulnerability

logger = logging.getLogger(__name__)

# Extensions the auditor cares about
_TARGET_EXTENSIONS: set[str] = {".py", ".js"}

# Directories to always skip
_SKIP_DIRS: set[str] = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".tox", ".mypy_cache", "dist", "build",
}

# Max file size to read (256 KB)
_MAX_FILE_BYTES: int = 256 * 1024

_SYSTEM_INSTRUCTION: str = """\
You are an elite security researcher performing a comprehensive code audit.
Analyse the provided source file and identify ALL security vulnerabilities,
including subtle logic flaws, injection vectors, authentication bypasses,
cryptographic weaknesses, and misconfigurations.

For each vulnerability return a JSON object with exactly these fields:
  - severity       (str): critical | high | medium | low | info
  - issue          (str): detailed technical description of the vulnerability,
                          exploit scenario, and impact
  - file_path      (str): the relative file path provided to you
  - line_number    (int): exact line number of the vulnerability
  - fix_suggestion (str): concise, actionable remediation

Return ONLY a valid JSON array of objects. If the file is clean, return [].
"""


class AuditorAgent(BaseAgent):
    """Stage 1 – Identify security vulnerabilities in the target codebase."""

    def __init__(self) -> None:
        super().__init__()
        # Accumulate thinking text from every file scanned so the dashboard
        # can show the full chain-of-thought, not just the last file.
        self._accumulated_thinking: list[str] = []

    @property
    def accumulated_thinking(self) -> str:
        """Return the concatenated thinking from all audited files."""
        return "\n\n".join(t for t in self._accumulated_thinking if t)

    # ── Pipeline entry-point ────────────────────────────────

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Pipeline-compatible wrapper around ``analyze_repository``."""
        directory: str = context.get("directory", ".")
        result = await self.analyze_repository(directory)
        return result.model_dump()

    # ── Core public method ──────────────────────────────────

    async def analyze_repository(self, repo_path: str) -> AuditResult:
        """Scan all ``.py`` and ``.js`` files under *repo_path*.

        Files are sent to Gemini 3 Pro concurrently via ``asyncio.gather``.
        Each file gets its own ``generate_content`` call so individual
        results stay focused and within context-window limits.
        """
        root = Path(repo_path).resolve()
        if not root.is_dir():
            raise FileNotFoundError(f"Directory not found: {root}")

        # 1. Collect target source files ─────────────────────
        files = self._collect_files(root)

        if not files:
            logger.warning("No .py / .js files found in %s", root)
            return AuditResult(
                vulnerabilities=[],
                scanned_files=0,
                repository_path=str(root),
            )

        logger.info(
            "Auditing %d file(s) under %s …", len(files), root,
        )

        # 2. Sequential scan with 1 s delay to respect RPM limits ──
        results: list[list[Vulnerability]] = []
        for idx, (rel_path, content) in enumerate(files.items()):
            if idx > 0:
                await asyncio.sleep(1)          # stay under free-tier RPM
            vulns = await self._audit_single_file(rel_path, content)
            results.append(vulns)

        # 3. Flatten & return ────────────────────────────────
        all_vulns: list[Vulnerability] = [
            v for file_vulns in results for v in file_vulns
        ]

        logger.info(
            "Audit complete — %d vulnerability(ies) across %d file(s).",
            len(all_vulns), len(files),
        )

        return AuditResult(
            vulnerabilities=all_vulns,
            scanned_files=len(files),
            repository_path=str(root),
        )

    # ── Private: single-file audit via Gemini ───────────────

    # Retry settings
    _MAX_RETRIES: int = 3
    _BASE_DELAY: float = 2.0          # exponential backoff: 2 s, 4 s, 8 s

    async def _audit_single_file(
        self,
        rel_path: str,
        content: str,
    ) -> list[Vulnerability]:
        """Send one source file to Gemini and return findings.

        Retries up to ``_MAX_RETRIES`` times on ``ResourceExhausted`` (429)
        with exponential back-off (2 s → 4 s → 8 s).  If all retries fail
        and a fallback model is configured, switches to it and retries once.
        """
        numbered = "\n".join(
            f"{i}: {line}"
            for i, line in enumerate(content.splitlines(), start=1)
        )
        prompt = (
            f"## File: `{rel_path}`\n"
            f"```\n{numbered}\n```\n\n"
            "Analyse this file for security vulnerabilities."
        )

        result = await self._call_with_fallback(rel_path, prompt)
        return result

    async def _call_with_fallback(
        self,
        rel_path: str,
        prompt: str,
    ) -> list[Vulnerability]:
        """Try primary model, fall back on quota exhaustion."""
        last_exc: Exception | None = None

        for attempt in range(1, self._MAX_RETRIES + 1):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.active_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_SYSTEM_INSTRUCTION,
                        thinking_config=types.ThinkingConfig(
                            thinking_level="HIGH",
                            include_thoughts=True,
                        ),
                        response_mime_type="application/json",
                        response_schema=list[Vulnerability],
                    ),
                )
                self.last_response = response

                # Accumulate thinking from this file's response
                self._accumulate_thinking(response, rel_path)

                return self._parse_response(response, rel_path)

            except ClientError as exc:
                if exc.code != 429:
                    logger.error("Gemini call failed for %s: %s", rel_path, exc)
                    return []

                last_exc = exc
                delay = self._BASE_DELAY * (2 ** (attempt - 1))  # 2, 4, 8
                logger.warning(
                    "429 rate-limited on %s (attempt %d/%d, model=%s). "
                    "Retrying in %.1f s …",
                    rel_path, attempt, self._MAX_RETRIES,
                    self.active_model, delay,
                )
                await asyncio.sleep(delay)

            except Exception as exc:
                logger.error("Gemini call failed for %s: %s", rel_path, exc)
                return []

        # All retries exhausted — try fallback model if available
        if self.switch_to_fallback():
            logger.info(
                "Retrying %s with fallback model %s …",
                rel_path, self.active_model,
            )
            return await self._call_with_fallback(rel_path, prompt)

        logger.error(
            "All retries exhausted for %s: %s",
            rel_path, last_exc,
        )
        return []

    # ── Private: accumulate thinking ─────────────────────────

    def _accumulate_thinking(self, response: Any, rel_path: str) -> None:
        """Extract thinking parts from a response and append to the buffer."""
        if not response or not getattr(response, "candidates", None):
            return

        parts: list[str] = []
        for candidate in response.candidates:
            if not candidate.content or not candidate.content.parts:
                continue
            for part in candidate.content.parts:
                is_thought = getattr(part, "thought", False)
                text = getattr(part, "text", "") or ""
                if is_thought and text:
                    parts.append(text)

        if parts:
            header = f"── {rel_path} ──"
            self._accumulated_thinking.append(f"{header}\n" + "\n".join(parts))
            logger.info(
                "Accumulated %d thinking part(s) from %s (%d chars)",
                len(parts), rel_path,
                sum(len(p) for p in parts),
            )
        else:
            logger.debug("No thinking parts found in response for %s", rel_path)

    # ── Private: file collection ────────────────────────────

    @staticmethod
    def _collect_files(root: Path) -> dict[str, str]:
        """Return ``{relative_posix_path: text}`` for .py and .js files."""
        collected: dict[str, str] = {}

        for path in sorted(root.rglob("*")):
            if path.is_dir():
                continue

            # Only .py and .js
            if path.suffix.lower() not in _TARGET_EXTENSIONS:
                continue

            # Skip excluded directory trees
            rel_parts = path.relative_to(root).parts
            if any(part in _SKIP_DIRS for part in rel_parts):
                continue

            # Skip oversized files
            try:
                if path.stat().st_size > _MAX_FILE_BYTES:
                    logger.debug("Skipping large file: %s", path)
                    continue
            except OSError:
                continue

            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            rel = str(path.relative_to(root)).replace("\\", "/")
            collected[rel] = text

        return collected

    # ── Private: response parsing ───────────────────────────

    @staticmethod
    def _parse_response(
        response: Any,
        fallback_path: str,
    ) -> list[Vulnerability]:
        """Parse the JSON array returned by Gemini into Vulnerability models."""
        try:
            raw = json.loads(response.text)
        except (json.JSONDecodeError, AttributeError, ValueError) as exc:
            logger.error(
                "Failed to parse Gemini JSON for %s: %s", fallback_path, exc,
            )
            return []

        if not isinstance(raw, list):
            raw = [raw]

        vulns: list[Vulnerability] = []
        for item in raw:
            # Ensure file_path is present even if Gemini omits it
            if isinstance(item, dict):
                item.setdefault("file_path", fallback_path)
            try:
                vulns.append(Vulnerability.model_validate(item))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Skipping malformed finding: %s — %s", item, exc)

        return vulns
