"""Source credibility grading: tier, recency and traced. The rule engine grades; the LLM never does."""
from __future__ import annotations

import fnmatch
import re
from datetime import date

TIER_LABELS = {1: "Official", 2: "Trusted", 3: "Press", 4: "Unverified"}
PERSON_DECIDED_ORIGINS = {"client_file", "expert_note"}

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def normalise_domain(domain_or_url: str | None) -> str:
    d = (domain_or_url or "").strip().lower()
    d = re.sub(r"^[a-z]+://", "", d)
    d = d.split("/")[0].split(":")[0]
    return d[4:] if d.startswith("www.") else d


def _match(domain: str, pattern: str) -> bool:
    p = pattern.lower()
    if p.startswith("*."):
        base = p[2:]
        if "*" in base:
            return any(fnmatch.fnmatch(".".join(domain.split(".")[i:]), base) for i in range(1, len(domain.split("."))))
        return domain.endswith("." + base) or domain == base
    if "*" in p:
        return fnmatch.fnmatch(domain, p)
    return domain == p or domain.endswith("." + p)


def registry_tier(domain: str, registry: dict, country: str | None = None,
                  industry: str | None = None) -> tuple[int, str] | None:
    """Most specific pack first: industry, then country, then global."""
    packs: list[tuple[str, dict]] = []
    if industry and industry.lower() in {k.lower() for k in (registry.get("industries") or {})}:
        key = next(k for k in registry["industries"] if k.lower() == industry.lower())
        packs.append((f"industry pack '{key}'", registry["industries"][key]))
    if country and country.upper() in (registry.get("countries") or {}):
        packs.append((f"country pack {country.upper()}", registry["countries"][country.upper()]))
    packs.append(("global registry", registry.get("global") or {}))
    for pack_name, pack in packs:
        for tier in (1, 2, 3, 4):
            for pat in pack.get(f"tier{tier}") or []:
                if _match(domain, pat):
                    return tier, f"{domain} matches '{pat}' in the {pack_name}"
    return None


def grade_tier(domain: str | None, origin_type: str, registry: dict, country: str | None = None,
               industry: str | None = None, plan_overrides: dict[str, tuple[int, str]] | None = None
               ) -> tuple[int | None, str]:
    """Return (tier, reason). Client files and expert notes have no tier: always person-decided."""
    if origin_type in PERSON_DECIDED_ORIGINS:
        return None, "Client and expert material has no tier; a person always decides"
    if origin_type in ("firm_archive", "paid_db"):
        label = "firm archive" if origin_type == "firm_archive" else "paid research database"
        return 2, f"Source is the {label} (Tier 2 by type)"
    d = normalise_domain(domain)
    for pat, (tier, reason) in (plan_overrides or {}).items():
        if d and _match(d, normalise_domain(pat)):
            return tier, f"Added to the source plan by the consultant as Tier {tier}: {reason}"
    if d:
        hit = registry_tier(d, registry, country, industry)
        if hit:
            return hit
    return 4, f"{d or 'Unknown source'} is not in the source registry (unknown domains are Tier 4)"


def parse_date(text: str | None, today: date) -> date | None:
    """Parse common date forms in code. Unparseable or future dates count as missing."""
    if not text:
        return None
    s = str(text).strip().lower()
    d: date | None = None
    m = re.fullmatch(r"((?:19|20)\d{2})-(\d{1,2})(?:-(\d{1,2}))?", s)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3) or 1))
        except ValueError:
            return None
    else:
        m = re.fullmatch(r"(?:(\d{1,2})\s+)?([a-z]{3})[a-z]*\.?\s+((?:19|20)\d{2})", s)
        if m and m.group(2) in _MONTHS:
            try:
                d = date(int(m.group(3)), _MONTHS[m.group(2)], int(m.group(1) or 1))
            except ValueError:
                return None
        else:
            m = re.fullmatch(r"((?:19|20)\d{2})", s)
            if m:
                d = date(int(m.group(1)), 1, 1)
    if d is None or d > today:
        return None
    return d


def months_between(earlier: date, later: date) -> int:
    return (later.year - earlier.year) * 12 + (later.month - earlier.month)


def recency(data_as_of: str | None, published_date: str | None, window_months: int, today: date
            ) -> tuple[bool, str]:
    """Use data_as_of, else published_date. A missing date fails recency."""
    d = parse_date(data_as_of, today) or parse_date(published_date, today)
    if d is None:
        return False, "no usable date"
    age = months_between(d, today)
    return age <= window_months, f"{d.isoformat()[:7]} ({age} months old)"


def traced(tier: int | None, method_cited: bool, original_named: bool) -> bool:
    return tier == 1 or bool(method_cited) or bool(original_named)


def tier_label(tier: int | None) -> str:
    return "Your call" if tier is None else TIER_LABELS[tier]
