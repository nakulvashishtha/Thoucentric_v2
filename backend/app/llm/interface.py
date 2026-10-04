"""LLMClient interface. LiveLLM and FixtureLLM return raw JSON; run() validates with one retry."""
from __future__ import annotations

import logging

from abc import ABC, abstractmethod

from pydantic import BaseModel, ValidationError

from ..errors import JobFailure
from .schemas import SCHEMAS


class LLMClient(ABC):
    name = "base"

    @abstractmethod
    async def raw(self, job: str, key: str, payload: dict, case_id: int | None,
                  retry_error: str | None = None) -> dict:
        """Return the model's JSON reply for a job (not yet validated)."""


async def run(client: LLMClient, job: str, key: str, payload: dict, case_id: int | None = None) -> BaseModel:
    schema = SCHEMAS[job]
    out = await client.raw(job, key, payload, case_id)
    try:
        return schema.model_validate(out)
    except ValidationError as e:
        err = _short(e)
    out = await client.raw(job, key, payload, case_id, retry_error=err)
    try:
        return schema.model_validate(out)
    except ValidationError as e:
        logging.getLogger("workbench").warning("%s reply failed validation twice: %s", job, _short(e))
        raise JobFailure("The AI service gave an answer we couldn't use, twice. Nothing was made up. Press Try again, "
                         "or switch this case to demo data in Settings.")


def _short(e: ValidationError) -> str:
    errs = e.errors()[:3]
    return "; ".join(f"{'.'.join(str(p) for p in x['loc'])}: {x['msg']}" for x in errs)
