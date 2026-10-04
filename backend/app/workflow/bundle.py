"""One JSON view of a case for the frontend and exports. Counts are computed, never hard-coded."""
from __future__ import annotations

from sqlmodel import select

from .. import jobs
from ..db.models import (Calc, ClientFile, Conclusion, EvidenceItem, EvidenceNeed, Frame, Job, Overall, RuleSet,
                         SourcePlanItem, Summary, Trip, Verdict)
from ..db.session import session
from ..engine import credibility, verdict as V
from ..engine.verdict import with_unit
from ..settings import effective_mode, rules
from ..state_machine import review_status, step_status
from . import common as C

STATUS_LABELS = {
    "auto_approved": "Passed the quality check", "approved": "Accepted by you",
    "needs_decision": "Needs your call", "client_reported": "From the client",
    "belief_under_test": "Client's claim", "cross_check": "Sense check only", "pass_line_source": "Target source",
    "rejected": "Rejected", "pending": "Waiting", "unreadable": "Could not read", "duplicate": "Duplicate",
    "pending_clean": "Not checked yet",
}


def _job_view(j: Job | None) -> dict | None:
    if not j:
        return None
    return {"id": j.id, "kind": j.kind, "status": j.status, "error": j.error, "progress": j.progress_json or {},
            "started_at": j.started_at, "finished_at": j.finished_at}


