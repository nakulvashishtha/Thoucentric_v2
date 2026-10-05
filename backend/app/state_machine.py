"""The backend state machine. The UI may grey out buttons, but every gate is enforced here (HTTP 409)."""
from __future__ import annotations

from sqlmodel import Session, select

from .db.models import Case, Conclusion, EvidenceItem, Frame, Overall, RuleSet, Summary, Trip
from .errors import GateError
from .settings import app_settings
from .workflow.common import STEPS, hypotheses


def review_status(s: Session, case_id: int) -> dict:
    items = s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id, EvidenceItem.trip_id == None)).all()  # noqa: E711
    auto = [e for e in items if e.bucket == "auto"]
    decision = [e for e in items if e.bucket == "decision"]
    picks = [e for e in items if e.spot_check_selected]
    seen = [e for e in auto if e.seen_by_consultant]
    decided = [e for e in decision if e.status != "needs_decision"]
    c = s.get(Case, case_id)
    st = c.settings_json or {}
    out = {
        "auto_total": len(auto), "auto_seen": len(seen),
        "decision_total": len(decision), "decided": len(decided),
        "spot_total": len(picks), "spot_done": len([e for e in picks if e.spot_check_result]),
        "sources_box": bool(st.get("sources_reviewed_at")),
        # optional: the quick double-check never blocks the tests (user-test feedback)
        "double_check": bool(app_settings().get("double_check", True)),
    }
    missing = []
    if out["decided"] < out["decision_total"]:
        n = out["decision_total"] - out["decided"]
        missing.append(f"Decide {n} more item{'s' if n != 1 else ''}")
    if out["auto_seen"] < out["auto_total"]:
        n = out["auto_total"] - out["auto_seen"]
        missing.append(f"Look at {n} more source{'s' if n != 1 else ''}")
    if not out["sources_box"]:
        missing.append("Tick \"I've checked these sources\"")
    out["missing"] = missing
    out["ready"] = not missing
    return out


def step_status(s: Session, case: Case) -> dict:
    """Per-step state: done, current, available (optional), locked; with the reason a step is locked."""
    st = case.settings_json or {}
    frame = s.get(Frame, case.id)
    rs = s.get(RuleSet, case.id)
    ov = s.get(Overall, case.id)
    summ = s.get(Summary, case.id)
    concl = s.get(Conclusion, case.id)
    trips = s.exec(select(Trip).where(Trip.case_id == case.id)).all()
    reopened = [h.code for h in hypotheses(s, case.id) if h.links_reopened_for_trip]
    done = {
        1: bool(case.client_name and case.country and case.industry and case.function and case.raw_ask
                and frame is not None),
        2: bool(frame and frame.confirmed_at),
        3: bool(rs and rs.locked_at),
        4: bool(st.get("requests_marked_sent_at")),
        5: bool(st.get("collect_finished_at")),
        6: bool(st.get("clean_finished_at")),
        7: bool(st.get("tests_run_at")),
        8: bool(st.get("tests_run_at")),
        9: bool(ov and not ov.stale and not reopened),
        10: bool(ov and not ov.stale and summ),
        11: bool(ov and not ov.stale and summ),
        12: bool(concl and concl.saved_at),
    }
    required_before = {2: [1], 3: [2], 4: [3], 5: [4], 6: [5], 7: [6], 8: [7], 9: [8], 10: [8], 11: [10], 12: [10]}
    names = {n: t for n, t, _, _ in STEPS}
    out = {}
    current = None
    for n, title, phase, signoff in STEPS:
        reqs = required_before.get(n, [])
        unmet = [r for r in reqs if not done[r]]
        if n == 9 and not unmet and done[9] and not trips:
            state = "done"
        elif done[n] and not (n in (9, 10, 11) and reopened):
            state = "done"
        elif unmet:
            state = "locked"
        else:
            state = "open"
        out[n] = {"n": n, "title": title, "phase": phase, "signoff": signoff, "state": state,
                  "locked_reason": f"Finish \"{names[unmet[0]]}\" first" if unmet else ""}
    for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12):
        if out[n]["state"] == "open":
            if n == 9 and not reopened and not [t for t in trips if not t.retested_at]:
                continue  # optional unless a trip is in progress
            if n == 11:
                continue  # read-only what-if, never blocks
            current = n
            break
    if current is None:
        current = 12 if out[12]["state"] != "locked" else max(k for k, v in out.items() if v["state"] != "locked")
    for n in out:
        out[n]["current"] = n == current
    return {"steps": [out[n] for n in sorted(out)], "current": current, "done": done, "reopened": reopened}


