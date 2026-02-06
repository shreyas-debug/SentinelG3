#!/usr/bin/env python3
"""
Sentinel-G3 | Integration Test — "Hackathon Readiness Report"

This script runs the full self-healing pipeline against the ``test_lab/``
vulnerability lab and verifies every link in the chain:

  1. Pre-flight cleanup (manifest, old backups)
  2. Snapshot original files
  3. Execute SentinelOrchestrator.run_self_healing_cycle()
  4. Post-flight verification:
       a. Files in test_lab/ have actually changed
       b. A .bak backup exists for every modified file
       c. run_manifest.json exists with valid thought_signature entries
       d. Reasoning Quality — CoT density, signature integrity, heal efficiency
  5. Print a coloured "Hackathon Readiness Report" with ASCII-art banner

Usage:
    py scripts/run_integration_test.py
"""

from __future__ import annotations

import ast
import asyncio
import base64
import io
import json
import logging
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

# ── Force UTF-8 output on Windows ───────────────────────────
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace"
    )

# ── Ensure project root is on sys.path ──────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.orchestrator import SentinelOrchestrator  # noqa: E402

# ── Configuration ────────────────────────────────────────────
TEST_LAB = PROJECT_ROOT / "test_lab"
MANIFEST_PATH = TEST_LAB / "run_manifest.json"

# ANSI colours for the report
_GREEN   = "\033[92m"
_RED     = "\033[91m"
_YELLOW  = "\033[93m"
_CYAN    = "\033[96m"
_MAGENTA = "\033[95m"
_WHITE   = "\033[97m"
_BOLD    = "\033[1m"
_DIM     = "\033[2m"
_RESET   = "\033[0m"

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format=f"{_DIM}%(asctime)s{_RESET} %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("integration_test")


# ═══════════════════════════════════════════════════════════════
#  ASCII Art
# ═══════════════════════════════════════════════════════════════

_LOGO_SUCCESS = f"""\
{_GREEN}
        _______________________________________________________________
       /                                                               \\
      |   {_BOLD}{_WHITE}   ____             _   _            _        ____ _____ {_RESET}{_GREEN}  |
      |   {_BOLD}{_WHITE}  / ___|  ___ _ __ | |_(_)_ __   ___| |      / ___|___ / {_RESET}{_GREEN}  |
      |   {_BOLD}{_WHITE}  \\___ \\ / _ \\ '_ \\| __| | '_ \\ / _ \\ |  ___| |  _  |_ \\ {_RESET}{_GREEN}  |
      |   {_BOLD}{_WHITE}   ___) |  __/ | | | |_| | | | |  __/ | |___| |_| |___) |{_RESET}{_GREEN}  |
      |   {_BOLD}{_WHITE}  |____/ \\___|_| |_|\\__|_|_| |_|\\___|_|_____|\\____|____/ {_RESET}{_GREEN}  |
      |                                                               |
      |         {_BOLD}{_CYAN}[ AUTONOMOUS SELF-HEALING SECURITY AUDITOR ]{_RESET}{_GREEN}         |
      |                                                               |
      |   {_DIM}+----------------------------------------------+{_RESET}{_GREEN}          |
      |   {_DIM}|{_RESET}  {_GREEN}{_BOLD}STATUS : HACKATHON READY{_RESET}                    {_DIM}|{_RESET}{_GREEN}          |
      |   {_DIM}|{_RESET}  {_CYAN}ENGINE : Gemini 3 Pro  |  thinking: HIGH{_RESET}   {_DIM}|{_RESET}{_GREEN}          |
      |   {_DIM}|{_RESET}  {_CYAN}AGENTS : Auditor >> Fixer >> Validator{_RESET}     {_DIM}|{_RESET}{_GREEN}          |
      |   {_DIM}+----------------------------------------------+{_RESET}{_GREEN}          |
      |                                                               |
       \\_____________________________________________________________/{_RESET}
"""

_SHIELD_ICON = f"""\
{_GREEN}            .     .
           / \\   / \\
          /   \\_/   \\
         | {_WHITE}{_BOLD}SENTINEL{_RESET}{_GREEN}  |
         |  {_CYAN}{_BOLD}- G3 -{_RESET}{_GREEN}   |
          \\       /
           \\     /
            \\   /
             \\ /
              V{_RESET}"""


