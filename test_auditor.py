"""
Sentinel-G3 | Auditor Smoke Test

Runs the AuditorAgent against the target_code/ directory and
pretty-prints the discovered vulnerabilities.
"""

import asyncio
import json
import sys
from pathlib import Path

# Ensure the project root is on sys.path so `app.*` imports resolve
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Load .env before anything touches settings
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

from app.agents.auditor import AuditorAgent


async def main() -> None:
    target = str(Path(__file__).resolve().parent / "target_code")

    print(f"[*] Scanning: {target}\n")

    auditor = AuditorAgent()
    result = await auditor.analyze_repository(target)

    print(f"[+] Scanned files : {result.scanned_files}")
    print(f"[+] Vulnerabilities: {len(result.vulnerabilities)}\n")

    if result.vulnerabilities:
        print(json.dumps(
            [v.model_dump() for v in result.vulnerabilities],
            indent=2,
        ))
    else:
        print("[i] No vulnerabilities found.")


if __name__ == "__main__":
    asyncio.run(main())
