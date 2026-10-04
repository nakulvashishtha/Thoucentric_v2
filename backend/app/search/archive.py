"""FirmArchive: keyword search (SQLite FTS5) over documents consultants upload. No embeddings."""
from __future__ import annotations

import re

from sqlmodel import select

from ..db.models import ArchiveDoc
from ..db.session import get_engine, session
from .base import SearchResult

SOURCE_NAME = "Firm research archive"
_STOP = {"the", "and", "for", "with", "from", "that", "this", "what", "how", "are", "was", "per", "of", "in", "to",
         "a", "an", "on", "by", "or", "is", "it", "at", "as", "be"}


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(t) > 2 and t not in _STOP]


def add(title: str, filename: str, text: str, published_date: str = "") -> int:
    with session() as s:
        d = ArchiveDoc(title=title or filename, filename=filename, text=text, published_date=published_date)
        s.add(d)
        s.commit()
        doc_id = d.id
    try:
        with get_engine().begin() as conn:
            conn.exec_driver_sql("INSERT INTO archive_fts(title, body, doc_id) VALUES (?, ?, ?)",
                                 (d.title, text, doc_id))
    except Exception:  # noqa: BLE001  (no FTS5: search falls back to a scan)
        pass
    return doc_id


def remove(doc_id: int) -> None:
    with session() as s:
        d = s.get(ArchiveDoc, doc_id)
        if d:
            s.delete(d)
            s.commit()
    try:
        with get_engine().begin() as conn:
            conn.exec_driver_sql("DELETE FROM archive_fts WHERE doc_id = ?", (doc_id,))
    except Exception:  # noqa: BLE001
        pass


def listing() -> list[dict]:
    with session() as s:
        return [{"id": d.id, "title": d.title, "filename": d.filename, "published_date": d.published_date,
                 "uploaded_at": d.uploaded_at, "chars": len(d.text)}
                for d in s.exec(select(ArchiveDoc).order_by(ArchiveDoc.id.desc())).all()]


def _ids(query: str, limit: int) -> list[int]:
    toks = tokens(query)
    if not toks:
        return []
    try:
        match = " OR ".join(f'"{t}"' for t in toks)
        with get_engine().connect() as conn:
            rows = conn.exec_driver_sql("SELECT doc_id FROM archive_fts WHERE archive_fts MATCH ? "
                                        "ORDER BY bm25(archive_fts) LIMIT ?", (match, limit)).fetchall()
        return [int(r[0]) for r in rows]
    except Exception:  # noqa: BLE001  (plain scan when FTS5 is missing)
        with session() as s:
            docs = s.exec(select(ArchiveDoc)).all()
        scored = sorted(((sum(tokens(d.title + " " + d.text).count(t) for t in toks), d.id) for d in docs), reverse=True)
        return [i for score, i in scored if score > 0][:limit]


def search(query: str, limit: int) -> list[SearchResult]:
    out = []
    with session() as s:
        for doc_id in _ids(query, limit):
            d = s.get(ArchiveDoc, doc_id)
            if d:
                out.append(SearchResult(origin_type="firm_archive", source_name=SOURCE_NAME, title=d.title,
                                        publisher=SOURCE_NAME, published_date=d.published_date, text=d.text[:20000],
                                        extra={"archive_id": d.id}))
    return out
