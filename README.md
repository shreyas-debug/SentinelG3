# Sentinel-G3

> **Autonomous, Self-Healing Security Auditor** powered by [Google Gemini 3 Pro](https://deepmind.google/technologies/gemini/) with deep chain-of-thought reasoning.

Built for the [Gemini 3 Hackathon](https://gemini3.devpost.com/).

---

## What is Sentinel-G3?

Sentinel-G3 is an AI-native security tool that **finds vulnerabilities, reasons through fixes, and applies them autonomously** — all in a single pipeline. Instead of handing developers a list of problems and walking away, Sentinel-G3 closes the loop by leveraging the advanced **thinking capabilities** of Google's Gemini 3 Pro model.

Every decision the AI makes is transparent: the full **chain-of-thought** from both the Auditor and Fixer agents is captured, signed with `thought_signature` blobs, and displayed in a real-time dashboard so you can see *why* the AI made each choice.

---

## Demo

```
              .     .
             / \   / \
            /   \_/   \
           | SENTINEL  |
           |  - G3 -   |
            \         /
             \       /
              \     /
               \   /
                V
```

1. Point Sentinel-G3 at a codebase
2. Watch the Auditor discover SQL injections, hardcoded secrets, broken auth
3. Watch the Fixer generate parameterized queries, env-var lookups, safe comparisons
4. Verify patches are syntax-safe and the audit trail is cryptographically signed
5. Explore the AI's reasoning in the real-time dashboard

---

## Agentic Architecture

The core of Sentinel-G3 is a **three-stage autonomous pipeline** where each stage is a specialised AI agent. The agents communicate through a shared context and the entire cycle is orchestrated by `SentinelOrchestrator`.

```
┌──────────────────────────────────────────────────────────────────┐
│                      Sentinel-G3 Pipeline                        │
│                                                                  │
│   ┌────────────┐      ┌────────────┐      ┌──────────────┐      │
│   │  AUDITOR   │─────>│   FIXER    │─────>│  VALIDATOR    │     │
│   │  Agent     │      │   Agent    │      │   Agent       │     │
│   └────────────┘      └────────────┘      └──────────────┘      │
│        │                    │                    │                │
│   Scan & detect        Generate patches    Re-audit patched      │
│   vulnerabilities      via Gemini 3 Pro    code to confirm       │
│   (thinking: HIGH)     (thinking: HIGH)    resolution            │
│        │                    │                    │                │
│   thought_signature    thought_signature    Pass / Fail           │
│   captured             captured             (loop if needed)     │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              run_manifest.json (Audit Trail)             │   │
│   │  - Full thought signatures for every Gemini call         │   │
│   │  - Vulnerability details + patch outcomes                │   │
│   │  - Timestamped, signed, verifiable                       │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Stage 1 — Auditor Agent

| Aspect       | Detail |
|---|---|
| **Purpose**  | Deep static analysis of `.py` and `.js` source files for security vulnerabilities |
| **Gemini 3** | `thinking_level=HIGH` with `response_schema=list[Vulnerability]` for structured JSON output |
| **Output**   | A list of `Vulnerability` objects (severity, issue, file_path, line_number, fix_suggestion) |
| **Resilience** | Exponential backoff retry (2s, 4s, 8s) on 429 rate limits; 1s delay between files |

### Stage 2 — Fixer Agent

| Aspect       | Detail |
|---|---|
| **Purpose**  | Generate minimal, targeted patches that remediate each finding |
| **Gemini 3** | `thinking_level=HIGH` prompting the model as a Senior Security Engineer |
| **Output**   | `PatchResult` with original and fixed code; auto-backup before overwrite |
| **Safety**   | Creates timestamped `.bak` files before every patch; async file I/O |

### Stage 3 — Orchestrator

| Aspect       | Detail |
|---|---|
| **Purpose**  | Coordinate the full Audit → Fix cycle and produce the audit trail |
| **Output**   | `HealingCycleSummary` + `run_manifest.json` with `thought_signature` entries |
| **Transparency** | Extracts full chain-of-thought text from Gemini responses for dashboard display |

---

## Project Structure

```
SentinelG3/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI entry-point (CORS, routes, startup)
│   ├── config.py               # Environment & settings (Gemini API key)
│   ├── orchestrator.py         # SentinelOrchestrator — full pipeline coordinator
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── base.py             # Abstract BaseAgent (Gemini client init)
│   │   ├── auditor.py          # Stage 1 — vulnerability scanning
│   │   ├── fixer.py            # Stage 2 — patch generation & application
│   │   └── validator.py        # Stage 3 — fix verification (future)
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py           # SSE /scan endpoint + /history
│   └── models/
│       ├── __init__.py
│       └── schemas.py          # Pydantic models (Vulnerability, PatchResult, etc.)
│
├── dashboard/                  # Next.js 15 real-time dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css     # Dark war-room theme (emerald/amber/red)
│   │   │   ├── layout.tsx      # Root layout
│   │   │   └── page.tsx        # Main dashboard page
│   │   ├── components/
│   │   │   ├── scan-button.tsx
│   │   │   ├── live-feed.tsx           # Real-time SSE log terminal
│   │   │   ├── healing-history.tsx     # Expandable vulnerability table
│   │   │   ├── stats-bar.tsx           # Scan statistics
│   │   │   ├── code-diff.tsx           # Side-by-side diff (Shiki syntax)
│   │   │   ├── syntax-highlight.tsx    # Shiki highlighter singleton
│   │   │   ├── thinking-indicator.tsx  # Pulsing "AI is thinking" animation
│   │   │   └── ui/badge.tsx
│   │   └── lib/
│   │       ├── api.ts          # SSE client + data types
│   │       └── utils.ts        # cn() helper
│   └── package.json
│
├── test_lab/                   # "Vulnerability Lab" — golden sample exploits
│   ├── sql_lab.py              # SQL injection (3 variants)
│   ├── secret_lab.js           # Hardcoded secrets (5 variants)
│   └── logic_lab.py            # Broken auth & logic flaws (5 variants)
│
├── test_lab_golden/            # Pristine copies (auto-restored before each test)
│
├── scripts/
│   └── run_integration_test.py # Full pipeline integration test + Readiness Report
│
├── .cursor/rules/
│   └── sentinel-g3.mdc        # AI coding rules for the project
│
├── .env.template
├── .gitignore
├── requirements.txt
└── README.md
```

---

## Quick Start

### Backend (FastAPI)

```bash
# 1. Clone & enter the project
git clone <repo-url> && cd SentinelG3

# 2. Create a virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
copy .env.template .env       # then add your GEMINI_API_KEY

# 5. Run the backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Dashboard (Next.js)

```bash
cd dashboard
npm install
npm run dev
```

Open **http://localhost:3000** — enter your target directory and hit **Run Security Scan**.

### Integration Test

```bash
py scripts/run_integration_test.py
```

Runs the full Auditor → Fixer pipeline against `test_lab/` and prints a **Hackathon Readiness Report** with:

- File mutation checks (did the code actually change?)
- Backup integrity (`.bak` files for every patched file)
- Manifest validation (`run_manifest.json` with thought signatures)
- **Reasoning Quality Scorecard** — CoT Density, Signature Integrity, Heal Efficiency

---

## Key Features

### Gemini 3 Pro — Deep Reasoning

Every Gemini call uses `thinking_level=HIGH`, enabling the model to reason through complex vulnerability chains rather than pattern-matching. The full chain-of-thought is:

- **Captured** in `run_manifest.json` with cryptographic `thought_signature` blobs
- **Displayed** in the dashboard as expandable "Auditor Reasoning" and "Fixer Reasoning" panels

### Real-Time Dashboard

The Next.js dashboard connects to the backend via **Server-Sent Events (SSE)** for live streaming:

- **Live Feed** — terminal-style log output as the orchestrator runs
- **Healing History** — expandable table with severity badges, chain-of-thought, and Shiki-highlighted code diffs
- **Thinking Animation** — pulsing progress bars while the AI reasons
- **Dark "War Room" Aesthetic** — emerald (healed), amber (threats), red (critical)

### Vulnerability Lab

The `test_lab/` directory contains 13 deliberately planted vulnerabilities across 3 files:

| File | Type | Count | Tests |
|---|---|---|---|
| `sql_lab.py` | SQL Injection | 3 | f-string, concatenation, `.format()` |
| `secret_lab.js` | Hardcoded Secrets | 5 | API keys, DB passwords, JWT, AWS creds |
| `logic_lab.py` | Broken Auth | 5 | Logic flaws, timing attacks, session fixation |

### Integration Test Suite

`scripts/run_integration_test.py` provides automated validation:

- **Phase 1** — Pre-flight cleanup (restore golden copies)
- **Phase 2** — Execute the full orchestrator cycle
- **Phase 3** — Post-flight verification (mutations, backups, manifest, reasoning quality)
- **Phase 4** — Hackathon Readiness Report with ASCII art verdict

---

## Tech Stack

| Component | Technology |
|---|---|
| LLM | Google Gemini 3 Pro Preview (`google-genai` SDK, `thinking_level=HIGH`) |
| Backend | FastAPI + Uvicorn, SSE streaming |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS v4 |
| Syntax Highlighting | Shiki (github-dark-default theme) |
| UI Components | Shadcn/UI patterns, Lucide icons |
| Validation | Pydantic v2 |
| Config | python-dotenv |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/scan` | Start a scan (SSE stream of log/vuln/patch/summary events) |
| `GET` | `/api/v1/history` | Retrieve the latest `run_manifest.json` |
| `GET` | `/health` | Service health check |

---

## Hackathon

**Gemini 3 Hackathon** — *Build what's next*
- Deadline: **Feb 9, 2026 @ 5:00 PM PST**
- [gemini3.devpost.com](https://gemini3.devpost.com/)

---

## License

MIT
