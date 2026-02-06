"""
Sentinel-G3 | Base Agent

Abstract base class that every specialised agent inherits from.
Handles Gemini client initialisation and shared utilities.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from google import genai
from google.genai import types

from app.config import settings


class BaseAgent(ABC):
    """Foundation for all Sentinel-G3 agents."""

    def __init__(self) -> None:
        self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self.model = settings.GEMINI_MODEL
        # Stores the most recent Gemini response for signature extraction
        self.last_response: types.GenerateContentResponse | None = None

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute the agent's primary task.

        Args:
            context: Arbitrary payload relevant to the agent's purpose.

        Returns:
            A result dict with findings, patches, or validation outcomes.
        """
        ...
