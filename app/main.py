"""
Sentinel-G3 | FastAPI Application Entry-Point

Run with:
    uvicorn app.main:app --reload
"""

from __future__ import annotations

# Load repo `.env` before any `app.*` import runs (avoids env being read too early).
from pathlib import Path as _PathForEnv
from dotenv import load_dotenv as _load_dotenv_early

_env_early = _PathForEnv(__file__).resolve().parent.parent / ".env"
_load_dotenv_early(dotenv_path=_env_early, override=True)

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.report import router as report_router
from app.api.routes import router as api_router
from app.config import ENV_FILE_PATH, settings

# ── Logging ─────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(levelname)s:%(name)s: %(message)s",
)

# ── Rate Limiter ────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Sentinel-G3",
    description="Autonomous self-healing security auditor powered by Gemini 3.",
    version="0.1.0",
)

# ── Rate Limit Error Handler ────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS (configurable via ALLOWED_ORIGINS env var) ─────
_origins = settings.get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ──────────────────────────────────────────────
app.include_router(api_router,    prefix="/api/v1")
app.include_router(report_router, prefix="/api/v1")


# ── Lifecycle Events ────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    """Validate configuration on boot."""
    settings.validate()


@app.get("/health", tags=["meta"])
async def health_check():
    """Liveness probe.

    In development, includes non-sensitive hints so you can confirm the backend
    picked up ``.env`` (e.g. dashboard pointed at Render will still show quota
    for the *remote* key, not this process).
    """
    body: dict = {"status": "ok", "service": "sentinel-g3"}
    if settings.APP_ENV.strip().lower() == "development":
        body["env_file"] = str(ENV_FILE_PATH)
        body["env_file_exists"] = ENV_FILE_PATH.is_file()
        body["gemini_api_key_length"] = len(settings.GEMINI_API_KEY or "")
    return body
