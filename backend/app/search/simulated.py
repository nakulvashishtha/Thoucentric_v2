"""Fixture search: seeded evidence from a sample pack. Paid databases are labelled as simulated."""
from __future__ import annotations

from .base import SearchProvider, SearchResult

SIMULATED_LABEL = "Simulated source (prototype)"


def to_result(seed: dict) -> SearchResult:
    keys = SearchResult.__dataclass_fields__.keys()
    r = SearchResult(**{k: v for k, v in seed.items() if k in keys and k != "extra"})
    r.simulated = True
    r.extra = {"need_ref": seed.get("need_ref", "")}
    if r.origin_type == "paid_db" and SIMULATED_LABEL not in r.source_name:
        r.source_name = f"{r.source_name} · {SIMULATED_LABEL}"
    return r


class FixtureSearch(SearchProvider):
    name = "fixtures"

    def __init__(self, seeds: list[dict]):
        self.seeds = seeds

    async def search(self, query, need_ref, origin, included_sources, limit):
        hits = [s for s in self.seeds
                if s.get("need_ref") == need_ref and s.get("origin_type") == origin
                and s.get("plan_source") in included_sources]
        return [to_result(s) for s in hits[:limit]]

    def benchmarks(self, idea_code: str) -> list[SearchResult]:
        return [to_result(s) for s in self.seeds if s.get("benchmark_for") == idea_code]

    def arrivals(self, origin: str) -> list[SearchResult]:
        """Seeded expert replies that 'arrive' during collection in fixtures mode."""
        return [to_result(s) for s in self.seeds if s.get("origin_type") == origin and s.get("arrives_at_collect")]
