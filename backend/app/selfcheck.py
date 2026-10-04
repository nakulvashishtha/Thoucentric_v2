"""Self-check (section 5): every configuration mistake shows as a red item with the exact fix. No secrets are shown."""
from __future__ import annotations

import logging

import anthropic
import httpx
from sqlalchemy import text

from . import budget
from .db.session import get_engine
from .settings import data_dir, effective_mode, env

log = logging.getLogger("workbench")


def _item(key: str, label: str, ok: bool | None, detail: str, fix: str = "") -> dict:
    return {"key": key, "label": label, "ok": ok, "detail": detail, "fix": "" if ok else fix}


def check_database() -> dict:
    try:
        (data_dir() / ".write-test").write_text("ok", encoding="utf-8")
        (data_dir() / ".write-test").unlink()
        with get_engine().begin() as conn:
            conn.execute(text("CREATE TABLE IF NOT EXISTS selfcheck_probe (x INTEGER)"))
            conn.execute(text("INSERT INTO selfcheck_probe (x) VALUES (1)"))
            conn.execute(text("DELETE FROM selfcheck_probe"))
        return _item("database", "Database can be written", True, f"Saving cases in {data_dir()}")
    except Exception as e:  # noqa: BLE001
        return _item("database", "Database can be written", False, f"Writing failed ({type(e).__name__}).",
                     "Set DATA_DIR to a folder the app can write to (for example ./data), then restart the service.")


def check_passcode() -> dict:
    if env("ADMIN_PASSCODE"):
        return _item("passcode", "Passcode is set", True, "The app asks for the passcode before anything else.")
    return _item("passcode", "Passcode is set", False, "Anyone with the address can open the app.",
                 "Add ADMIN_PASSCODE in the hosting settings (any phrase you choose), then restart the service.")


def check_mode() -> dict:
    mode, notice = effective_mode()
    if mode == "live":
        return _item("mode", "Data mode", None, "Live: real AI and search calls.")
    return _item("mode", "Data mode", None, "Demo data: stored answers for the sample cases only."
                 + (f" {notice}." if notice else ""))


async def check_model(var: str) -> dict:
    label = f"AI model in {var} works"
    model = env(var)
    if not env("ANTHROPIC_API_KEY"):
        return _item(var, label, False, "No AI key, so the model can't be checked.",
                     "Add ANTHROPIC_API_KEY from the Claude Console (platform.claude.com), then run the checks again.")
    if not model:
        return _item(var, label, False, f"{var} is empty.",
                     f"Set {var} to a model name from the Claude Console model list, for example "
                     + ("claude-haiku-4-5." if var == "MODEL_FAST" else "claude-sonnet-5-5."))
    try:
        client = anthropic.AsyncAnthropic(timeout=30.0, max_retries=0)
        r = await client.messages.create(model=model, max_tokens=16, messages=[{"role": "user", "content": "Say ok."}])
        budget.record_llm(None, "SELFCHECK", model, r.usage.input_tokens or 0, r.usage.output_tokens or 0)
        return _item(var, label, True, f"{model} answered.")
    except anthropic.AuthenticationError:
        return _item(var, label, False, "The AI key was refused.",
                     "Copy a fresh key from the Claude Console into ANTHROPIC_API_KEY, then restart the service.")
    except anthropic.PermissionDeniedError:
        return _item(var, label, False, "The key can't use this model.",
                     "Check the key's workspace has access to this model in the Claude Console.")
    except anthropic.NotFoundError:
        return _item(var, label, False, f"The model name '{model}' wasn't recognised.",
                     f"Copy the exact model name from the Claude Console model list into {var}.")
    except anthropic.APIStatusError as e:
        return _item(var, label, False, f"The AI service answered with an error ({e.status_code}).",
                     "Wait a minute and run the checks again. If it stays red, check the account's credit balance.")
    except (anthropic.APIConnectionError, anthropic.APITimeoutError):
        return _item(var, label, False, "The AI service couldn't be reached.",
                     "Check the server has internet access, then run the checks again.")


async def check_search() -> dict:
    label = "Search key works"
    key = env("TAVILY_API_KEY")
    if not key:
        return _item("search", label, False, "No search key.",
                     "Add TAVILY_API_KEY from tavily.com (the free plan is enough), then run the checks again.")
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {key}"},
                             json={"query": "official statistics", "search_depth": "basic", "max_results": 1})
    except httpx.HTTPError:
        return _item("search", label, False, "The search service couldn't be reached.",
                     "Check the server has internet access, then run the checks again.")
    if r.status_code in (401, 403):
        return _item("search", label, False, "The search key was refused.",
                     "Copy the key again from your tavily.com dashboard into TAVILY_API_KEY, then restart the service.")
    if r.status_code >= 400:
        return _item("search", label, False, f"The search service answered with an error ({r.status_code}).",
                     "Check the plan's credit balance on tavily.com, then run the checks again.")
    budget.record_search(None, "selfcheck", 1)
    return _item("search", label, True, "A test search worked.")


async def run(live_calls: bool = True) -> dict:
    items = [check_database(), check_passcode(), check_mode()]
    if live_calls:
        items += [await check_model("MODEL_FAST"), await check_model("MODEL_SMART"), await check_search()]
    st = budget.status(None)
    items.append(_item("spend", "Spending today", None,
                       f"${st['today_usd']:.2f} of the ${st['daily_cap_usd']:g} daily limit."))
    red = [i for i in items if i["ok"] is False]
    return {"items": items, "all_green": not red, "red": len(red)}


async def log_at_startup() -> None:
    """Run once at startup and log the result. Live calls are made only when both keys are present."""
    try:
        live = bool(env("ANTHROPIC_API_KEY") and env("TAVILY_API_KEY"))
        res = await run(live_calls=live)
        for i in res["items"]:
            state = "OK" if i["ok"] else ("INFO" if i["ok"] is None else "RED")
            log.info("Self-check %s: %s. %s", state, i["label"], i["detail"])
    except Exception:  # noqa: BLE001  (a self-check must never stop the app starting)
        log.exception("Self-check could not run")
