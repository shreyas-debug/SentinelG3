"""
Sentinel-G3 | Security Report Generator

POST /api/v1/report         → Professional HTML report (print-ready)
POST /api/v1/report/sarif   → SARIF 2.1.0 (GitHub Advanced Security compatible)
POST /api/v1/report/json    → Machine-readable JSON summary
POST /api/v1/report/csv     → Spreadsheet-friendly CSV
"""

from __future__ import annotations

import csv
import html
import io
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(tags=["report"])


# ── Request schema (mirrors frontend HealingSummary) ─────────────────

class VulnReport(BaseModel):
    severity: str = ""
    issue: str = ""
    file_path: str = ""
    line_number: int = 0
    fix_suggestion: str = ""
    eli5_explanation: str = ""
    exploit_poc: str = ""
    attack_scenario: str = ""


class PatchReport(BaseModel):
    file_path: str = ""
    success: bool = False
    message: str = ""
    fixed_code: str = ""
    original_code: str = ""


class EntryReport(BaseModel):
    vulnerability: VulnReport = Field(default_factory=VulnReport)
    patch: PatchReport = Field(default_factory=PatchReport)
    healed: bool = False


class ReportRequest(BaseModel):
    run_id: str = ""
    repository_path: str = ""
    scanned_files: int = 0
    vulnerabilities_found: int = 0
    vulnerabilities_healed: int = 0
    entries: list[EntryReport] = []


# ── Color helpers ────────────────────────────────────────────────────

_SEV_COLORS = {
    "critical": ("#dc2626", "#fef2f2"),
    "high":     ("#ea580c", "#fff7ed"),
    "medium":   ("#ca8a04", "#fefce8"),
    "low":      ("#2563eb", "#eff6ff"),
    "info":     ("#6b7280", "#f9fafb"),
}


def _sev_color(severity: str) -> tuple[str, str]:
    return _SEV_COLORS.get(severity.lower(), ("#6b7280", "#f9fafb"))


def _h(text: str) -> str:
    """HTML-escape a string."""
    return html.escape(str(text))


# ── HTML report builder ──────────────────────────────────────────────

