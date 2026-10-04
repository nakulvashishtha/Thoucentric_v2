"""SearchProvider interface and the result shape every provider returns."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class SearchResult:
    origin_type: str                 # open_web | firm_archive | paid_db | expert_note | benchmark
    source_name: str
    title: str
    url: str = ""
    domain: str = ""
    publisher: str = ""
    published_date: str = ""
    data_as_of: str = ""
    text: str = ""
    seed_id: str = ""
    simulated: bool = False
    script_tag: str = ""
    unreadable: bool = False
    found_in: str = ""
    extra: dict = field(default_factory=dict)


class SearchProvider(ABC):
    name = "base"

    @abstractmethod
    async def search(self, query: str, need_ref: str, origin: str, included_sources: set[str],
                     limit: int) -> list[SearchResult]:
        """Return results for one query. Sources not ticked in the plan are never searched."""
