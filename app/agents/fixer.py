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
from collections.abc import Awaitable, Callable
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
        on_thinking: Callable[[str], Awaitable[None]] | None = None,
    ) -> PatchResult:
        """Ask Gemini 3 Pro to produce a fixed version of the source file.

        Args:
            vulnerability: The finding from the Auditor agent.
            original_code: The full source text of the vulnerable file.
            on_thinking:  Optional async callback invoked with each thinking
                          chunk as Gemini streams its reasoning.

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

        return await self._generate_with_fallback(
            vulnerability, original_code, prompt, on_thinking,
        )

    async def _generate_with_fallback(
        self,
        vulnerability: Vulnerability,
        original_code: str,
        prompt: str,
        on_thinking: Callable[[str], Awaitable[None]] | None = None,
    ) -> PatchResult:
        """Try primary model, fall back on quota exhaustion.

        When *on_thinking* is provided, uses the **streaming** API so
        Gemini's chain-of-thought can be emitted to the dashboard in
        real-time.
        """
        last_exc: Exception | None = None
        config = types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            thinking_config=types.ThinkingConfig(
                thinking_level="HIGH",
                include_thoughts=True,
            ),
        )

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                if on_thinking:
                    raw_text = await self._stream_with_thinking(
                        prompt, config, on_thinking,
                    )
                else:
                    response = await self.client.aio.models.generate_content(
                        model=self.active_model,
                        contents=prompt,
                        config=config,
                    )
                    self.last_response = response
                    raw_text = response.text or ""

                fixed_code = self._extract_code(raw_text)

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
                    "Patch generated for %s (line %d, %s) [model=%s]",
                    vulnerability.file_path,
                    vulnerability.line_number,
                    vulnerability.severity,
                    self.active_model,
                )

                return PatchResult(
                    file_path=vulnerability.file_path,
                    original_code=original_code,
                    fixed_code=fixed_code,
                    success=True,
                    message=f"Patch generated successfully (model={self.active_model}).",
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
                    "429 rate-limited for %s (attempt %d/%d, model=%s). "
                    "Retrying in %.1f s …",
                    vulnerability.file_path, attempt, _MAX_RETRIES,
                    self.active_model, delay,
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

        # All retries exhausted — try fallback model if available
        if self.switch_to_fallback():
            logger.info(
                "Retrying %s with fallback model %s …",
                vulnerability.file_path, self.active_model,
            )
            return await self._generate_with_fallback(
                vulnerability, original_code, prompt, on_thinking,
            )

        logger.error(
            "All retries exhausted for %s: %s",
            _MAX_RETRIES, vulnerability.file_path, last_exc,
        )
        return PatchResult(
            file_path=vulnerability.file_path,
            original_code=original_code,
            fixed_code="",
            success=False,
            message=f"Rate-limited after {_MAX_RETRIES} retries on both models.",
        )

    # ── Streaming helper ────────────────────────────────────

    async def _stream_with_thinking(
        self,
        prompt: str,
        config: types.GenerateContentConfig,
        on_thinking: Callable[[str], Awaitable[None]],
    ) -> str:
        """Call Gemini with the streaming API, emitting thinking chunks.

        Returns the concatenated non-thinking response text.
        """
        text_parts: list[str] = []

        stream = await self.client.aio.models.generate_content_stream(
            model=self.active_model,
            contents=prompt,
            config=config,
        )
        async for chunk in stream:
            if not chunk.candidates:
                continue
            for candidate in chunk.candidates:
                if not candidate.content or not candidate.content.parts:
                    continue
                for part in candidate.content.parts:
                    is_thought = getattr(part, "thought", False)
                    text = getattr(part, "text", "") or ""
                    if not text:
                        continue
                    if is_thought:
                        await on_thinking(text)
                    else:
                        text_parts.append(text)

        return "".join(text_parts)

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
