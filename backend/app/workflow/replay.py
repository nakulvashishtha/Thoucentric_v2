"""Skip to step (sample cases only): replay the pack's recorded consultant answers through the normal,
gated workflow functions up to a chosen step. It never bypasses a gate and never writes the conclusion."""
from __future__ import annotations

import asyncio

from sqlmodel import select

from .. import activity, jobs, samples
from ..db.models import EvidenceItem, Job
from ..db.session import session
from ..errors import BadInput, GateError, JobFailure
from ..state_machine import step_status
from . import common as C, frame, gather, results


async def _wait(case_id: int, kind: str, timeout: float = 120) -> None:
    """Wait for the latest job of a kind to finish; a failed job stops the replay with its message."""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        with session() as s:
            j = s.exec(select(Job).where(Job.case_id == case_id, Job.kind == kind).order_by(Job.id.desc())).first()
        if j and j.status == "done":
            return
        if j and j.status == "failed":
            raise JobFailure(j.error)
        await asyncio.sleep(0.05)
    raise JobFailure("This took too long. Press Try again.")


def _matches(e: EvidenceItem, match: dict) -> bool:
    for k, v in match.items():
        actual = (e.credibility_json or {}).get(k) if k == "matches_belief" else getattr(e, k, None)
        if actual != v:
            return False
    return True


def _decide_by_rules(case_id: int, e: EvidenceItem, rules: list[dict], confirm: bool) -> None:
    has_calc = any(f.get("kind") == "calculated" for f in e.figures_json or [])
    for rule in rules:
        if _matches(e, rule["match"]):
            gather.decide(case_id, e.id, rule["action"], rule.get("reason", ""), bool(confirm and has_calc))
            return


def _items(case_id: int) -> list[EvidenceItem]:
    with session() as s:
        return sorted(s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all(), key=lambda e: e.seq)


def _review(case_id: int, script: dict) -> None:
    rv = script["review"]
    for e in _items(case_id):
        if e.bucket == "auto":
            if e.spot_check_selected and not e.spot_check_result:
                gather.spot_check(case_id, e.id, rv["spot_check"] == "matches")
            if rv.get("mark_all_auto_approved_seen") and not e.seen_by_consultant:
                gather.mark_seen(case_id, e.id)
    for e in _items(case_id):
        if e.bucket == "decision" and e.status == "needs_decision":
            _decide_by_rules(case_id, e, rv["rules"], rv.get("confirm_all_derivations", False))
    if rv.get("tick_sources_box"):
        gather.confirm_sources(case_id, True)


async def _trips(case_id: int, name: str, script: dict) -> None:
    from ..db.models import Trip
    for t in script.get("trips", []):
        with session() as s:
            if s.exec(select(Trip).where(Trip.case_id == case_id, Trip.hypothesis_code == t["idea"])).first():
                continue
        tid = results.create_trip(case_id, t["idea"])
        await _wait(case_id, f"trip_{tid}")
        results.mark_trip_sent(case_id, tid)
        data = samples.file_bytes(name, t["reply_file"], "replies")
        results.trip_reply(case_id, tid, t["reply_file"], data)
        await _wait(case_id, f"trip_reply_{tid}")
        for e in _items(case_id):
            if e.bucket == "trip" and e.status == "needs_decision":
                gather.decide(case_id, e.id, t["decide"], "", bool(t.get("confirm_formula")))
        results.run_tests(case_id, t["idea"])


def advance(case_id: int, to: int):
    with session() as s:
        case = C.get_case(s, case_id)
        if not case.sample:
            raise BadInput("Skip to step only works on sample cases.")
        if not 1 <= to <= 12:
            raise BadInput("Choose a step from 1 to 12.")
        current = step_status(s, case)["current"]
    if to <= current:
        raise GateError(f"This case is already at step {current}. Open earlier steps from the stepper.", [])
    name = case.sample
    script = samples.load(name)["script"]
    activity.log(case_id, "system", "skip_to_step", current,
                 f"Skipped ahead to step {to} using the sample's recorded answers (sample data)")

    async def job(ctx: jobs.JobCtx) -> None:
        def done() -> dict:
            with session() as s:
                return step_status(s, C.get_case(s, case_id))["done"]

        ctx.progress(label="Replaying the sample's recorded answers")
        if to >= 2 and not done()[1]:
            frame.read_ask(case_id)
            await _wait(case_id, "frame")
        if to >= 3 and not done()[2]:
            frame.confirm_frame(case_id)
            await _wait(case_id, "plan")
        if to >= 4 and not done()[3]:
            removals = [{"code": x["code"], "removed_reason": x["reason"]} for x in script.get("remove_ideas", [])]
            if removals:
                frame.edit_hypotheses(case_id, removals)
            frame.lock_plan(case_id, True)
            await _wait(case_id, "route")
        if to >= 5 and not done()[4]:
            gather.mark_sent(case_id, True)
        if to >= 7 and not done()[6]:
            await _wait(case_id, "collect")
            await _wait(case_id, "clean")
        if to >= 8 and not done()[7]:
            _review(case_id, script)
            results.run_tests(case_id)
        if to >= 10 and not done()[9]:
            await _trips(case_id, name, script)
        if to >= 11 and not done()[10]:
            results.start_addup(case_id)
            await _wait(case_id, "addup")
        ctx.progress(label="Done")

    return jobs.start(case_id, "advance", job, step=current)
