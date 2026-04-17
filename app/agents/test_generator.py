"""
Sentinel-G3 | Security Test Generator Agent

Generates pytest test cases for fixed vulnerabilities to prevent regression.
"""

from __future__ import annotations

import logging
from typing import Any

from google.genai import types

from app.agents.base import BaseAgent
from app.models.schemas import FileBatchValidationResult, GeneratedTestSuite, ValidationResult, Vulnerability

logger = logging.getLogger(__name__)


class SecurityTestGenerator(BaseAgent):
    """Generate security test cases for fixed vulnerabilities."""

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        return {"agent": "test_generator", "status": "use generate_security_tests directly"}

    async def generate_security_tests(
        self,
        vulnerability: Vulnerability,
        patched_code: str,
        validation_result: ValidationResult,
    ) -> GeneratedTestSuite:
        """Generate pytest tests that verify the fix blocks known exploits."""

        exploit_summary = "\n".join(
            f"- {e.attack_type}: payload={e.payload!r} (blocked={e.blocked_by_patch})"
            for e in validation_result.exploit_tests
        )

        prompt = f"""Generate pytest security test cases for this fixed vulnerability.

Vulnerability: {vulnerability.issue}
File: {vulnerability.file_path}
Severity: {vulnerability.severity}

Patched code:
```python
{patched_code[:3000]}
```

Validated exploit attempts:
{exploit_summary or "No specific exploits recorded."}

Generate 3-5 test cases that:
1. Verify each exploit is blocked (test name: test_<attack>_blocked).
2. Verify legitimate use cases still work (test name: test_legitimate_<case>).
3. Cover edge cases.

For each test:
- name: valid Python function name starting with test_
- description: one sentence
- code: complete pytest function body (no class wrapper)
- priority: critical | high | medium | low

Also provide the imports string needed at the top of the test file.
Respond strictly as the GeneratedTestSuite JSON schema."""

        for attempt in range(2):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.active_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        thinking_config=types.ThinkingConfig(thinking_level="MEDIUM"),
                        response_schema=GeneratedTestSuite,
                        response_mime_type="application/json",
                    ),
                )
                self.last_response = response
                return GeneratedTestSuite.model_validate_json(response.text)
            except Exception as exc:
                logger.warning("TestGenerator attempt %d failed: %s", attempt + 1, exc)
                if attempt == 0 and self.switch_to_fallback():
                    continue
                break

        return GeneratedTestSuite(test_cases=[], imports="")

    async def generate_file_tests(
        self,
        file_path: str,
        vulnerabilities: list[Vulnerability],
        patched_code: str,
        batch_result: FileBatchValidationResult,
    ) -> GeneratedTestSuite:
        """Generate a comprehensive pytest test suite for all fixes in a file.

        One Gemini call covers all vulnerabilities in the file — token-efficient.
        """
        vuln_summary = "\n".join(
            f"- [{v.severity.upper()}] {v.issue[:80]} (line {v.line_number})"
            for v in vulnerabilities
        )

        exploit_summary = ""
        for item in batch_result.per_vuln:
            if item.exploit_tests:
                exploit_summary += f"\n{item.issue_key[:60]}:\n"
                exploit_summary += "\n".join(
                    f"  · {e.attack_type}: {e.payload!r} → blocked={e.blocked_by_patch}"
                    for e in item.exploit_tests
                )

        prompt = f"""Generate a comprehensive pytest security test suite for all fixes applied to {file_path}.

Vulnerabilities fixed:
{vuln_summary}

Patched file:
```python
{patched_code[:4000]}
```

Validated exploit attempts:
{exploit_summary or "No specific exploits recorded."}

Generate 4-8 test cases total covering:
1. Each critical/high exploit is blocked (test_<vuln_type>_blocked).
2. Legitimate functionality still works (test_legitimate_<feature>).
3. Edge cases and boundary conditions.

Rules:
- name: valid Python function name starting with test_
- description: one sentence
- code: complete self-contained pytest function (no class needed)
- priority: critical | high | medium | low

Also provide the imports needed at the top of the test file.
Respond strictly as GeneratedTestSuite JSON."""

        for attempt in range(2):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.active_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        thinking_config=types.ThinkingConfig(thinking_level="MEDIUM"),
                        response_schema=GeneratedTestSuite,
                        response_mime_type="application/json",
                    ),
                )
                self.last_response = response
                return GeneratedTestSuite.model_validate_json(response.text)
            except Exception as exc:
                logger.warning("FileTestGenerator attempt %d failed: %s", attempt + 1, exc)
                if attempt == 0 and self.switch_to_fallback():
                    continue
                break

        return GeneratedTestSuite(test_cases=[], imports="")
