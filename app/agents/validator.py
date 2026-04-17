"""
Sentinel-G3 | Validator Agent

Verifies that a generated patch actually fixes the vulnerability by
generating exploit attempts and testing them against the patched code.
"""

from __future__ import annotations

import logging
from typing import Any

from google.genai import types

from app.agents.base import BaseAgent
from app.models.schemas import FileBatchValidationResult, ValidationResult, Vulnerability

logger = logging.getLogger(__name__)


class ValidatorAgent(BaseAgent):
    """Stage 3 – Verify that applied fixes actually resolve the issue."""

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        vuln = context.get("vulnerability")
        original_code = context.get("original_code", "")
        patched_code = context.get("patched_code", "")
        if not vuln or not patched_code:
            return {"agent": "validator", "status": "skipped"}
        result = await self.validate_fix(vuln, original_code, patched_code)
        return result.model_dump()

    async def validate_fix(
        self,
        vulnerability: Vulnerability,
        original_code: str,
        patched_code: str,
    ) -> ValidationResult:
        """Generate exploit attempts and verify the patch blocks them."""

        prompt = f"""You are a security validation expert. Validate whether a security patch truly fixes the vulnerability.

Vulnerability:
- Issue: {vulnerability.issue}
- Severity: {vulnerability.severity}
- File: {vulnerability.file_path}:{vulnerability.line_number}
- Fix suggestion: {vulnerability.fix_suggestion}

Original (vulnerable) code:
```
{original_code[:3000]}
```

Patched code:
```
{patched_code[:3000]}
```

Your task:
1. Generate 3-5 realistic exploit attempts that would have worked on the original code.
2. For each exploit, determine if the patch blocks it (blocked_by_patch=true) or not.
3. Assess whether legitimate functionality is preserved.
4. Set vulnerability_fixed=true only if ALL exploits are blocked.
5. Provide a confidence_score (0.0-1.0).

Respond strictly as the ValidationResult JSON schema."""

        for attempt in range(2):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.active_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction="You are a security validation expert. Always respond with valid JSON.",
                        thinking_config=types.ThinkingConfig(thinking_level="HIGH"),
                        response_schema=ValidationResult,
                        response_mime_type="application/json",
                    ),
                )
                self.last_response = response
                return ValidationResult.model_validate_json(response.text)
            except Exception as exc:
                logger.warning("Validator attempt %d failed: %s", attempt + 1, exc)
                if attempt == 0 and self.switch_to_fallback():
                    continue
                break

        # Fallback: return a conservative result
        return ValidationResult(
            vulnerability_fixed=False,
            confidence_score=0.0,
            exploit_tests=[],
            functional_impact="Validation could not be completed.",
            recommendation="Needs revision",
            reasoning="Validation failed due to API error.",
        )

    async def validate_file_batch(
        self,
        file_path: str,
        vulnerabilities: list[Vulnerability],
        original_code: str,
        patched_code: str,
    ) -> FileBatchValidationResult:
        """Validate ALL vulnerabilities in a file in a single Gemini call.

        Token-efficient: the file content is sent once regardless of how many
        vulnerabilities were found in it.
        """
        vuln_list = "\n".join(
            f"{i+1}. [{v.severity.upper()}] Line {v.line_number}: {v.issue}"
            for i, v in enumerate(vulnerabilities)
        )

        prompt = f"""You are a security validation expert. Validate all security patches applied to a single file.

File: {file_path}

Vulnerabilities fixed ({len(vulnerabilities)} total):
{vuln_list}

Original (vulnerable) file:
```
{original_code[:4000]}
```

Patched file (all fixes applied):
```
{patched_code[:4000]}
```

For EACH vulnerability listed above:
1. Generate 2-3 realistic exploit attempts that would have worked on the original code.
2. Determine if the patch blocks each exploit (blocked_by_patch=true/false).
3. Set vulnerability_fixed=true only if ALL exploits for that vuln are blocked.
4. Provide a confidence_score (0.0-1.0).

Use the issue text as issue_key (first 60 chars is fine).
Set all_fixed=true only if ALL vulnerabilities are fixed.
Set overall_confidence to the average of all per-vuln confidence scores.

Respond strictly as FileBatchValidationResult JSON."""

        for attempt in range(2):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.active_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction="You are a security validation expert. Always respond with valid JSON.",
                        thinking_config=types.ThinkingConfig(thinking_level="HIGH"),
                        response_schema=FileBatchValidationResult,
                        response_mime_type="application/json",
                    ),
                )
                self.last_response = response
                return FileBatchValidationResult.model_validate_json(response.text)
            except Exception as exc:
                logger.warning("FileBatch validator attempt %d failed: %s", attempt + 1, exc)
                if attempt == 0 and self.switch_to_fallback():
                    continue
                break

        # Fallback
        from app.models.schemas import VulnValidationItem
        return FileBatchValidationResult(
            all_fixed=False,
            overall_confidence=0.0,
            per_vuln=[
                VulnValidationItem(
                    issue_key=v.issue[:60],
                    vulnerability_fixed=False,
                    confidence_score=0.0,
                    recommendation="Needs revision",
                )
                for v in vulnerabilities
            ],
            reasoning="Batch validation failed due to API error.",
        )