def require(s: Session, case: Case, action: str) -> None:
    """Raise GateError (409) if the action is not allowed in the case's current state."""
    st = case.settings_json or {}
    status = step_status(s, case)
    done = status["done"]

    def need(cond: bool, reason: str, required: list[str]) -> None:
        if not cond:
            raise GateError(reason, required)

    if action == "edit_case":
        need(not done[2], "The ask can't change once the question is confirmed.", ["Reset the case to change the ask"])
    elif action == "read_ask":
        need(bool(case.client_name and case.country and case.industry and case.function and case.raw_ask),
             "Fill in the client, country, industry, function and the ask first.",
             ["client", "country", "industry", "function", "ask"])
        need(not done[2], "The question is already confirmed.", [])
    elif action in ("edit_frame", "confirm_frame"):
        need(done[1], "Check the ask first, so we can draft the question.", ["Check the ask"])
        need(not done[2], "The question is already confirmed.", [])
    elif action in ("edit_hypotheses", "lock_plan"):
        need(done[2], "Confirm the question first.", ["Confirm the question"])
        need(not done[3], "The targets are locked. Targets, measures, margins and the quality check can't change "
             "after you lock them.", ["Locked"])
    elif action in ("edit_source_plan", "mark_sent"):
        need(done[3], "Lock the targets first.", ["Lock targets"])
        need(not done[4], "The requests are already marked as sent, so they can't change.", [])
        if action == "mark_sent":
            need(bool(st.get("route_done")), "Wait for the research plan to finish.", ["Research plan ready"])
    elif action == "collect":
        need(done[4], "Mark the requests as sent first.", ["Mark as sent"])
    elif action == "upload_reply":
        need(done[4] and not done[5], "Replies can be added while evidence is being gathered. Later replies go "
             "in at Fill the gaps.", ["Gathering open"])
    elif action == "clean":
        need(done[5], "Let collecting finish, or stop it, first.", ["Finish or stop collecting"])
    elif action in ("decide", "edit_links", "seen", "spot_check", "confirm_sources"):
        need(done[6], "Wait for the evidence check to finish.", ["Evidence checked"])
        need(not done[7], "The tests have run, so decisions and links are locked. New evidence goes in at Fill "
             "the gaps.", ["Use Fill the gaps"])
    elif action == "run_tests":
        need(done[6], "Wait for the evidence check to finish.", ["Evidence checked"])
        need(not done[7], "The tests have already run.", [])
        rv = review_status(s, case.id)
        need(rv["ready"], "Finish the review first: " + "; ".join(m[0].lower() + m[1:] for m in rv["missing"])
             + ".", rv["missing"])
    elif action == "trip":
        need(done[8], "Run the tests first.", ["Run tests"])
    elif action == "addup":
        need(done[8], "Run the tests first.", ["Run tests"])
        need(not status["reopened"], "Make a call on the new evidence and test the idea again first.",
             [f"Test {c} again" for c in status["reopened"]])
    elif action == "whatif":
        need(done[8], "Run the tests first.", ["Run tests"])
    elif action == "retarget":
        need(done[8], "Run the tests first.", ["Run tests"])
        need(not status["reopened"], "Make a call on the new evidence and test the idea again first.",
             [f"Test {c} again" for c in status["reopened"]])
        need(not [t for t in s.exec(select(Trip).where(Trip.case_id == case.id)).all() if not t.marked_sent_at],
             "Finish or mark as sent the open follow-up request first.", ["Fill the gaps"])
    elif action == "conclusion":
        need(done[10], "Add up the answer first.", ["Add it up"])
    else:
        raise GateError(f"Unknown action {action}", [])
