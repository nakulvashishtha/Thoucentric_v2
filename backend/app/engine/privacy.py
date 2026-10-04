"""Privacy: deny-list, hard outbound filter and LLM-side name replacement (section 8.9)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .convert import _to_float, value_tokens

_UNIT_HINT = re.compile(r"(%|₹|\$|€|£|rs\.?|inr|usd|eur|gbp|lakh|crore|million|billion|bn|mn|cards?|months?|"
                        r"years?|days?|customers?|units?|per\b)", re.I)


@dataclass
class DenyList:
    terms: list[str] = field(default_factory=list)       # names and aliases
    numbers: list[float] = field(default_factory=list)   # private values
    number_labels: dict[float, str] = field(default_factory=dict)


def _excluded(v: float, marked_private: bool) -> bool:
    if 1900 <= v <= 2100 and float(v).is_integer():
        return True                         # four-digit years always pass
    if float(v).is_integer() and v < 100 and not marked_private:
        return True                         # small plain integers pass unless marked private
    return False


def _values_in(text: str) -> list[float]:
    vals: list[float] = []
    for m in re.finditer(r"\d+(?:[.,]\d+)*", text):
        try:
            vals.append(_to_float(m.group(0)))
        except ValueError:
            pass
    return vals


def build_deny_list(client_name: str, aliases: list[str], private_numbers: list[str],
                    client_file_figures: list[str]) -> DenyList:
    dl = DenyList()
    for t in [client_name, *aliases]:
        t = (t or "").strip()
        if len(t) >= 2 and t.lower() not in [x.lower() for x in dl.terms]:
            dl.terms.append(t)
    for raw in private_numbers:                  # entered at step 1: marked private by the consultant
        for v in set(value_tokens(raw)) | set(_values_in(raw)):
            if not _excluded(v, marked_private=True):
                dl.numbers.append(v)
                dl.number_labels[v] = raw.strip()
    for raw in client_file_figures:              # only figures carrying a unit or currency symbol
        if not _UNIT_HINT.search(raw or ""):
            continue
        for v in set(_values_in(raw)):
            # a figure that carries a unit is not a "plain" integer, so only years are excluded
            if not _excluded(v, marked_private=True):
                dl.numbers.append(v)
                dl.number_labels.setdefault(v, raw.strip())
    return dl


def check(text: str, dl: DenyList) -> list[str]:
    """Return blocked terms found in text. An empty list means the text may leave."""
    hits: list[str] = []
    low = (text or "").lower()
    for t in dl.terms:
        if re.search(rf"(?<![a-z0-9]){re.escape(t.lower())}(?![a-z0-9])", low):
            hits.append(t)
    found = set(value_tokens(text)) | set(_values_in(text or ""))
    for v in dl.numbers:
        if any(abs(v - f) < 1e-9 for f in found):
            hits.append(dl.number_labels.get(v, str(v)))
    return list(dict.fromkeys(hits))


def sanitise(text: str, dl: DenyList) -> tuple[str, list[str]]:
    """Strip names (replaced with 'the client') and private numbers (replaced with '[private]')."""
    out = text or ""
    removed: list[str] = []
    for t in sorted(dl.terms, key=len, reverse=True):
        pat = re.compile(rf"(?<![A-Za-z0-9]){re.escape(t)}('s)?(?![A-Za-z0-9])", re.I)
        if pat.search(out):
            removed.append(t)
            out = pat.sub(lambda m: "the client" + ("'s" if m.group(1) else ""), out)
    def num_sub(m: re.Match) -> str:
        try:
            v = _to_float(m.group(0))
        except ValueError:
            return m.group(0)
        if any(abs(v - d) < 1e-9 for d in dl.numbers):
            removed.append(m.group(0))
            return "[private]"
        return m.group(0)
    out = re.sub(r"\d+(?:[.,]\d+)*", num_sub, out)
    out = re.sub(r"\b(The|the) the client\b", r"\1 client", out)
    out = re.sub(r"(^|[.!?]\s+)the client", lambda m: m.group(1) + "The client", out)
    return out, list(dict.fromkeys(removed))


def for_llm(text: str, dl: DenyList) -> str:
    """LLM calls see case data, but the client name and aliases become 'the client'."""
    out = text or ""
    for t in sorted(dl.terms, key=len, reverse=True):
        out = re.sub(rf"(?<![A-Za-z0-9]){re.escape(t)}(?![A-Za-z0-9])", "the client", out, flags=re.I)
    return out