def _build_report(req: ReportRequest) -> str:
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    
    # Calculate stats for corporate overview
    critical_count = sum(1 for e in req.entries if e.vulnerability.severity.lower() == "critical")
    high_count     = sum(1 for e in req.entries if e.vulnerability.severity.lower() == "high")
    medium_count   = sum(1 for e in req.entries if e.vulnerability.severity.lower() == "medium")
    low_count      = sum(1 for e in req.entries if e.vulnerability.severity.lower() == "low")

    # Build per-entry HTML
    entries_html = ""
    for i, entry in enumerate(req.entries, 1):
        v = entry.vulnerability
        sev_fg, sev_bg = _sev_color(v.severity)

        exec_summary = (
            f"""<div class="summary-box">
              <div class="summary-label">Executive Overview</div>
              <p>{_h(v.eli5_explanation)}</p>
            </div>"""
            if v.eli5_explanation else ""
        )

        poc_block = ""
        if v.exploit_poc:
            poc_block = f"""
            <div class="detail-section">
              <div class="detail-header">Proof of Concept / Exploitation</div>
              <pre class="code-block poc-code">{_h(v.exploit_poc)}</pre>
            </div>"""

        scenario_block = ""
        if v.attack_scenario:
            scenario_block = f"""
            <div class="detail-section">
              <div class="detail-header">Attack Narrative</div>
              <p class="narrative-text">{_h(v.attack_scenario)}</p>
            </div>"""

        entries_html += f"""
        <div class="finding-card">
          <div class="finding-id-header">
            <span class="finding-id">FINDING-ID: SG3-{i:03d}</span>
            <span class="sev-tag" style="background:{sev_fg};">{_h(v.severity.upper())}</span>
          </div>
          <div class="finding-title-row">{_h(v.issue[:150])}</div>
          
          <div class="finding-content">
            <div class="info-grid">
              <div class="info-item"><strong>Component:</strong> <code>{_h(v.file_path)}</code></div>
              <div class="info-item"><strong>Line Reference:</strong> {v.line_number}</div>
            </div>

            {exec_summary}

            <div class="detail-section">
              <div class="detail-header">Technical Risk Analysis</div>
              <p>{_h(v.issue)}</p>
            </div>

            {scenario_block}
            {poc_block}

            <div class="detail-section remediation-box">
              <div class="detail-header" style="color: #1b5e20;">Remediation Strategy</div>
              <p>{_h(v.fix_suggestion)}</p>
            </div>
          </div>
        </div>
        """

    summary_rows = "".join(
        f"<tr>"
        f"<td>SG3-{i:03d}</td>"
        f"<td><span class='sev-pill' style='background:{_sev_color(e.vulnerability.severity)[0]}'>{_h(e.vulnerability.severity.upper())}</span></td>"
        f"<td>{_h(e.vulnerability.file_path)}</td>"
        f"<td>{_h(e.vulnerability.issue[:100])}</td>"
        f"</tr>"
        for i, e in enumerate(req.entries, 1)
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sentinel-G3 Security Assessment Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ 
      font-family: 'Inter', -apple-system, sans-serif; 
      font-size: 10pt; 
      color: #2d3748; 
      background: #ffffff; 
      line-height: 1.5; 
    }}
    
    .report-container {{ 
      max-width: 8.5in; 
      margin: 0 auto; 
      padding: 0.75in 1in; 
    }}

    /* ── Formal Header ── */
    .header {{ 
      border-bottom: 3px solid #1a202c; 
      padding-bottom: 20px; 
      margin-bottom: 40px; 
      display: flex; 
      justify-content: space-between; 
      align-items: flex-end;
    }}
    .header-left .company-name {{ 
      font-size: 20pt; 
      font-weight: 800; 
      color: #1a202c; 
      text-transform: uppercase; 
      letter-spacing: -1px; 
    }}
    .header-left .report-title {{ 
      font-size: 14pt; 
      color: #4a5568; 
      font-weight: 400; 
    }}
    .header-right {{ 
      text-align: right; 
      font-size: 8pt; 
      color: #718096; 
      text-transform: uppercase; 
      letter-spacing: 1px; 
    }}

    .confidential-banner {{ 
      background: #fff5f5; 
      color: #c53030; 
      text-align: center; 
      padding: 8px; 
      font-weight: 700; 
      font-size: 9pt; 
      text-transform: uppercase; 
      margin-bottom: 30px; 
      border: 1px solid #feb2b2;
    }}

    /* ── Meta Table ── */
    .meta-table {{ 
      width: 100%; 
      margin-bottom: 40px; 
      border-collapse: collapse;
    }}
    .meta-table td {{ 
      padding: 6px 0; 
      font-size: 9pt; 
    }}
    .meta-table .label {{ 
      color: #718096; 
      width: 1.5in; 
      font-weight: 600; 
    }}
    .meta-table .value {{ 
      color: #1a202c; 
      font-weight: 700; 
      font-family: 'Courier New', Courier, monospace;
    }}

    /* ── Stats ── */
    .stats-row {{ 
      display: grid; 
      grid-template-columns: repeat(4, 1fr); 
      gap: 15px; 
      margin-bottom: 40px; 
    }}
    .stat-box {{ 
      border: 1px solid #e2e8f0; 
      padding: 15px; 
      text-align: center; 
    }}
    .stat-box .count {{ 
      font-size: 22pt; 
      font-weight: 800; 
      color: #1a202c; 
    }}
    .stat-box .label {{ 
      font-size: 7pt; 
      text-transform: uppercase; 
      color: #718096; 
      margin-top: 5px; 
      font-weight: 700; 
    }}

    h2 {{ 
      font-size: 14pt; 
      font-weight: 800; 
      text-transform: uppercase; 
      color: #1a202c; 
      margin: 40px 0 15px; 
      padding-bottom: 5px; 
      border-bottom: 1px solid #e2e8f0;
    }}

    /* ── Summary Table ── */
    .summary-table {{ 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 8.5pt; 
    }}
    .summary-table th {{ 
      text-align: left; 
      background: #f7fafc; 
      padding: 10px; 
      border-bottom: 2px solid #cbd5e0; 
      color: #4a5568; 
    }}
    .summary-table td {{ 
      padding: 10px; 
      border-bottom: 1px solid #edf2f7; 
      vertical-align: top;
    }}

    /* ── Finding Cards ── */
    .finding-card {{ 
      border: 1px solid #e2e8f0; 
      margin-bottom: 30px; 
      page-break-inside: avoid;
    }}
    .finding-id-header {{ 
      background: #1a202c; 
      color: #fff; 
      padding: 8px 15px; 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
    }}
    .finding-id {{ 
      font-size: 8pt; 
      font-weight: 700; 
      letter-spacing: 1px; 
    }}
    .sev-tag {{ 
      font-size: 7pt; 
      font-weight: 800; 
      padding: 2px 8px; 
      border-radius: 2px;
    }}
    .finding-title-row {{ 
      padding: 15px; 
      font-size: 12pt; 
      font-weight: 700; 
      background: #f8fafc; 
      border-bottom: 1px solid #e2e8f0;
    }}
    .finding-content {{ 
      padding: 20px; 
    }}

    .info-grid {{ 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 10px; 
      margin-bottom: 20px; 
      font-size: 8.5pt; 
    }}
    code {{ 
      font-family: 'Courier New', Courier, monospace; 
      background: #edf2f7; 
      padding: 2px 4px;
    }}

    .summary-box {{ 
      background: #f7fafc; 
      border-left: 4px solid #4a5568; 
      padding: 15px; 
      margin-bottom: 20px; 
    }}
    .summary-label {{ 
      font-size: 7.5pt; 
      font-weight: 800; 
      text-transform: uppercase; 
      color: #4a5568; 
      margin-bottom: 5px; 
    }}
    .summary-box p {{ 
      font-style: italic; 
      color: #2d3748; 
    }}

    .detail-section {{ 
      margin-bottom: 20px; 
    }}
    .detail-header {{ 
      font-size: 8.5pt; 
      font-weight: 800; 
      text-transform: uppercase; 
      color: #2d3748; 
      margin-bottom: 8px; 
      border-bottom: 1px solid #edf2f7; 
      padding-bottom: 3px;
    }}
    .detail-section p {{ 
      font-size: 9.5pt; 
      text-align: justify;
    }}

    .code-block {{ 
      background: #1a202c; 
      color: #e2e8f0; 
      padding: 15px; 
      font-family: 'Courier New', Courier, monospace; 
      font-size: 8pt; 
      border-radius: 4px; 
      white-space: pre-wrap; 
      overflow-x: auto;
    }}
    .poc-code {{ 
       color: #fc8181; 
    }}

    .remediation-box {{ 
      background: #f0fff4; 
      border: 1px solid #c6f6d5; 
      padding: 15px;
    }}
    .remediation-box p {{ 
      color: #22543d; 
      font-weight: 500;
    }}

    .sev-pill {{ 
      display: inline-block; 
      padding: 2px 8px; 
      color: #fff; 
      font-size: 7pt; 
      font-weight: 800; 
      text-transform: uppercase;
    }}

    .footer {{ 
      text-align: center; 
      margin-top: 60px; 
      padding-top: 20px; 
      border-top: 1px solid #e2e8f0; 
      font-size: 8pt; 
      color: #a0aec0;
    }}

    @media print {{
      body {{ font-size: 9pt; }}
      .report-container {{ padding: 0; }}
      @page {{ margin: 0.75in; }}
    }}
  </style>
