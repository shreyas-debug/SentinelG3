"""
Sentinel-G3 | FastAPI Application Entry-Point

Run with:
    uvicorn app.main:app --reload
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.config import settings

app = FastAPI(
    title="Sentinel-G3",
    description="Autonomous self-healing security auditor powered by Gemini 3.",
    version="0.1.0",
)

# ── CORS (allow dashboard dev server) ───────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ──────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")


# ── Lifecycle Events ────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    """Validate configuration on boot."""
    settings.validate()


@app.get("/health", tags=["meta"])
async def health_check():
    """Liveness probe."""
    return {"status": "ok", "service": "sentinel-g3"}
