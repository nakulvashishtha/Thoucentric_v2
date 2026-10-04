"""Cost ledger and hard caps (section 14.1). Every live call is recorded; caps stop new calls with a clear message."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import func, select

from .db.models import CostLedger
from .db.session import session
from .errors import JobFailure
from .settings import env, prices


class CapReached(JobFailure):
    """A spending or call limit was reached. The job stops; nothing more is spent."""


def _num(name: str, default: float) -> float:
    try:
        return float(env(name, str(default)))
    except ValueError:
        return default


def limits() -> dict:
    return {"max_calls": int(_num("MAX_LLM_CALLS_PER_CASE", 150)), "daily_cap_usd": _num("DAILY_SPEND_CAP", 5.0),
            "max_search_credits": _num("MAX_SEARCH_CREDITS_PER_CASE", 40)}


def model_price(model: str) -> tuple[float, float]:
    p = prices()
    for key, v in (p.get("models") or {}).items():
        if key in (model or "").lower():
            return float(v["input"]), float(v["output"])
    d = p.get("default") or {"input": 3.0, "output": 15.0}
    return float(d["input"]), float(d["output"])


def record_llm(case_id: int | None, job: str, model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = model_price(model)
    cost = (input_tokens * pin + output_tokens * pout) / 1_000_000
    with session() as s:
        s.add(CostLedger(case_id=case_id, kind="llm", job=job, model=model, input_tokens=input_tokens,
                         output_tokens=output_tokens, cost_usd=round(cost, 6)))
        s.commit()
    return cost


def record_search(case_id: int | None, provider: str, credits: float = 1) -> float:
    cost = credits * float((prices().get("search") or {}).get("tavily_basic_credit_usd", 0.008))
    with session() as s:
        s.add(CostLedger(case_id=case_id, kind="search", job=provider, search_credits=credits, cost_usd=round(cost, 6)))
        s.commit()
    return cost


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def status(case_id: int | None) -> dict:
    lim = limits()
    with session() as s:
        today = s.exec(select(func.coalesce(func.sum(CostLedger.cost_usd), 0.0))
                       .where(CostLedger.ts >= _today())).one()
        case_usd = calls = credits = 0
        if case_id is not None:
            case_usd = s.exec(select(func.coalesce(func.sum(CostLedger.cost_usd), 0.0))
                              .where(CostLedger.case_id == case_id)).one()
            calls = s.exec(select(func.count()).select_from(CostLedger)
                           .where(CostLedger.case_id == case_id, CostLedger.kind == "llm")).one()
            credits = s.exec(select(func.coalesce(func.sum(CostLedger.search_credits), 0.0))
                             .where(CostLedger.case_id == case_id, CostLedger.kind == "search")).one()
    out = {"case_usd": round(float(case_usd), 4), "today_usd": round(float(today), 4),
           "daily_cap_usd": lim["daily_cap_usd"], "calls": int(calls), "max_calls": lim["max_calls"],
           "search_credits": float(credits), "max_search_credits": lim["max_search_credits"]}
    pairs = {"calls": (out["calls"], out["max_calls"]), "daily": (out["today_usd"], out["daily_cap_usd"]),
             "search": (out["search_credits"], out["max_search_credits"])}
    out["reached"] = [k for k, (a, b) in pairs.items() if b and a >= b]
    out["warn"] = [k for k, (a, b) in pairs.items() if b and 0.8 * b <= a < b]
    return out


def check_llm(case_id: int | None) -> None:
    st = status(case_id)
    if "daily" in st["reached"]:
        raise CapReached(f"Today's spending limit of ${st['daily_cap_usd']:g} is reached, so no more AI calls will be "
                         "made today. Raise DAILY_SPEND_CAP in the hosting settings, or switch this case to demo data.")
    if "calls" in st["reached"]:
        raise CapReached(f"This case has used its {st['max_calls']} AI calls, so no more will be made. Raise "
                         "MAX_LLM_CALLS_PER_CASE in the hosting settings, or start a new case.")


def check_search(case_id: int | None) -> None:
    st = status(case_id)
    if "daily" in st["reached"]:
        raise CapReached(f"Today's spending limit of ${st['daily_cap_usd']:g} is reached, so no more searches will be "
                         "made today. Raise DAILY_SPEND_CAP in the hosting settings, or switch this case to demo data.")
    if "search" in st["reached"]:
        raise CapReached(f"This case has used its {st['max_search_credits']:g} search credits. Keep what was found, "
                         "or raise MAX_SEARCH_CREDITS_PER_CASE in the hosting settings.")
