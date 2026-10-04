"""Live search: Tavily web search, the firm archive and a guarded page fetcher.

The private-term filter runs right before every outbound call. Unticked sources are never searched.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from sqlmodel import select

from .. import budget
from ..db.models import SearchCache, SourcePlanItem
from ..db.session import session
from ..engine import credibility, privacy
from ..errors import JobFailure
from ..settings import env
from . import archive
from .base import SearchProvider, SearchResult

TAVILY_URL = "https://api.tavily.com/search"
FETCH_TIMEOUT = 10.0
FETCH_MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 20000


class Blocked(Exception):
    pass


# ---------------------------------------------------------------- SSRF guard and page fetch

def _check_host(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise Blocked("the address could not be found")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
                or ip.is_unspecified):
            raise Blocked("the address points inside a private network")


def check_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise Blocked("only http and https web addresses can be read")
    _check_host(u.hostname)


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in ("p", "br", "li", "h1", "h2", "h3", "tr", "div"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _Text()
    p.feed(html)
    lines = [" ".join(ln.split()) for ln in "".join(p.parts).splitlines()]
    return "\n\n".join(ln for ln in lines if ln)


async def fetch_page(url: str, deny: privacy.DenyList | None = None) -> str:
    """Fetch a page returned by search. Blocks private networks (also after redirects), 10 s, 2 MB."""
    if deny is not None and privacy.check(url, deny):
        raise Blocked("the address contains a private term")
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as c:
        for _ in range(4):
            check_url(url)
            async with c.stream("GET", url, headers={"User-Agent": "ResearchWorkbench/1.0"}) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise Blocked(f"the page answered {r.status_code}")
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > FETCH_MAX_BYTES:
                        break
                kind = r.headers.get("content-type", "")
                text = body.decode(r.encoding or "utf-8", errors="replace")
                return (html_to_text(text) if "html" in kind else text)[:MAX_TEXT]
        raise Blocked("too many redirects")


# ---------------------------------------------------------------- Tavily

def _cache_get(key: str):
    with session() as s:
        hit = s.get(SearchCache, key)
        return hit.response_json if hit else None


def _cache_put(key: str, provider: str, data) -> None:
    with session() as s:
        s.merge(SearchCache(key=key, provider=provider, response_json=data))
        s.commit()


async def tavily(query: str, include: list[str], exclude: list[str], limit: int, case_id: int | None) -> list[dict]:
    key = env("TAVILY_API_KEY")
    if not key:
        raise JobFailure("The search key isn't set. Add TAVILY_API_KEY in the hosting settings, then open Settings "
                         "and press Run checks.")
    body = {"query": query, "search_depth": "basic", "max_results": max(1, min(limit + 1, 5)),
            "include_raw_content": True}
    if include:
        body["include_domains"] = include
    if exclude:
        body["exclude_domains"] = exclude
    ck = hashlib.sha256(("tavily|" + json.dumps(body, sort_keys=True)).encode()).hexdigest()
    cached = _cache_get(ck)
    if cached is not None:
        return cached
    budget.check_search(case_id)
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(TAVILY_URL, json=body, headers={"Authorization": f"Bearer {key}"})
            if r.status_code >= 500:                                     # one retry, never a loop
                r = await c.post(TAVILY_URL, json=body, headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError:
        raise JobFailure("The search service didn't answer. Press Try again, or switch this case to demo data.")
    if r.status_code in (401, 403):
        raise JobFailure("The search service refused the key. Check TAVILY_API_KEY, then open Settings and press "
                         "Run checks.")
    if r.status_code == 429 or r.status_code == 432:
        raise JobFailure("The search service limit is reached for now. Wait a while, or switch this case to demo data.")
    if r.status_code >= 400:
        raise JobFailure("The search service returned an error. Press Try again in a moment.")
    budget.record_search(case_id, "tavily", 1)
    results = (r.json() or {}).get("results") or []
    _cache_put(ck, "tavily", results)
    return results


def _plan_domains(case_id: int) -> tuple[bool, list[str], list[str]]:
    """Open-web plan: (search the whole web?, ticked domains, unticked domains)."""
    with session() as s:
        plan = s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id,
                                                   SourcePlanItem.origin_type == "open_web")).all()
    whole = any(p.included and not p.domain for p in plan)
    clean = lambda d: d.replace("*.", "").strip(". ")  # noqa: E731
    return (whole, [clean(p.domain) for p in plan if p.included and p.domain],
            [clean(p.domain) for p in plan if not p.included and p.domain])


class LiveSearch(SearchProvider):
    name = "live"

    def __init__(self, case_id: int, deny: privacy.DenyList):
        self.case_id = case_id
        self.deny = deny

    async def search(self, query, need_ref, origin, included_sources, limit):
        blocked = privacy.check(query, self.deny)           # hard filter right before the call
        if blocked:
            raise JobFailure("A search contained a private term and was blocked: " + ", ".join(blocked)
                             + ". Edit the search on the research plan.")
        if origin == "firm_archive":
            return archive.search(query, limit)
        if origin != "open_web":
            return []                                       # no paid database is connected in live mode
        whole, ticked, unticked = _plan_domains(self.case_id)
        if "*" in included_sources:
            whole = True
        if not whole and not ticked:
            return []
        rows = await tavily(query, [] if whole else ticked, unticked, limit, self.case_id)
        out: list[SearchResult] = []
        for row in rows[:limit]:
            url = row.get("url") or ""
            domain = credibility.normalise_domain(url)
            if any(domain == d or domain.endswith("." + d) for d in unticked):
                continue                                    # unticked sources are never used
            text = (row.get("raw_content") or row.get("content") or "")[:MAX_TEXT]
            unreadable = False
            if not text.strip():
                try:
                    text = await fetch_page(url, self.deny)
                except (Blocked, httpx.HTTPError):
                    unreadable = True
            out.append(SearchResult(origin_type="open_web", source_name=domain, title=row.get("title") or url,
                                    url=url, domain=domain, publisher=domain,
                                    published_date=(row.get("published_date") or "")[:10], text=text,
                                    unreadable=unreadable))
        return out


def live_search(case_id: int, deny: privacy.DenyList) -> LiveSearch:
    return LiveSearch(case_id, deny)