def build(case_id: int) -> dict:
    with session() as s:
        case = C.get_case(s, case_id)
        frame = s.get(Frame, case_id)
        rs = s.get(RuleSet, case_id)
        hs_all = C.hypotheses(s, case_id, include_removed=True)
        items = sorted(s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all(), key=lambda e: e.seq)
        links = C.links_for(s, case_id)
        verdicts = {v.hypothesis_code: v for v in s.exec(select(Verdict).where(
            Verdict.case_id == case_id, Verdict.current == True)).all()}  # noqa: E712
        needs = s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id).order_by(EvidenceNeed.id)).all()
        files = s.exec(select(ClientFile).where(ClientFile.case_id == case_id).order_by(ClientFile.id)).all()
        plan = s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id)
                      .order_by(SourcePlanItem.id)).all()
        calcs = s.exec(select(Calc).where(Calc.case_id == case_id).order_by(Calc.id)).all()
        trips = s.exec(select(Trip).where(Trip.case_id == case_id).order_by(Trip.id)).all()
        ov = s.get(Overall, case_id)
        summ = s.get(Summary, case_id)
        concl = s.get(Conclusion, case_id)
        progress = step_status(s, case)
        review = review_status(s, case_id) if (case.settings_json or {}).get("clean_finished_at") else None
        all_jobs = s.exec(select(Job).where(Job.case_id == case_id).order_by(Job.id)).all()
        from .results import sliders as _sliders
        slider_rows = _sliders(s, case_id) if verdicts else []
    mode, notice = effective_mode()
    by_item: dict[str, list] = {}
    for ln in links:
        by_item.setdefault(ln.evidence_id, []).append(ln.model_dump())
    item_map = {e.id: e for e in items}
    ev = []
    for e in items:
        d = e.model_dump()
        d["links"] = by_item.get(e.id, [])
        d["status_label"] = (f"Duplicate of {e.duplicate_of}" if e.duplicate_of else STATUS_LABELS.get(e.status, e.status))
        tier = (e.credibility_json or {}).get("tier")
        d["tier"] = tier
        d["tier_label"] = credibility.tier_label(tier) if e.status not in ("pending",) else ""
        d["date"] = e.data_as_of or e.published_date
        d["claim"] = _claim(e)
        d["text"] = e.text[:4000]
        d["copies"] = [x.id for x in items if x.duplicate_of == e.id]
        ev.append(d)
    hyps = []
    for h in hs_all:
        d = h.model_dump()
        line = C.pass_line(h)
        d["line"] = line
        d["line_text"] = with_unit(line, h.measure_unit) if line is not None else "—"
        v = verdicts.get(h.code)
        d["verdict"] = v.model_dump() if v else None
        d["benchmarks"] = [ln.evidence_id for ln in links if ln.hypothesis_code == h.code and ln.role == "sets_pass_line"]
        hyps.append(d)
    collected = [e for e in items if e.bucket not in ("reference", "pending") and not e.trip_id]
    counts = {
        "collected": len(collected),
        "unique": len([e for e in collected if not e.duplicate_of]),
        "duplicates": len([e for e in collected if e.duplicate_of]),
        "auto_approved": len([e for e in items if e.status == "auto_approved"]),
        "decided_by_person": len([e for e in items if e.decided_by == "consultant"]),
        "rejected": len([e for e in items if e.status == "rejected"]),
        "pending": len([e for e in items if e.status == "pending"]),
        "unreadable": len([e for e in items if e.status == "unreadable"]),
        "benchmarks": len([e for e in items if e.bucket == "reference"]),
        "by_origin": {o: len([e for e in collected if e.origin_type == o]) for o in
                      ("open_web", "firm_archive", "paid_db", "client_file", "expert_note")},
    }
    groups = {}
    for e in items:
        if e.duplicate_of:
            groups.setdefault(e.original_group_id or e.duplicate_of, []).append(e.id)
    latest = {}
    for j in all_jobs:
        latest[j.kind] = _job_view(j)
    running = [k for k, j in latest.items() if j["status"] in ("queued", "running")]
    cs = case.model_dump()
    return {
        "case": cs, "mode": {"case": case.mode, "app": mode, "notice": notice},
        "frame": frame.model_dump() if frame else None,
        "ruleset": rs.model_dump() if rs else None,
        "hypotheses": hyps,
        "needs": [n.model_dump() for n in needs],
        "files": [{"id": f.id, "filename": f.filename, "kind": f.kind, "uploaded_at": f.uploaded_at,
                   "figures": f.figures_json, "trip_id": f.trip_id, "preview": f.text_extract[:600]} for f in files],
        "plan": [p.model_dump() for p in plan],
        "evidence": ev,
        "duplicate_groups": [{"original": k, "copies": v, "original_title": item_map[k].title if k in item_map else "",
                              "rule": item_map[v[0]].duplicate_rule if v and v[0] in item_map else ""}
                             for k, v in groups.items()],
        "calcs": [c.model_dump() for c in calcs],
        "trips": [t.model_dump() for t in trips],
        "overall": ({**ov.model_dump(), "label": V.OVERALL_LABELS[ov.result]} if ov else None),
        "summary": summ.model_dump() if summ else None,
        "conclusion": concl.model_dump() if concl else None,
        "progress": progress, "review": review, "counts": counts,
        "jobs": latest, "running_jobs": running,
        "sliders": slider_rows,
        "sample_replies": _sample_replies(case),
        "rules": {"thresholds": rules(), "adding_up_rule": rules()["adding_up_rule"]},
    }


def _sample_replies(case) -> dict:
    pack = C.pack_for(case)
    if not pack:
        return {}
    return {k: v.get("reply_file") for k, v in (pack["case"].get("trips") or {}).items() if v.get("reply_file")}


def _claim(e: EvidenceItem) -> str:
    figs = [f for f in e.figures_json or [] if f.get("kind") != "calculated"]
    if not figs:
        return e.title
    f = figs[0]
    val = f.get("value")
    num = (f"{val:g}" if val is not None else f"{f.get('low'):g} to {f.get('high'):g}")
    unit = (f.get("unit") or "").strip()
    return (f"{num}{unit}" if unit.startswith("%") else f"{num} {unit}").strip() + (f" ({f['period']})" if f.get("period") else "")


def case_list() -> list[dict]:
    from ..db.models import Case
    with session() as s:
        cases = s.exec(select(Case).order_by(Case.updated_at.desc())).all()
        out = []
        for c in cases:
            st = step_status(s, c)
            out.append({"id": c.id, "title": c.title, "client_name": c.client_name, "sample": c.sample,
                        "mode": c.mode, "current_step": st["current"], "updated_at": c.updated_at,
                        "status": c.status})
        return out


def job(job_id: int) -> dict | None:
    return _job_view(jobs.get(job_id))
