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

    @classmethod
    def validate(cls) -> None:
        """Raise early if critical config is missing."""
        if not cls.GEMINI_API_KEY:
            raise EnvironmentError(
                "GEMINI_API_KEY is not set. "
                "Copy .env.template to .env and add your key."
            )


settings = Settings()
