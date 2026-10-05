"""Configuration: environment variables and the YAML files in backend/config. Secrets are never logged."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml

BACKEND_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BACKEND_DIR / "config"
PROMPTS_DIR = BACKEND_DIR / "prompts"
SAMPLES_DIR = BACKEND_DIR / "samples"
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def _load_dotenv() -> None:
    """Read a local .env without printing anything. Real environment variables win."""
    env = BACKEND_DIR.parent / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def data_dir() -> Path:
    d = Path(env("DATA_DIR", "./data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def keys_present() -> dict[str, bool]:
    return {k: bool(env(k)) for k in ("ANTHROPIC_API_KEY", "TAVILY_API_KEY", "ADMIN_PASSCODE",
                                      "MODEL_FAST", "MODEL_SMART")}


def requested_mode() -> str:
    m = env("MODE", "live").lower()
    return m if m in ("live", "fixtures") else "live"


APP_SETTINGS_DEFAULTS = {"mode": "", "fast_demo": True, "larger_text": False, "double_check": True}


def app_settings() -> dict:
    """Settings changed in the settings drawer, kept in DATA_DIR (no secrets)."""
    import json
    p = data_dir() / "app_settings.json"
    try:
        return {**APP_SETTINGS_DEFAULTS, **json.loads(p.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        return dict(APP_SETTINGS_DEFAULTS)


def save_app_settings(changes: dict) -> dict:
    import json
    cur = app_settings()
    for k in APP_SETTINGS_DEFAULTS:
        if k in changes:
            cur[k] = changes[k]
    if cur["mode"] not in ("", "live", "fixtures"):
        cur["mode"] = ""
    (data_dir() / "app_settings.json").write_text(json.dumps(cur), encoding="utf-8")
    return cur


def effective_mode() -> tuple[str, str]:
    """Live is the default, but without both keys the app opens in fixtures mode with a notice."""
    if requested_mode() == "fixtures" or app_settings()["mode"] == "fixtures":
        return "fixtures", ""
    k = keys_present()
    if not (k["ANTHROPIC_API_KEY"] and k["TAVILY_API_KEY"]):
        return "fixtures", "Live keys not found"
    return "live", ""


def fixture_delay() -> float:
    try:
        return float(env("FIXTURE_DELAY", "0.12"))
    except ValueError:
        return 0.12


@lru_cache
def rules() -> dict:
    return yaml.safe_load((CONFIG_DIR / "rules.yaml").read_text(encoding="utf-8"))


@lru_cache
def registry() -> dict:
    return yaml.safe_load((CONFIG_DIR / "source_registry.yaml").read_text(encoding="utf-8"))


@lru_cache
def prices() -> dict:
    return yaml.safe_load((CONFIG_DIR / "prices.yaml").read_text(encoding="utf-8"))


def country_code(country: str | None) -> str | None:
    """Map a free-text country to a registry pack key, using the names listed in the registry."""
    c = (country or "").strip()
    packs = registry().get("countries") or {}
    if c.upper() in packs:
        return c.upper()
    for code, pack in packs.items():
        if c.lower() in [n.lower() for n in pack.get("names") or []]:
            return code
    return None
