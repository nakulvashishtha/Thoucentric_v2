"""Figure verification (section 8.10) and locator checks for coverage tags. Pure functions."""
from __future__ import annotations

import re

from .convert import value_tokens


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace("–", "-")).strip().lower()


_CELL = re.compile(r"^(?:(?P<sheet>[^!\[\]]+)!)?(?P<cell>[A-Z]{1,3}\d{1,6})$", re.I)


def locate(text: str, locator: str) -> str | None:
    """Return the text at a locator (a cell like 'B4' or 'Sheet!B4', 'line 3', 'para 2', 'page 1').

    None if the locator does not exist in the source text.
    """
    loc = (locator or "").strip()
    if not loc:
        return None
    m = _CELL.match(loc)
    if m:
        marker = f"[{loc}]"
        idx = text.lower().find(marker.lower())
        if idx < 0 and not m.group("sheet"):
            # csv cells have no sheet prefix; also accept 'B4' against any sheet in an xlsx
            hit = re.search(rf"\[(?:[^\]!]+!)?{re.escape(m.group('cell'))}\]", text, re.I)
            idx = hit.start() if hit else -1
            marker = hit.group(0) if hit else marker
        if idx < 0:
            return None
        rest = text[idx + len(marker):]
        end = min([p for p in (rest.find(" | "), rest.find("\n")) if p >= 0] or [len(rest)])
        return rest[:end].strip()
    m = re.match(r"^line\s+(\d+)$", loc, re.I)
    if m:
        hit = re.search(rf"\[line {m.group(1)}\] (.*)", text)
        return hit.group(1) if hit else None
    m = re.match(r"^(para|paragraph)\s+(\d+)$", loc, re.I)
    if m:
        paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
        i = int(m.group(2)) - 1
        return paras[i] if 0 <= i < len(paras) else None
    m = re.match(r"^page\s+(\d+)$", loc, re.I)
    if m:
        pages = re.split(r"\[page \d+\]", text)
        i = int(m.group(1))
        return pages[i] if 0 < i < len(pages) else None
    return None


def _value_in(values: list[float], target: float) -> bool:
    return any(abs(v - target) <= max(1e-9, abs(target) * 1e-6) for v in values)


def verify_figure(text: str, fig: dict) -> tuple[bool, str]:
    """A figure is verified only if its value appears within the quoted span at the stated location."""
    quote = fig.get("quote_span") or ""
    if not quote.strip():
        return False, "no quote given"
    if _norm(quote) not in _norm(text):
        return False, "quote not found in the source"
    loc = fig.get("locator") or ""
    if loc:
        at = locate(text, loc)
        if at is None:
            return False, f"location {loc} not found"
        if _norm(quote) not in _norm(at) and _norm(at) not in _norm(quote):
            return False, f"quote is not at {loc}"
    vals = value_tokens(quote)
    targets = [fig["value"]] if fig.get("value") is not None else [fig.get("low"), fig.get("high")]
    for t in targets:
        if t is None or not _value_in(vals, float(t)):
            return False, "figure not in the quoted text"
    return True, f"found at {loc}" if loc else "found in the quoted text"