</head>
<body>
  <div class="report-container">
    <div class="confidential-banner">Company Confidential - Authorized Access Only</div>
    
    <div class="header">
      <div class="header-left">
        <div class="company-name">Sentinel-G3 Assessment</div>
        <div class="report-title">Vulnerability Research Report</div>
      </div>
      <div class="header-right">
        Ref: {req.run_id or "INTERNAL-SCAN"}<br>
        Date: {now}
      </div>
    </div>

    <table class="meta-table">
      <tr>
        <td class="label">Primary Asset Target</td>
        <td class="value">{_h(req.repository_path or "Application Source Code")}</td>
      </tr>
      <tr>
        <td class="label">Assessment Methodology</td>
        <td class="value">Gemini-3 Assisted Static Code Analysis (SCA)</td>
      </tr>
      <tr>
        <td class="label">Scope</td>
        <td class="value">{req.scanned_files} Files Analyzed</td>
      </tr>
    </table>

    <div class="stats-row">
      <div class="stat-box">
        <div class="count" style="color: #c53030;">{critical_count}</div>
        <div class="label">Critical</div>
      </div>
      <div class="stat-box">
        <div class="count" style="color: #e53e3e;">{high_count}</div>
        <div class="label">High</div>
      </div>
      <div class="stat-box">
        <div class="count" style="color: #dd6b20;">{medium_count}</div>
        <div class="label">Medium</div>
      </div>
      <div class="stat-box">
        <div class="count" style="color: #3182ce;">{low_count}</div>
        <div class="label">Low</div>
      </div>
    </div>

    <h2>1. Executive Risk Summary</h2>
    <p>
      This document presents the findings of an automated security assessment performed on the target repository. 
      A total of <strong>{req.vulnerabilities_found}</strong> vulnerabilities were identified across 
      <strong>{req.scanned_files}</strong> distinct components.
    </p>
    <p style="margin-top: 10px;">
      The assessment utilized the Sentinel-G3 autonomous engine to identify common attack vectors, 
      including insecure data handling, authentication bypasses, and infrastructure misconfigurations.
    </p>

    <h2>2. Vulnerability Index</h2>
    <table class="summary-table">
      <thead>
        <tr>
          <th style="width: 15%;">ID</th>
          <th style="width: 15%;">Risk</th>
          <th style="width: 30%;">File / Location</th>
          <th style="width: 40%;">Description</th>
        </tr>
      </thead>
      <tbody>
        {summary_rows}
      </tbody>
    </table>

    <div style="page-break-after: always;"></div>

    <h2>3. Comprehensive Technical Findings</h2>
    {entries_html if entries_html else '<p>No vulnerabilities identified.</p>'}

    <div class="footer">
      Generated by Sentinel-G3 Security Infrastructure &middot; Classified: Confidential &middot; &copy; 2026
    </div>
  </div>
