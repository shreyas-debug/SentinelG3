"""
Sentinel-G3 | Fixer Agent

Receives vulnerability findings from the Auditor and generates
remediation patches using Gemini 3 Pro with thinking_level=HIGH.
Writes the fixed code back to disk asynchronously.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types
from google.genai.errors import ClientError

from app.agents.base import BaseAgent
from app.models.schemas import PatchResult, Vulnerability

logger = logging.getLogger(__name__)

_SYSTEM_INSTRUCTION: str = (
    "You are a Senior Security Engineer. "
    "You will be given a vulnerability report and the original source code. "
    "Rewrite the code to fix the vulnerability while maintaining the original "
    "functionality. Return ONLY the fixed code block — no markdown fences, "
    "no explanations, no commentary."
)

# Retry settings (mirrors AuditorAgent)
_MAX_RETRIES: int = 3
_BASE_DELAY: float = 2.0  # exponential back-off: 2 s, 4 s, 8 s


class FixerAgent(BaseAgent):
    """Stage 2 – Generate and apply security patches for discovered vulns."""

    # ── Pipeline entry-point ────────────────────────────────

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Pipeline-compatible wrapper.

        Expects context keys:
            vulnerability  – a Vulnerability dict or model
            original_code  – the full source text of the file
            repo_root      – (optional) absolute path to the repo root
        """
        vuln = Vulnerability.model_validate(context["vulnerability"])
        original_code: str = context["original_code"]
        repo_root: str = context.get("repo_root", ".")

        patch = await self.generate_patch(vuln, original_code)

        if patch.fixed_code:
            target = str(Path(repo_root).resolve() / vuln.file_path)
            await self.apply_patch(target, patch.fixed_code)

        return patch.model_dump()

    # ── Core: generate a patch via Gemini ───────────────────

    async def generate_patch(
        self,
        vulnerability: Vulnerability,
        original_code: str,
    ) -> PatchResult:
        """Ask Gemini 3 Pro to produce a fixed version of the source file.

        Args:
            vulnerability: The finding from the Auditor agent.
            original_code: The full source text of the vulnerable file.

        Returns:
            A ``PatchResult`` containing the fixed code (or an error message).
        """
        prompt = (
            f"You are a Senior Security Engineer. "
            f"Analyze this vulnerability: {vulnerability.issue}. "
            f"Rewrite the code to fix this while maintaining the original "
            f"functionality. Return ONLY the fixed code block.\n\n"
            f"### Vulnerability details\n"
            f"- **File:** `{vulnerability.file_path}`\n"
            f"- **Line:** {vulnerability.line_number}\n"
            f"- **Severity:** {vulnerability.severity}\n"
            f"- **Suggested fix:** {vulnerability.fix_suggestion}\n\n"
            f"### Original code\n"
            f"```\n{original_code}\n```"
        )

        last_exc: Exception | None = None

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                response = await self.client.aio.models.generate_content(
                    model="gemini-3-pro-preview",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_SYSTEM_INSTRUCTION,
                        thinking_config=types.ThinkingConfig(
                            thinking_level="HIGH",
                        ),
                    ),
                )
                self.last_response = response

                fixed_code = self._extract_code(response.text or "")

                if not fixed_code.strip():
                    logger.warning(
                        "Gemini returned empty fix for %s",
                        vulnerability.file_path,
                    )
                    return PatchResult(
                        file_path=vulnerability.file_path,
                        original_code=original_code,
                        fixed_code="",
                        success=False,
                        message="Gemini returned an empty response.",
                    )

                logger.info(
                    "Patch generated for %s (line %d, %s)",
                    vulnerability.file_path,
                    vulnerability.line_number,
                    vulnerability.severity,
                )

                return PatchResult(
                    file_path=vulnerability.file_path,
                    original_code=original_code,
                    fixed_code=fixed_code,
                    success=True,
                    message="Patch generated successfully.",
                )

            except ClientError as exc:
                if exc.code != 429:
                    logger.error(
                        "Gemini call failed for %s: %s",
                        vulnerability.file_path, exc,
                    )
                    return PatchResult(
                        file_path=vulnerability.file_path,
                        original_code=original_code,
                        fixed_code="",
                        success=False,
                        message=f"Gemini error: {exc}",
                    )

                last_exc = exc
                delay = _BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "429 rate-limited for %s (attempt %d/%d). "
                    "Retrying in %.1f s …",
                    vulnerability.file_path, attempt, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)

            except Exception as exc:
                logger.error(
                    "Unexpected error generating patch for %s: %s",
                    vulnerability.file_path, exc,
                )
                return PatchResult(
                    file_path=vulnerability.file_path,
                    original_code=original_code,
                    fixed_code="",
                    success=False,
                    message=f"Unexpected error: {exc}",
                )

        # All retries exhausted
        logger.error(
            "All %d retries exhausted for %s: %s",
            _MAX_RETRIES, vulnerability.file_path, last_exc,
        )
        return PatchResult(
            file_path=vulnerability.file_path,
            original_code=original_code,
            fixed_code="",
            success=False,
            message=f"Rate-limited after {_MAX_RETRIES} retries.",
        )

    # ── Core: apply a patch to disk ─────────────────────────

    async def apply_patch(self, file_path: str, fixed_code: str) -> None:
        """Overwrite *file_path* with *fixed_code*, creating a backup first.

        The backup is saved alongside the original as
        ``<filename>.bak.<timestamp>``.

        Uses ``asyncio.to_thread`` so file I/O doesn't block the event loop.
        """
        await asyncio.to_thread(self._write_patch, file_path, fixed_code)

    @staticmethod
    def _write_patch(file_path: str, fixed_code: str) -> None:
        """Synchronous helper executed in a thread."""
        target = Path(file_path)

        if not target.exists():
            logger.error("Cannot apply patch — file not found: %s", target)
            raise FileNotFoundError(f"File not found: {target}")

        # Create timestamped backup
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = target.with_suffix(f"{target.suffix}.bak.{ts}")
        shutil.copy2(target, backup)
        logger.info("Backup saved: %s", backup)

        # Overwrite with fixed code
        target.write_text(fixed_code, encoding="utf-8")
        logger.info("Patch applied: %s", target)

    # ── Helpers ─────────────────────────────────────────────

    @staticmethod
    def _extract_code(raw: str) -> str:
        """Strip markdown fences if Gemini wraps the code in them."""
        # Match ```lang\n...\n``` or ```\n...\n```
        match = re.search(
            r"```(?:\w+)?\s*\n(.*?)```",
            raw,
            re.DOTALL,
        )
        if match:
            return match.group(1).strip()

        # No fences — return as-is (Gemini followed instructions)
        return raw.strip()
