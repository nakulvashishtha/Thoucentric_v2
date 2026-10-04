"""Append-only activity record. There is no update or delete path."""
from __future__ import annotations

from sqlmodel import select

from .db.models import Activity, now
from .db.session import session

ACTORS = {"consultant", "llm", "rule_engine", "client", "expert", "system"}


def log(case_id: int, actor: str, event_type: str, step: int, message: str, payload: dict | None = None) -> int:
    assert actor in ACTORS, actor
    with session() as s:
        a = Activity(case_id=case_id, actor=actor, event_type=event_type, step=step, message=message,
                     payload_json=payload or {}, ts=now())
        s.add(a)
        s.commit()
        return a.id


def since(case_id: int, since_id: int = 0, limit: int = 500) -> list[dict]:
    with session() as s:
        rows = s.exec(select(Activity).where(Activity.case_id == case_id, Activity.id > since_id)
                      .order_by(Activity.id).limit(limit)).all()
        return [r.model_dump() for r in rows]
