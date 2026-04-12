#!/usr/bin/env python3
"""
Sentinel-G3 | CI/CD Integration Script

Scans a repository for vulnerabilities and optionally fails the CI pipeline
if critical or high severity issues are found.

Usage:
    python scripts/ci_scan.py --target ./src --fail-on critical high

Exit codes:
    0 — Scan completed successfully, no blocking findings
    1 — Blocking findings found (or scan error)
    2 — Configuration error (bad arguments, missing API key)

Example GitHub Actions usage:
    - name: Sentinel-G3 Security Scan
      run: python scripts/ci_scan.py --target . --fail-on critical high
      env:
        GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        ALLOWED_ORIGINS: "https://your-sentinel-g3.vercel.app"

    # Optional: upload SARIF to GitHub Advanced Security
    - name: Upload SARIF
      uses: github/codeql-action/upload-sarif@v3
      if: always()
      with:
        sarif_file: sentinel-g3-results.sarif
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Add project root to path when running from repo
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── ASCII banner ─────────────────────────────────────────

_BANNER = """
╔══════════════════════════════════════════════════╗
║          Sentinel-G3 | CI/CD Security Scan       ║
║          Powered by Google Gemini 3              ║
╚══════════════════════════════════════════════════╝
"""


# ── Helpers ──────────────────────────────────────────────

def _severity_rank(sev: str) -> int:
    """Higher = more severe. Used for threshold comparisons."""
    return {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}.get(
        sev.lower(), 0
    )


def _print_summary(findings: list[dict], threshold_sevs: set[str]) -> int:
    """Print a formatted summary table. Returns count of blocking findings."""
    if not findings:
        print("\n✅  No vulnerabilities found — clean scan!\n")
        return 0

    # Group by severity
    by_sev: dict[str, list[dict]] = {}
    for f in findings:
        s = f.get("severity", "info").lower()
        by_sev.setdefault(s, []).append(f)

    order = ["critical", "high", "medium", "low", "info"]
    print(f"\n{'─' * 70}")
    print(f"  FINDINGS SUMMARY")
    print(f"{'─' * 70}")

    blocking = 0
    for sev in order:
        vulns = by_sev.get(sev, [])
        if not vulns:
            continue
        is_blocking = sev in threshold_sevs
        flag = "🚫 BLOCKING" if is_blocking else "⚠️ "
        print(f"\n  {flag} {sev.upper()} ({len(vulns)} issue(s))")
        if is_blocking:
            blocking += len(vulns)
        for v in vulns[:5]:  # show max 5 per severity to keep CI output clean
            print(f"    • {v.get('file_path', '?')}:{v.get('line_number', '?')} — {v.get('issue', '')[:80]}")
        if len(vulns) > 5:
            print(f"    … and {len(vulns) - 5} more")

    print(f"\n{'─' * 70}")
    print(f"  TOTALS: {len(findings)} findings | {blocking} blocking")
    print(f"{'─' * 70}\n")
    return blocking


def _write_sarif(findings: list[dict], output_path: str, repo_path: str) -> None:
    """Write a SARIF 2.1.0 file to *output_path*."""
    _SEV_TO_SARIF = {
        "critical": "error", "high": "error",
        "medium": "warning", "low": "note", "info": "none",
    }

    rules = []
    results = []
    seen: set[str] = set()

    for v in findings:
        sev = v.get("severity", "info").lower()
        rule_id = f"SG3-{sev.upper()}-{abs(hash(v.get('issue', ''))) % 9999:04d}"
        if rule_id not in seen:
            seen.add(rule_id)
            rules.append({
                "id": rule_id,
                "shortDescription": {"text": v.get("issue", "")[:100]},
                "defaultConfiguration": {"level": _SEV_TO_SARIF.get(sev, "warning")},
                "help": {"text": v.get("fix_suggestion", "")},
            })
        results.append({
            "ruleId": rule_id,
            "level": _SEV_TO_SARIF.get(sev, "warning"),
            "message": {"text": v.get("issue", "")},
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {
                        "uri": v.get("file_path", "unknown").replace("\\", "/"),
                        "uriBaseId": "%SRCROOT%",
                    },
                    "region": {"startLine": max(1, v.get("line_number", 1))},
                }
            }],
        })

    sarif = {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "Sentinel-G3", "version": "0.1.0",
                    "informationUri": "https://github.com/sentinel-g3",
                    "rules": rules,
                }
            },
            "results": results,
        }],
    }

    Path(output_path).write_text(json.dumps(sarif, indent=2), encoding="utf-8")
    print(f"  📄 SARIF written to: {output_path}")


# ── Main ─────────────────────────────────────────────────

async def _run_scan(target: str) -> list[dict]:
    """Run the AuditorAgent and return raw vulnerability dicts."""
    from app.agents.auditor import AuditorAgent
    from app.config import settings

    settings.validate()
    agent = AuditorAgent()
    result = await agent.analyze_repository(target)
    return [v.model_dump() for v in result.vulnerabilities]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sentinel-G3 CI/CD security scanner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--target", "-t",
        default=".",
        help="Path to the repository to scan (default: current directory)",
    )
    parser.add_argument(
        "--fail-on", "-f",
        nargs="+",
        choices=["critical", "high", "medium", "low"],
        default=["critical"],
        dest="fail_on",
        metavar="SEVERITY",
        help="Severity levels that will cause a non-zero exit. Default: critical",
    )
    parser.add_argument(
        "--sarif",
        default="sentinel-g3-results.sarif",
        help="Output path for SARIF report (default: sentinel-g3-results.sarif)",
    )
    parser.add_argument(
        "--no-sarif",
        action="store_true",
        default=False,
        help="Disable SARIF report output",
    )
    parser.add_argument(
        "--json-output",
        default="",
        help="Optional path to write a JSON findings report",
    )

    args = parser.parse_args()

    target = str(Path(args.target).resolve())
    if not Path(target).is_dir():
        print(f"❌  Target directory not found: {target}", file=sys.stderr)
        return 2

    print(_BANNER)
    print(f"  Target: {target}")
    print(f"  Fail on: {', '.join(args.fail_on)}")
    print(f"  SARIF output: {'disabled' if args.no_sarif else args.sarif}")
    print()

    try:
        findings = asyncio.run(_run_scan(target))
    except EnvironmentError as exc:
        print(f"❌  Configuration error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"❌  Scan error: {exc}", file=sys.stderr)
        return 1

    threshold_sevs = set(s.lower() for s in args.fail_on)
    blocking = _print_summary(findings, threshold_sevs)

    # Write SARIF
    if not args.no_sarif:
        _write_sarif(findings, args.sarif, target)

    # Write JSON
    if args.json_output:
        Path(args.json_output).write_text(
            json.dumps({"findings": findings}, indent=2), encoding="utf-8"
        )
        print(f"  📄 JSON report written to: {args.json_output}")

    if blocking > 0:
        print(f"\n🚫  CI FAILED: {blocking} blocking vulnerability(ies) found.\n")
        return 1

    print(f"\n✅  CI PASSED: No blocking findings at threshold: {', '.join(args.fail_on)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