</body>
</html>"""


# ── Route ────────────────────────────────────────────────────────────

@router.post("/report", response_class=HTMLResponse)
async def generate_report(req: ReportRequest) -> HTMLResponse:
    """Generate a professional HTML security audit report.

    Accepts the same HealingSummary payload that the frontend accumulates
    during a scan run. Returns a complete, self-contained HTML document
    ready to be opened in a browser or printed to PDF.
    """
    html_content = _build_report(req)
    return HTMLResponse(
        content=html_content,
        headers={"Content-Disposition": 'inline; filename="sentinel-g3-report.html"'},
    )


# ── SARIF 2.1.0 Export ───────────────────────────────────

_SEV_TO_SARIF = {
    "critical": "error",
    "high":     "error",
    "medium":   "warning",
    "low":      "note",
    "info":     "none",
}


@router.post("/report/sarif")
async def generate_sarif_report(req: ReportRequest) -> JSONResponse:
    """Generate a SARIF 2.1.0 report (GitHub Advanced Security compatible).

    Upload the returned JSON to GitHub Code Scanning to see findings
    directly inline in pull requests and the Security tab.
    """
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    rules: list[dict] = []
    results: list[dict] = []
    seen_rule_ids: set[str] = set()

    for i, entry in enumerate(req.entries):
        v = entry.vulnerability
        sev_lower = v.severity.lower()
        rule_id = f"SG3-{sev_lower.upper()}-{abs(hash(v.issue)) % 9999:04d}"

        if rule_id not in seen_rule_ids:
            seen_rule_ids.add(rule_id)
            rules.append({
                "id": rule_id,
                "name": v.issue[:80].replace(" ", ""),
                "shortDescription": {"text": v.issue[:100]},
                "fullDescription": {"text": v.issue},
                "defaultConfiguration": {
                    "level": _SEV_TO_SARIF.get(sev_lower, "warning"),
                },
                "properties": {
                    "tags": [sev_lower, "security"],
                    "precision": "high",
                    "problem.severity": sev_lower,
                },
                "help": {
                    "text": v.fix_suggestion,
                    "markdown": f"**Remediation:** {v.fix_suggestion}",
                },
            })

        results.append({
            "ruleId": rule_id,
            "level": _SEV_TO_SARIF.get(sev_lower, "warning"),
            "message": {
                "text": v.issue,
            },
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {
                        "uri": v.file_path.replace("\\", "/"),
                        "uriBaseId": "%SRCROOT%",
                    },
                    "region": {
                        "startLine": max(1, v.line_number),
                    },
                },
            }],
            "properties": {
                "severity": v.severity,
                "fix_suggestion": v.fix_suggestion,
                "eli5": v.eli5_explanation or "",
            },
        })

    sarif = {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "Sentinel-G3",
                    "version": "0.1.0",
                    "informationUri": "https://github.com/sentinel-g3",
                    "semanticVersion": "0.1.0",
                    "rules": rules,
                },
            },
            "results": results,
            "invocations": [{
                "executionSuccessful": True,
                "endTimeUtc": now,
            }],
            "properties": {
                "run_id": req.run_id,
                "scanned_files": req.scanned_files,
                "repository_path": req.repository_path,
            },
        }],
    }

    sarif_bytes = json.dumps(sarif, indent=2).encode("utf-8")

    return Response(
        content=sarif_bytes,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="sentinel-g3-results.sarif"',
            "Content-Type": "application/sarif+json",
        },
    )


# ── JSON Export ──────────────────────────────────────────

@router.post("/report/json")
async def generate_json_report(req: ReportRequest) -> Response:
    """Generate a clean, machine-readable JSON summary report."""
    now = datetime.now(tz=timezone.utc).isoformat()

    payload = {
        "meta": {
            "tool": "Sentinel-G3",
            "version": "0.1.0",
            "generated_at": now,
            "run_id": req.run_id,
        },
        "summary": {
            "repository_path": req.repository_path,
            "scanned_files": req.scanned_files,
            "vulnerabilities_found": req.vulnerabilities_found,
            "vulnerabilities_healed": req.vulnerabilities_healed,
        },
        "findings": [
            {
                "id": f"SG3-{i:03d}",
                "severity": e.vulnerability.severity,
                "issue": e.vulnerability.issue,
                "file_path": e.vulnerability.file_path,
                "line_number": e.vulnerability.line_number,
                "fix_suggestion": e.vulnerability.fix_suggestion,
                "eli5_explanation": e.vulnerability.eli5_explanation,
                "exploit_poc": e.vulnerability.exploit_poc,
                "attack_scenario": e.vulnerability.attack_scenario,
                "patch_status": "healed" if e.healed else ("generated" if e.patch and e.patch.success else "no_fix"),
                "fixed_code_available": bool(e.patch and e.patch.fixed_code),
            }
            for i, e in enumerate(req.entries, 1)
        ],
    }

    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={'Content-Disposition': 'attachment; filename="sentinel-g3-report.json"'},
    )


# ── CSV Export ───────────────────────────────────────────

@router.post("/report/csv")
async def generate_csv_report(req: ReportRequest) -> Response:
    """Generate a spreadsheet-friendly CSV report."""
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # Header row
    writer.writerow([
        "ID", "Severity", "File", "Line", "Issue",
        "Fix Suggestion", "ELI5", "Patch Status",
        "Run ID", "Repository",
    ])

    for i, entry in enumerate(req.entries, 1):
        v = entry.vulnerability
        patch_status = (
            "healed" if entry.healed
            else "generated" if entry.patch and entry.patch.success
            else "no_fix"
        )
        writer.writerow([
            f"SG3-{i:03d}",
            v.severity,
            v.file_path,
            v.line_number,
            v.issue,
            v.fix_suggestion,
            v.eli5_explanation or "",
            patch_status,
            req.run_id,
            req.repository_path,
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel compatibility

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={'Content-Disposition': 'attachment; filename="sentinel-g3-report.csv"'},
    )

