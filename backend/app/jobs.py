"""Long work runs as in-process asyncio tasks recorded in the job table, so a refresh keeps progress."""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from sqlmodel import select

from . import activity
from .db.models import Job, now
from .db.session import session
from .errors import JobFailure

log = logging.getLogger("workbench.jobs")
_tasks: set[asyncio.Task] = set()
_stop: set[int] = set()
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """The server's event loop; sync endpoints run in worker threads and schedule jobs onto it."""
    global _loop
    _loop = loop


class JobCtx:
    def __init__(self, job_id: int, case_id: int):
        self.job_id = job_id
        self.case_id = case_id

    def progress(self, **kw) -> None:
        with session() as s:
            j = s.get(Job, self.job_id)
            p = dict(j.progress_json or {})
            p.update(kw)
            j.progress_json = p
            s.add(j)
            s.commit()

    @property
    def stop_requested(self) -> bool:
        return self.job_id in _stop


def running(case_id: int, kind: str) -> Job | None:
    with session() as s:
        return s.exec(select(Job).where(Job.case_id == case_id, Job.kind == kind,
                                        Job.status.in_(["queued", "running"]))).first()


def latest(case_id: int, kind: str) -> Job | None:
    with session() as s:
        return s.exec(select(Job).where(Job.case_id == case_id, Job.kind == kind)
                      .order_by(Job.id.desc())).first()


def get(job_id: int) -> Job | None:
    with session() as s:
        return s.get(Job, job_id)


def request_stop(job_id: int) -> None:
    _stop.add(job_id)


def start(case_id: int, kind: str, fn: Callable[[JobCtx], Awaitable[None]], step: int = 0) -> Job:
    """Idempotent: returns the running job of this kind if one exists."""
    existing = running(case_id, kind)
    if existing:
        return existing
    with session() as s:
        j = Job(case_id=case_id, kind=kind, status="queued", progress_json={})
        s.add(j)
        s.commit()
        job_id = j.id
    ctx = JobCtx(job_id, case_id)

    async def wrapper() -> None:
        _set(job_id, status="running")
        try:
            await fn(ctx)
            _set(job_id, status="done", finished_at=now())
        except JobFailure as e:
            _set(job_id, status="failed", finished_at=now(), error=str(e))
            activity.log(case_id, "system", "job_failed", step, f"{kind} failed: {e}", {"job": job_id})
        except Exception as e:  # never a stack trace on screen; log it for the operator
            log.exception("job %s failed", kind)
            msg = f"Something went wrong while running {kind.replace('_', ' ')}. ({type(e).__name__})"
            _set(job_id, status="failed", finished_at=now(), error=msg)
            activity.log(case_id, "system", "job_failed", step, msg, {"job": job_id})
        finally:
            _stop.discard(job_id)

    try:
        task = asyncio.get_running_loop().create_task(wrapper())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except RuntimeError:
        asyncio.run_coroutine_threadsafe(wrapper(), _loop)
    return get(job_id)


def _set(job_id: int, **kw) -> None:
    with session() as s:
        j = s.get(Job, job_id)
        for k, v in kw.items():
            setattr(j, k, v)
        s.add(j)
        s.commit()


def fail_orphans() -> None:
    """At startup, jobs left running by a restart are marked failed so they can be retried."""
    with session() as s:
        for j in s.exec(select(Job).where(Job.status.in_(["queued", "running"]))).all():
            j.status = "failed"
            j.error = "The server restarted while this was running. Press Retry."
            j.finished_at = now()
            s.add(j)
        s.commit()