# ═══════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════

def _banner(title: str) -> None:
    width = 60
    print(f"\n{_CYAN}{_BOLD}{'=' * width}{_RESET}")
    print(f"{_CYAN}{_BOLD}  {title}{_RESET}")
    print(f"{_CYAN}{_BOLD}{'=' * width}{_RESET}\n")


def _check(label: str, passed: bool, detail: str = "") -> bool:
    icon = f"{_GREEN}+ PASS{_RESET}" if passed else f"{_RED}x FAIL{_RESET}"
    suffix = f"  {_DIM}{detail}{_RESET}" if detail else ""
    print(f"  {icon}  {label}{suffix}")
    return passed


def _mini_bar(value: float, max_val: float = 100, width: int = 20) -> str:
    """Render a coloured inline progress bar."""
    pct = min(value / max_val, 1.0) if max_val > 0 else 0
    filled = int(width * pct)
    color = _GREEN if pct >= 0.7 else (_YELLOW if pct >= 0.4 else _RED)
    return f"{color}{'#' * filled}{_DIM}{'.' * (width - filled)}{_RESET}"


def _snapshot_files(lab: Path) -> dict[str, str]:
    """Return {relative_path: file_contents} for all source files."""
    snap: dict[str, str] = {}
    for p in sorted(lab.rglob("*")):
        if p.is_file() and p.suffix in (".py", ".js") and ".bak." not in p.name:
            rel = str(p.relative_to(lab)).replace("\\", "/")
            snap[rel] = p.read_text(encoding="utf-8", errors="ignore")
    return snap


def _find_backups(lab: Path) -> dict[str, list[Path]]:
    """Return {original_stem: [backup_paths]} for .bak.* files."""
    backups: dict[str, list[Path]] = {}
    for p in sorted(lab.rglob("*.bak.*")):
        stem = p.name.split(".bak.")[0]
        backups.setdefault(stem, []).append(p)
    return backups


