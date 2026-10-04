"""LiveLLM: Anthropic calls with JSON-schema output, a reply cache, the cost ledger and caps.

The model only reads, writes and sorts. Replies are validated in interface.run(), with one retry.
"""
from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache

import anthropic
from anthropic import transform_schema

from .. import budget
from ..db.models import Case, LlmCache
from ..db.session import session
from ..errors import JobFailure
from ..settings import PROMPTS_DIR, env
from .interface import LLMClient
from .schemas import SCHEMAS, SMART_JOBS

log = logging.getLogger("workbench")

# tight per-job output limits (cost control); the smart model also thinks, so it gets more room
MAX_TOKENS = {"FRAME": 4000, "PLAN_HYPOTHESES": 8000, "DRAFT_FOLLOWUP": 4000, "SUMMARISE": 6000,
              "ROUTE_NEEDS": 3000, "GENERATE_QUERIES": 300, "READ_SOURCE": 1500, "LINK_EVIDENCE": 800,
              "UNKNOWNS": 800}
CALL_TIMEOUT = 40.0


@lru_cache
def prompt(job: str) -> tuple[str, str]:
    """System prompt for a job and its version. Prompts are versioned files in backend/prompts."""
    common = (PROMPTS_DIR / "_common.md").read_text(encoding="utf-8").strip()
    text = (PROMPTS_DIR / f"{job}.md").read_text(encoding="utf-8").strip()
    first, _, body = text.partition("\n")
    version = first.split(":", 1)[1].strip() if first.lower().startswith("version:") else "0"
    return f"{common}\n\n{body.strip()}", version


def model_for(job: str) -> str:
    return env("MODEL_SMART") if job in SMART_JOBS else env("MODEL_FAST")


_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(timeout=CALL_TIMEOUT, max_retries=1)
    return _client


def _flag_failure(case_id: int | None, failed: bool) -> None:
    """Count live failures in a row, so the page can offer demo data after two."""
    if case_id is None:
        return
    with session() as s:
        c = s.get(Case, case_id)
        if not c:
            return
        st = dict(c.settings_json or {})
        st["live_failures"] = (st.get("live_failures", 0) + 1) if failed else 0
        c.settings_json = st
        s.add(c)
        s.commit()


def _bypass_cache(case_id: int | None) -> bool:
    if case_id is None:
        return False
    with session() as s:
        c = s.get(Case, case_id)
        return bool(c and (c.settings_json or {}).get("bypass_cache"))


def cache_key(job: str, model: str, version: str, payload: dict, retry_error: str | None) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(f"{job}|{model}|{version}|{canonical}|{retry_error or ''}".encode()).hexdigest()


class LiveLLM(LLMClient):
    name = "live"

    async def raw(self, job, key, payload, case_id, retry_error=None):
        payload = {k: v for k, v in payload.items() if not k.startswith("_")}
        model = model_for(job)
        if not model:
            raise JobFailure("The AI model name isn't set. Add MODEL_FAST and MODEL_SMART in the hosting settings, "
                             "then open Settings and press Run checks.")
        system, version = prompt(job)
        ck = cache_key(job, model, version, payload, retry_error)
        if not _bypass_cache(case_id):
            with session() as s:
                hit = s.get(LlmCache, ck)
                if hit is not None:
                    return hit.output_json
        budget.check_llm(case_id)
        data = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
        user = f"Case data for this task:\n<untrusted>\n{data}\n</untrusted>"
        if retry_error:
            user += f"\n\nYour last reply did not match the schema ({retry_error}). Reply again with valid JSON."
        output_config: dict = {"format": {"type": "json_schema", "schema": transform_schema(SCHEMAS[job])}}
        if job in SMART_JOBS and "haiku" not in model.lower():
            output_config["effort"] = "medium"
        try:
            resp = await client().messages.create(
                model=model, max_tokens=MAX_TOKENS.get(job, 2000), system=system,
                messages=[{"role": "user", "content": user}], output_config=output_config)
        except anthropic.AuthenticationError:
            _flag_failure(case_id, True)
            raise JobFailure("The AI service refused the key. Check ANTHROPIC_API_KEY, then open Settings and press "
                             "Run checks.")
        except anthropic.NotFoundError:
            _flag_failure(case_id, True)
            raise JobFailure(f"The AI service doesn't know the model '{model}'. Check MODEL_FAST and MODEL_SMART, "
                             "then open Settings and press Run checks.")
        except anthropic.RateLimitError:
            _flag_failure(case_id, True)
            raise JobFailure("The AI service is busy right now. Wait a minute and press Try again.")
        except (anthropic.APITimeoutError, anthropic.APIConnectionError):
            _flag_failure(case_id, True)
            raise JobFailure("The AI service didn't answer in time. Press Try again, or switch this case to demo data.")
        except anthropic.APIStatusError as e:
            _flag_failure(case_id, True)
            log.warning("AI call for %s failed with status %s", job, e.status_code)
            raise JobFailure("The AI service returned an error. Press Try again in a moment.")
        _flag_failure(case_id, False)
        usage = resp.usage
        budget.record_llm(case_id, job, model, usage.input_tokens or 0, usage.output_tokens or 0)
        if resp.stop_reason == "refusal":
            raise JobFailure("The AI service declined to read this item. Remove it, or continue without it.")
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            out = json.loads(text)
        except ValueError:
            return {"_unreadable_reply": text[:200]}           # fails validation, which retries once
        if resp.stop_reason != "max_tokens":
            with session() as s:
                s.merge(LlmCache(key=ck, job=job, model=model, prompt_version=version, output_json=out))
                s.commit()
        return out
