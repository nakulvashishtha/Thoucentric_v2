"""FixtureLLM: stored replies from a sample pack, matched by job name plus a stable key."""
from __future__ import annotations

import json
import re

from ..errors import JobFailure
from .interface import LLMClient

_PLACEHOLDER = re.compile(r"\{\{(seed|file):([^}]+)\}\}")


class FixtureLLM(LLMClient):
    name = "fixtures"

    def __init__(self, fixtures: dict):
        self.fixtures = fixtures

    async def raw(self, job, key, payload, case_id, retry_error=None):
        full = f"{job}:{key}" if key else job
        if full in self.fixtures:
            out = self.fixtures[full]
        elif job in self.fixtures and not key:
            out = self.fixtures[job]
        else:
            raise JobFailure(f"fixture missing: {full}")
        resolve = payload.get("_resolve") or {}
        return _resolve(json.loads(json.dumps(out)), resolve)


def _resolve(obj, mapping: dict):
    if isinstance(obj, str):
        return _PLACEHOLDER.sub(lambda m: mapping.get(f"{m.group(1)}:{m.group(2)}", m.group(0)), obj)
    if isinstance(obj, list):
        return [_resolve(x, mapping) for x in obj]
    if isinstance(obj, dict):
        return {k: _resolve(v, mapping) for k, v in obj.items()}
    return obj