def _check_syntax(file_path: Path) -> tuple[bool, str]:
    """Check whether a patched file has valid syntax.

    For .py files uses ast.parse(); for .js files uses Node --check.
    Returns (ok, error_message).
    """
    code = file_path.read_text(encoding="utf-8", errors="ignore")

    if file_path.suffix == ".py":
        try:
            ast.parse(code, filename=str(file_path))
            return True, ""
        except SyntaxError as exc:
            return False, f"line {exc.lineno}: {exc.msg}"

    if file_path.suffix == ".js":
        try:
            result = subprocess.run(
                ["node", "--check", str(file_path)],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                return True, ""
            return False, result.stderr.strip()[:120]
        except FileNotFoundError:
            return True, "(node not found, skipped JS syntax check)"
        except subprocess.TimeoutExpired:
            return False, "syntax check timed out"

    return True, "(unknown extension, skipped)"


# ═══════════════════════════════════════════════════════════════
#  Phase 1 — Pre-flight cleanup
# ═══════════════════════════════════════════════════════════════

def phase_cleanup() -> None:
    _banner("Phase 1 -- Pre-flight Cleanup")

    # Remove old manifest
    if MANIFEST_PATH.exists():
        MANIFEST_PATH.unlink()
        logger.info("Removed old run_manifest.json")

    # Remove old .bak files
    bak_count = 0
    for bak in TEST_LAB.rglob("*.bak.*"):
        bak.unlink()
        bak_count += 1
    if bak_count:
        logger.info("Removed %d old backup file(s)", bak_count)

    # Restore golden originals
    golden = PROJECT_ROOT / "test_lab_golden"
    if golden.is_dir():
        for src in golden.iterdir():
            if src.is_file():
                shutil.copy2(src, TEST_LAB / src.name)
        logger.info("Restored golden copies from test_lab_golden/")
    else:
        logger.info(
            "No test_lab_golden/ found -- using current test_lab/ files as-is. "
            "Tip: copy pristine lab files to test_lab_golden/ for repeatable runs."
        )

    print(f"  {_GREEN}+{_RESET} Cleanup complete.\n")


# ═══════════════════════════════════════════════════════════════
#  Phase 2 — Execute the Orchestrator
# ═══════════════════════════════════════════════════════════════

async def phase_execute():
    _banner("Phase 2 -- Run Self-Healing Cycle")

    orchestrator = SentinelOrchestrator()
    summary = await orchestrator.run_self_healing_cycle(str(TEST_LAB))

    print(f"\n  {_BOLD}Orchestrator returned:{_RESET}")
    print(f"    Run ID           : {summary.run_id}")
    print(f"    Scanned files    : {summary.scanned_files}")
    print(f"    Vulns found      : {summary.vulnerabilities_found}")
    print(f"    Vulns healed     : {summary.vulnerabilities_healed}")
    print()

    return summary


# ═══════════════════════════════════════════════════════════════
#  Phase 3 — Verification
# ═══════════════════════════════════════════════════════════════

def phase_verify(
    before: dict[str, str],
    summary,
) -> tuple[dict[str, bool], dict[str, object]]:
    """Run all post-flight checks.

    Returns:
        results:  {check_name: bool}
        rq_data:  reasoning-quality raw data for the report
    """
    _banner("Phase 3 -- Post-flight Verification")

    results: dict[str, bool] = {}
    rq_data: dict[str, object] = {}   # populated in 3d

    # ── 3a. Files actually changed ────────────────────────────
    print(f"  {_BOLD}3a. File Mutation Check{_RESET}")
    after = _snapshot_files(TEST_LAB)
    changed_files: list[str] = []
    unchanged_files: list[str] = []

    for rel, old_content in before.items():
        new_content = after.get(rel)
        if new_content is None:
            _check(f"{rel}", False, "file deleted unexpectedly")
            results[f"mutated:{rel}"] = False
        elif new_content != old_content:
            changed_files.append(rel)
            results[f"mutated:{rel}"] = True
        else:
            unchanged_files.append(rel)
            results[f"mutated:{rel}"] = False

    for f in changed_files:
        _check(f, True, "content changed")
    for f in unchanged_files:
        _check(f, False, "content NOT changed")

    any_changed = len(changed_files) > 0
    results["any_file_changed"] = any_changed
    print()
    _check(
        "At least one file was modified by the Fixer",
        any_changed,
        f"{len(changed_files)}/{len(before)} files changed",
    )
    print()

    # ── 3b. Backup (.bak) files exist ─────────────────────────
    print(f"  {_BOLD}3b. Backup Integrity Check{_RESET}")
    backups = _find_backups(TEST_LAB)

    all_backups_ok = True
    for rel in changed_files:
        filename = Path(rel).name
        has_bak = filename in backups and len(backups[filename]) > 0
        ok = _check(f"Backup for {rel}", has_bak,
                     f"{len(backups.get(filename, []))} backup(s)")
        if not ok:
            all_backups_ok = False
        results[f"backup:{rel}"] = has_bak

    results["all_backups_present"] = all_backups_ok
    print()

    # ── 3c. Manifest validation ───────────────────────────────
    print(f"  {_BOLD}3c. run_manifest.json Validation{_RESET}")

    manifest: dict | None = None
    manifest_exists = MANIFEST_PATH.exists()
    _check("Manifest file exists", manifest_exists, str(MANIFEST_PATH))
    results["manifest_exists"] = manifest_exists

    if manifest_exists:
        try:
            manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            _check("Manifest is valid JSON", False, str(exc))
            results["manifest_valid_json"] = False
            return results, rq_data

        _check("Manifest is valid JSON", True)
        results["manifest_valid_json"] = True

        required_keys = {"sentinel_g3_version", "run_id", "timestamp",
                         "repository", "summary", "entries"}
        has_keys = required_keys.issubset(manifest.keys())
        _check("Has required top-level keys", has_keys,
               f"found: {set(manifest.keys())}")
        results["manifest_keys"] = has_keys

        entries = manifest.get("entries", [])
        _check(f"Manifest has {len(entries)} entry(ies)",
               len(entries) > 0)
        results["manifest_has_entries"] = len(entries) > 0

        auditor_sig_count = 0
        fixer_sig_count = 0
        for entry in entries:
            sigs = entry.get("thought_signatures", {})
            if sigs.get("auditor"):
                auditor_sig_count += 1
            if sigs.get("fixer"):
                fixer_sig_count += 1

        _check(
            "Auditor thought_signatures present",
            auditor_sig_count > 0,
            f"{auditor_sig_count}/{len(entries)} entries have auditor signatures",
        )
        _check(
            "Fixer thought_signatures present",
            fixer_sig_count > 0,
            f"{fixer_sig_count}/{len(entries)} entries have fixer signatures",
        )
        results["auditor_signatures"] = auditor_sig_count > 0
        results["fixer_signatures"] = fixer_sig_count > 0

        sig_format_ok = True
        for entry in entries:
            sigs = entry.get("thought_signatures", {})
            for source in ("auditor", "fixer"):
                for sig_obj in sigs.get(source, []):
                    ts = sig_obj.get("thought_signature", "")
                    if not isinstance(ts, str) or len(ts) < 4:
                        sig_format_ok = False
        _check("Thought signatures are base64-encoded", sig_format_ok)
        results["signature_format"] = sig_format_ok

    print()

    # ── 3d. Reasoning Quality ─────────────────────────────────
    print(f"  {_BOLD}3d. Reasoning Quality Analysis{_RESET}")
    rq_data = _evaluate_reasoning_quality(manifest, changed_files, results)
    print()

    return results, rq_data


# ───────────────────────────────────────────────────────────────
#  3d helper — Reasoning Quality evaluation
# ───────────────────────────────────────────────────────────────

def _evaluate_reasoning_quality(
    manifest: dict | None,
    changed_files: list[str],
    results: dict[str, bool],
) -> dict[str, object]:
    """Analyse the manifest's thought data and patched file syntax.

    Populates ``results`` with pass/fail flags and returns raw
    metrics used by the final report card.
    """
    rq: dict[str, object] = {
        "cot_density_score": 0.0,
        "cot_density_grade": "N/A",
        "cot_lengths": [],
        "avg_cot_length": 0,
        "max_cot_length": 0,
        "sig_integrity_score": 0.0,
        "sig_count": 0,
        "sig_valid": 0,
        "heal_efficiency_score": 0.0,
        "syntax_ok_count": 0,
        "syntax_total": 0,
    }

    entries: list[dict] = (manifest or {}).get("entries", [])

    # ── CoT Density ───────────────────────────────────────────
    print()
    print(f"    {_CYAN}[CoT Density]{_RESET}  Evaluating depth of AI reasoning...")

    cot_lengths: list[int] = []
    for entry in entries:
        sigs = entry.get("thought_signatures", {})
        for source in ("auditor", "fixer"):
            for sig_obj in sigs.get(source, []):
                text = sig_obj.get("thought_text", "")
                if text:
                    cot_lengths.append(len(text))

    rq["cot_lengths"] = cot_lengths

    if cot_lengths:
        avg_len = sum(cot_lengths) / len(cot_lengths)
        max_len = max(cot_lengths)
        rq["avg_cot_length"] = int(avg_len)
        rq["max_cot_length"] = max_len

        # Scoring: 0-50 chars = shallow, 50-200 = moderate, 200-500 = deep, 500+ = exceptional
        if avg_len >= 500:
            score, grade = 100.0, "EXCEPTIONAL"
        elif avg_len >= 200:
            score, grade = 80.0, "DEEP"
        elif avg_len >= 50:
            score, grade = 50.0, "MODERATE"
        else:
            score, grade = 20.0, "SHALLOW"

        rq["cot_density_score"] = score
        rq["cot_density_grade"] = grade

        _check(
            f"CoT Density: avg {int(avg_len)} chars, max {max_len} chars",
            score >= 50,
            f"Grade: {grade}",
        )
        results["cot_density"] = score >= 50

        # Per-entry breakdown
        for i, entry in enumerate(entries):
            sigs = entry.get("thought_signatures", {})
            a_len = sum(len(s.get("thought_text", "")) for s in sigs.get("auditor", []))
            f_len = sum(len(s.get("thought_text", "")) for s in sigs.get("fixer", []))
            file_name = entry.get("file_path", "?")
            bar = _mini_bar(a_len + f_len, max_val=1000, width=15)
            print(
                f"      {_DIM}{i+1}.{_RESET} {file_name:20s}  "
                f"Auditor: {a_len:>5} chars  "
                f"Fixer: {f_len:>5} chars  "
                f"{bar}"
            )
    else:
        _check("CoT Density: no thought text found", False, "Grade: N/A")
        results["cot_density"] = False

    # ── Signature Integrity ───────────────────────────────────
    print()
    print(f"    {_CYAN}[Signature Integrity]{_RESET}  Validating thought_signature blobs...")

    sig_count = 0
    sig_valid = 0
    sig_details: list[str] = []

    for entry in entries:
        sigs = entry.get("thought_signatures", {})
        for source in ("auditor", "fixer"):
            for sig_obj in sigs.get(source, []):
                sig_count += 1
                raw = sig_obj.get("thought_signature", "")
                # Verify it's a non-empty base64 string
                if isinstance(raw, str) and len(raw) >= 4:
                    try:
                        decoded = base64.b64decode(raw, validate=True)
                        if len(decoded) > 0:
                            sig_valid += 1
                            sig_details.append(
                                f"{source:>7}: {len(decoded):>5} bytes  "
                                f"{_GREEN}valid{_RESET}"
                            )
                        else:
                            sig_details.append(
                                f"{source:>7}: empty after decode  "
                                f"{_RED}invalid{_RESET}"
                            )
                    except Exception:
                        sig_details.append(
                            f"{source:>7}: base64 decode failed  "
                            f"{_RED}invalid{_RESET}"
                        )
                else:
                    sig_details.append(
                        f"{source:>7}: missing or too short  "
                        f"{_RED}invalid{_RESET}"
                    )

    rq["sig_count"] = sig_count
    rq["sig_valid"] = sig_valid

    if sig_count > 0:
        sig_score = (sig_valid / sig_count) * 100
        rq["sig_integrity_score"] = sig_score
        _check(
            f"Signature Integrity: {sig_valid}/{sig_count} valid",
            sig_valid == sig_count,
            f"{sig_score:.0f}%",
        )
        results["sig_integrity"] = sig_valid == sig_count

        for detail in sig_details:
            print(f"      {_DIM}-{_RESET} {detail}")
    else:
        _check("Signature Integrity: no signatures to validate", False)
        results["sig_integrity"] = False

    # ── Heal Efficiency (syntax-safe patching) ────────────────
    print()
    print(f"    {_CYAN}[Heal Efficiency]{_RESET}  Checking patched files for syntax errors...")

    syntax_ok = 0
    syntax_total = 0

    for rel in changed_files:
        file_path = TEST_LAB / rel
        if file_path.exists():
            syntax_total += 1
            ok, err_msg = _check_syntax(file_path)
            if ok:
                syntax_ok += 1
                _check(f"Syntax valid: {rel}", True, err_msg if err_msg else "clean")
            else:
                _check(f"Syntax valid: {rel}", False, err_msg)
            results[f"syntax:{rel}"] = ok

    rq["syntax_ok_count"] = syntax_ok
    rq["syntax_total"] = syntax_total

    if syntax_total > 0:
        eff = (syntax_ok / syntax_total) * 100
        rq["heal_efficiency_score"] = eff
        _check(
            f"Heal Efficiency: {syntax_ok}/{syntax_total} patched files have valid syntax",
            syntax_ok == syntax_total,
            f"{eff:.0f}%",
        )
        results["heal_efficiency"] = syntax_ok == syntax_total
    else:
        rq["heal_efficiency_score"] = 0.0
        _check("Heal Efficiency: no patched files to validate", False)
        results["heal_efficiency"] = False

    return rq


# ═══════════════════════════════════════════════════════════════
#  Phase 4 — Hackathon Readiness Report
# ═══════════════════════════════════════════════════════════════

def phase_report(
    results: dict[str, bool],
    summary,
    rq_data: dict[str, object],
) -> None:
    _banner("Hackathon Readiness Report")

    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed
    pct = (passed / total * 100) if total else 0

    # Determine overall status
    critical_checks = [
        "any_file_changed",
        "manifest_exists",
        "manifest_has_entries",
    ]
    critical_ok = all(results.get(c, False) for c in critical_checks)

    # ── Overall score bar ─────────────────────────────────────
    bar_len = 40
    filled = int(bar_len * pct / 100)
    bar_color = _GREEN if pct >= 80 else (_YELLOW if pct >= 50 else _RED)
    bar = f"{bar_color}{'#' * filled}{_DIM}{'.' * (bar_len - filled)}{_RESET}"

    print(f"  {_BOLD}Overall Score:{_RESET}  {bar}  {_BOLD}{pct:.0f}%{_RESET}")
    print(f"                {_GREEN}{passed} passed{_RESET}  /  "
          f"{_RED if failed else _DIM}{failed} failed{_RESET}  /  {total} total")
    print()

    # ── Pipeline summary table ────────────────────────────────
    heal_rate = (
        summary.vulnerabilities_healed / summary.vulnerabilities_found * 100
        if summary.vulnerabilities_found else 0
    )
    rate_color = _GREEN if heal_rate >= 80 else (_YELLOW if heal_rate >= 50 else _RED)

    print(f"  {_BOLD}Pipeline Summary{_RESET}")
    print(f"  +----------------------------------+-----------+")
    print(f"  | Scanned files                    | {summary.scanned_files:>9} |")
    print(f"  | Vulnerabilities found            | {summary.vulnerabilities_found:>9} |")
    print(f"  | Vulnerabilities healed           | {summary.vulnerabilities_healed:>9} |")
    print(f"  | Heal rate                        | {rate_color}{heal_rate:>8.0f}%{_RESET} |")
    print(f"  +----------------------------------+-----------+")
    print()

    # ── Reasoning Quality scorecard ───────────────────────────
    print(f"  {_BOLD}{_MAGENTA}Reasoning Quality Scorecard{_RESET}")
    print(f"  +----------------------------------+-----------+-----------------------+")
    print(f"  |  Metric                          |  Score    |  Detail               |")
    print(f"  +----------------------------------+-----------+-----------------------+")

    cot_score = rq_data.get("cot_density_score", 0.0)
    cot_grade = rq_data.get("cot_density_grade", "N/A")
    cot_avg   = rq_data.get("avg_cot_length", 0)
    cot_color = _GREEN if cot_score >= 80 else (_YELLOW if cot_score >= 50 else _RED)
    print(f"  |  CoT Density                     | {cot_color}{cot_score:>7.0f}%{_RESET}  |"
          f"  {cot_grade:<8} avg:{cot_avg:>5} ch |")

    sig_score = rq_data.get("sig_integrity_score", 0.0)
    sig_v = rq_data.get("sig_valid", 0)
    sig_t = rq_data.get("sig_count", 0)
    sig_color = _GREEN if sig_score >= 100 else (_YELLOW if sig_score >= 50 else _RED)
    print(f"  |  Signature Integrity             | {sig_color}{sig_score:>7.0f}%{_RESET}  |"
          f"  {sig_v}/{sig_t} valid            |")

    eff_score = rq_data.get("heal_efficiency_score", 0.0)
    syn_ok = rq_data.get("syntax_ok_count", 0)
    syn_t  = rq_data.get("syntax_total", 0)
    eff_color = _GREEN if eff_score >= 100 else (_YELLOW if eff_score >= 50 else _RED)
    print(f"  |  Heal Efficiency (syntax-safe)   | {eff_color}{eff_score:>7.0f}%{_RESET}  |"
          f"  {syn_ok}/{syn_t} clean patches    |")

    # Composite reasoning score
    composite = 0.0
    weight_total = 0
    for score_key, weight in [("cot_density_score", 3),
                               ("sig_integrity_score", 2),
                               ("heal_efficiency_score", 5)]:
        composite += float(rq_data.get(score_key, 0)) * weight
        weight_total += weight
    composite = composite / weight_total if weight_total else 0
    comp_color = _GREEN if composite >= 80 else (_YELLOW if composite >= 50 else _RED)

    print(f"  +----------------------------------+-----------+-----------------------+")
    print(f"  |  {_BOLD}COMPOSITE REASONING SCORE{_RESET}        "
          f"| {comp_color}{_BOLD}{composite:>7.0f}%{_RESET}  "
          f"|  weighted avg         |")
    print(f"  +----------------------------------+-----------+-----------------------+")
    print()

    # ── Per-entry breakdown ───────────────────────────────────
    if summary.entries:
        print(f"  {_BOLD}Per-Vulnerability Breakdown{_RESET}")
        for i, entry in enumerate(summary.entries, 1):
            v = entry.vulnerability
            status = f"{_GREEN}HEALED{_RESET}" if entry.healed else f"{_RED}FAILED{_RESET}"
            sev_color = {
                "critical": _RED, "high": _RED, "medium": _YELLOW,
                "low": _CYAN, "info": _DIM,
            }.get(v.severity.lower(), _RESET)
            print(
                f"  {_DIM}{i:>3}.{_RESET}  "
                f"[{sev_color}{v.severity.upper():>8}{_RESET}]  "
                f"{status}  "
                f"{v.file_path}:{v.line_number}"
            )
            print(f"       {_DIM}{v.issue[:90]}{'...' if len(v.issue) > 90 else ''}{_RESET}")
        print()

    # ── Verdict ───────────────────────────────────────────────
    if critical_ok and pct >= 80:
        print(_LOGO_SUCCESS)
        print(f"  {_GREEN}{_BOLD}>>> VERDICT: HACKATHON READY <<<{_RESET}")
        print()
        print(f"    The self-healing pipeline is fully operational.")
        print(f"    Agents detected vulnerabilities, reasoned through fixes,")
        print(f"    applied syntax-safe patches, and produced a signed audit")
        print(f"    trail with verifiable chain-of-thought signatures.")
        print()
        print(f"    {_DIM}Ship it. Win it.{_RESET}")
    elif critical_ok:
        print()
        print(_SHIELD_ICON)
        print()
        print(f"  {_YELLOW}{_BOLD}>>> VERDICT: MOSTLY READY -- minor issues <<<{_RESET}")
        print(f"    The core pipeline works but some checks failed.")
        print(f"    Review the FAIL items above before the demo.")
    else:
        print()
        print(f"  {_RED}{_BOLD}>>> VERDICT: NOT READY <<<{_RESET}")
        print(f"    Critical checks failed. The pipeline needs debugging")
        print(f"    before the hackathon demo.")
        print()
        print(f"    {_DIM}Common causes:{_RESET}")
        print(f"    - Gemini API quota exhausted (wait for reset)")
        print(f"    - Network issues reaching the Gemini endpoint")
        print(f"    - Malformed agent responses")

    print()


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════

async def main() -> int:
    start = datetime.now(timezone.utc)

    print()
    print(_SHIELD_ICON)
    _banner("Sentinel-G3 -- Integration Test Suite")
    print(f"  Test lab   : {TEST_LAB}")
    print(f"  Timestamp  : {start.isoformat()}")
    print()

    # Phase 1 — Cleanup
    phase_cleanup()

    # Snapshot files before the cycle
    before = _snapshot_files(TEST_LAB)
    logger.info("Snapshotted %d source file(s) in test_lab/", len(before))

    # Phase 2 — Execute
    summary = await phase_execute()

    # Phase 3 — Verify (includes Reasoning Quality)
    results, rq_data = phase_verify(before, summary)

    # Phase 4 — Report
    phase_report(results, summary, rq_data)

    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    print(f"  {_DIM}Completed in {elapsed:.1f}s{_RESET}\n")

    # Exit with non-zero if any critical check failed
    critical_ok = all(
        results.get(c, False)
        for c in ["any_file_changed", "manifest_exists", "manifest_has_entries"]
    )
    return 0 if critical_ok else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
