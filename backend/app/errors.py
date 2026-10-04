"""Errors the API turns into plain responses."""
from __future__ import annotations


class GateError(Exception):
    """A step gate is not met: HTTP 409 with {reason, required}."""

    def __init__(self, reason: str, required: list[str] | None = None):
        super().__init__(reason)
        self.reason = reason
        self.required = required or []


class NotFound(Exception):
    pass


class BadInput(Exception):
    pass


class JobFailure(Exception):
    """A job failed with a plain-language message (never a stack trace)."""
