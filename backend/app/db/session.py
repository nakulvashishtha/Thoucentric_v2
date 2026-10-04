"""Database engine. SQLite in WAL mode; swappable to Postgres through DATABASE_URL."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from ..settings import data_dir, env
from . import models  # noqa: F401  (register tables)

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = env("DATABASE_URL") or f"sqlite:///{(data_dir() / 'workbench.db').as_posix()}"
        kw = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
        _engine = create_engine(url, **kw)
        if url.startswith("sqlite"):
            @event.listens_for(_engine, "connect")
            def _pragma(conn, _):
                cur = conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.close()
        SQLModel.metadata.create_all(_engine)
        if url.startswith("sqlite"):
            with _engine.begin() as conn:      # keyword index for the firm archive
                try:
                    conn.exec_driver_sql("CREATE VIRTUAL TABLE IF NOT EXISTS archive_fts "
                                         "USING fts5(title, body, doc_id UNINDEXED)")
                except Exception:  # noqa: BLE001  (an SQLite build without FTS5 falls back to a plain scan)
                    pass
    return _engine


def reset_engine() -> None:
    """Used by tests to point at a fresh DATA_DIR."""
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


@contextmanager
def session():
    with Session(get_engine(), expire_on_commit=False) as s:
        yield s
