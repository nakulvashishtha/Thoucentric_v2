"""Sample packs: data only, used for tests, demos and fixtures mode."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .settings import SAMPLES_DIR


def names() -> list[str]:
    return sorted(p.name for p in SAMPLES_DIR.iterdir() if (p / "case.json").exists())


def _dir(name: str) -> Path:
    d = SAMPLES_DIR / name
    if not (d / "case.json").exists():
        raise KeyError(name)
    return d


@lru_cache
def load(name: str) -> dict:
    d = _dir(name)
    pack = {"name": name,
            "case": json.loads((d / "case.json").read_text(encoding="utf-8")),
            "seeds": json.loads((d / "seed_evidence.json").read_text(encoding="utf-8"))["seeds"],
            "fixtures": json.loads((d / "llm_fixtures.json").read_text(encoding="utf-8")),
            "script": json.loads((d / "consultant_script.json").read_text(encoding="utf-8"))}
    seed_txt = (d / "seed.txt").read_text(encoding="utf-8").strip()
    pack["seed"] = int(seed_txt) if seed_txt.isdigit() else 0
    return pack


def file_bytes(name: str, filename: str, folder: str = "client_files") -> bytes:
    p = _dir(name) / folder / filename
    if not p.exists() or p.parent.name != folder:
        raise KeyError(filename)
    return p.read_bytes()


def listing() -> list[dict]:
    out = []
    for n in names():
        c = load(n)["case"]
        out.append({"name": n, "title": c.get("title", n), "description": c.get("description", ""),
                    "country": c["details"].get("country"), "industry": c["details"].get("industry")})
    return out
