"""LLMClient interface. LiveLLM and FixtureLLM return raw JSON; run() validates with one retry."""
from __future__ import annotations

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
        raise JobFailure(f"The language model's reply for {job.replace('_', ' ').lower()} did not have the "
                         f"expected shape twice ({_short(e)}). Nothing was invented; press Retry.")


def _short(e: ValidationError) -> str:
    errs = e.errors()[:3]
    return "; ".join(f"{'.'.join(str(p) for p in x['loc'])}: {x['msg']}" for x in errs)
