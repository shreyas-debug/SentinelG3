"""
Sentinel-G3 | Configuration

Loads environment variables and exposes app-wide settings.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_env_path)


class Settings:
    """Centralised application settings sourced from environment variables."""

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")

    # Gemini model identifiers (update when new models land)
    # Primary model — Flash first (higher free-tier quota, faster)
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    # Fallback model — Pro for deeper reasoning if Flash quota exhausted
    GEMINI_FALLBACK_MODEL: str = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3-pro-preview")

    # Path traversal guard: semicolon-separated list of allowed scan roots
    # Example: "C:\\Users\\Me\\Projects;D:\\Work\\Repos"
    # If empty, all local paths are allowed (use with caution)
    ALLOWED_SCAN_ROOTS: str = os.getenv("ALLOWED_SCAN_ROOTS", "")

    # CORS origins: comma-separated list of allowed origins
    # Example: "https://sentinel-g3.vercel.app,https://myapp.com"
    # Defaults to "*" for development. Set explicitly for production.
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "*")

    # Maximum number of files to scan in parallel (semaphore concurrency)
    MAX_CONCURRENT_SCANS: int = int(os.getenv("MAX_CONCURRENT_SCANS", "3"))

    @classmethod
    def validate(cls) -> None:
        """Raise early if critical config is missing."""
        if not cls.GEMINI_API_KEY:
            raise EnvironmentError(
                "GEMINI_API_KEY is not set. "
                "Copy .env.template to .env and add your key."
            )

    @classmethod
    def get_allowed_origins(cls) -> list[str]:
        """Return CORS origins as a list. '*' means all origins."""
        if cls.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in cls.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
