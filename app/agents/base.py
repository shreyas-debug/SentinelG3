"""
Sentinel-G3 | Base Agent

Abstract base class that every specialised agent inherits from.
Handles Gemini client initialisation and shared utilities.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Foundation for all Sentinel-G3 agents."""

    def __init__(self) -> None:
        self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self.model = settings.GEMINI_MODEL
        self.fallback_model = settings.GEMINI_FALLBACK_MODEL
        self._using_fallback = False
        # Stores the most recent Gemini response for signature extraction
        self.last_response: types.GenerateContentResponse | None = None

    @property
    def active_model(self) -> str:
        """Return the model currently in use (primary or fallback)."""
        return self.fallback_model if self._using_fallback else self.model

    def switch_to_fallback(self) -> bool:
        """Switch to the fallback model. Returns True if switch occurred."""
        if self._using_fallback:
            return False  # already on fallback
        if self.model == self.fallback_model:
            return False  # same model, no point switching
        self._using_fallback = True
        logger.warning(
            "⚡ Switching from %s → %s (fallback)",
            self.model, self.fallback_model,
        )
        return True

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute the agent's primary task.

        Args:
            context: Arbitrary payload relevant to the agent's purpose.

        Returns:
            A result dict with findings, patches, or validation outcomes.
        """
        ...
