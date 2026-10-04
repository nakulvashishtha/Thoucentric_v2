"""Deterministic de-duplication (section 8.8): copies are traced to their original and counted once."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlsplit

_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ref$|source$|mc_|igshid$)")
_ORIGIN_RANK = {"benchmark": 0, "paid_db": 1, "firm_archive": 2, "open_web": 3, "client_file": 4, "expert_note": 4}


def normalise_url(url: str | None) -> str:
    if not url:
        return ""
    p = urlsplit(url.strip())
    host = (p.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    q = urlencode(sorted((k, v) for k, v in parse_qsl(p.query) if not _TRACKING.match(k.lower())))
    path = re.sub(r"/+$", "", p.path or "")
    return f"{host}{path}" + (f"?{q}" if q else "")


def text_hash(text: str | None) -> str:
    norm = re.sub(r"\s+", " ", (text or "").strip().lower())
    return hashlib.sha256(norm.encode()).hexdigest()


def normalise_name(name: str | None) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    s = re.sub(r"\b(the|of|ltd|limited|inc|plc|llp|pvt|private|report|data|study)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(text: str | None) -> set[str]:
    return set(re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", (text or "").lower()))


def similarity(a: str | None, b: str | None) -> float:
    """Token-set similarity: shared tokens over the smaller set."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def _figures_match(fa: list[tuple[float, float]], fb: list[tuple[float, float]]) -> bool:
    for (la, ha) in fa:
        for (lb, hb) in fb:
            if _close(la, lb) and _close(ha, hb):
                return True
    return False


def _close(a: float, b: float) -> bool:
    """Equal within rounding (1% relative)."""
    return abs(a - b) <= 0.01 * max(abs(a), abs(b)) + 1e-9


@dataclass
class DedupItem:
    id: str
    origin_type: str
    url: str = ""
    published: str = ""            # ISO-ish date for ordering; '' sorts last
    tier: int | None = None
    original_source_name: str = ""
    passage: str = ""
    figures: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class DedupResult:
    group_of: dict[str, str]                  # item id -> group id (the original's id)
    duplicate_of: dict[str, str | None]       # item id -> original id or None
    rule_of: dict[str, str]                   # item id -> which rule grouped it


def _primacy(item: DedupItem) -> tuple:
    tier = item.tier if item.tier is not None else 5
    return (tier, _ORIGIN_RANK.get(item.origin_type, 5), item.published or "9999", item.id)


def group_items(items: list[DedupItem], threshold: float = 0.8) -> DedupResult:
    """Union items that are copies of each other, then pick the earliest, most primary item as the original."""
    parent = {i.id: i.id for i in items}
    rule: dict[str, str] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str, why: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
            rule.setdefault(b, why)

    by_id = {i.id: i for i in items}
    ids = [i.id for i in items]
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            a, b = by_id[ids[x]], by_id[ids[y]]
            if a.origin_type in ("client_file", "expert_note") or b.origin_type in ("client_file", "expert_note"):
                continue  # client and expert material is never merged automatically
            if a.url and b.url and normalise_url(a.url) == normalise_url(b.url):
                union(a.id, b.id, "same address")
                continue
            na, nb = normalise_name(a.original_source_name), normalise_name(b.original_source_name)
            same_original = na and nb and na == nb
            # an item that names another item's publisher as its original is a copy of it
            if same_original and _figures_match(a.figures, b.figures):
                union(a.id, b.id, "names the same original source with a matching figure")
                continue
            if a.passage and b.passage and similarity(a.passage, b.passage) >= threshold:
                union(a.id, b.id, "near-identical text")
    groups: dict[str, list[DedupItem]] = {}
    for i in items:
        groups.setdefault(find(i.id), []).append(i)
    group_of: dict[str, str] = {}
    duplicate_of: dict[str, str | None] = {}
    rule_of: dict[str, str] = {}
    for members in groups.values():
        original = sorted(members, key=_primacy)[0]
        for m in members:
            group_of[m.id] = original.id
            duplicate_of[m.id] = None if m.id == original.id else original.id
            if m.id != original.id:
                rule_of[m.id] = rule.get(m.id) or next((rule[o.id] for o in members if o.id in rule), "copy")
    return DedupResult(group_of, duplicate_of, rule_of)


def pre_read_duplicates(items: list[tuple[str, str, str]]) -> dict[str, str]:
    """Before reading (saves cost): (id, url, text) -> {copy id: first id} by normalised URL or text hash."""
    seen_url: dict[str, str] = {}
    seen_hash: dict[str, str] = {}
    out: dict[str, str] = {}
    for iid, url, text in items:
        nu = normalise_url(url)
        h = text_hash(text) if text else ""
        if nu and nu in seen_url:
            out[iid] = seen_url[nu]
        elif h and h in seen_hash:
            out[iid] = seen_hash[h]
        else:
            if nu:
                seen_url[nu] = iid
            if h:
                seen_hash[h] = iid
    return out
