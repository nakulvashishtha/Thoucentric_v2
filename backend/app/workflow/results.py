"""Steps 8 to 12: test, fill the gaps, add it up, stress-test, decide; plus exports."""
from __future__ import annotations

import csv
import io
import json
import re

from sqlmodel import select

from .. import activity, jobs
from ..db.models import (Activity, Case, ClientFile, Conclusion, EvidenceItem, EvidenceLink, EvidenceNeed, Overall,
                         Summary, Trip, Verdict, now)
from ..db.session import session
from ..engine import convert, privacy, trips as T, verdict as V, whatif
from ..errors import BadInput, GateError, JobFailure
from ..llm import interface as llm
from ..settings import rules
from ..state_machine import require, step_status
from . import common as C

RESULT_LABELS = V.RESULT_LABELS
WORD_RESULTS = {"holds": "holds", "supported": "holds", "fails": "fails", "not supported": "fails",
                "conflicting": "conflicting", "sources disagree": "conflicting", "not enough evidence": "not_enough"}
OVERALL_LABELS = V.OVERALL_LABELS


# ------------------------------------------------------------------ step 8

def _store_verdict(s, case_id: int, h, r: V.VerdictResult, line: float) -> None:
    prev = s.exec(select(Verdict).where(Verdict.case_id == case_id, Verdict.hypothesis_code == h.code,
                                        Verdict.current == True)).all()  # noqa: E712
    version = max([p.version for p in prev] or [0]) + 1
    for p in prev:
        p.current = False
        s.add(p)
    s.add(Verdict(case_id=case_id, hypothesis_code=h.code, result=r.result, confidence=r.confidence,
                  reason_codes=r.reason_codes, evidence_ids=r.evidence_ids, why=r.why, version=version,
                  detail_json={"line": line, "figures": r.figure_classes, "unit": h.measure_unit,
                               "comparator": h.comparator, "tolerance_pct": h.tolerance_pct}))


def run_tests(case_id: int, hypothesis_code: str | None = None) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        hs = C.hypotheses(s, case_id)
        if hypothesis_code:
            h = next((x for x in hs if x.code == hypothesis_code), None)
            if not h or not h.links_reopened_for_trip:
                raise GateError(f"{hypothesis_code} has no return-trip evidence waiting to be tested.", [])
            trip_items = [e for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all()
                          if e.trip_id and e.bucket == "trip"]
            open_items = [e.id for e in trip_items if e.status == "needs_decision"]
            if open_items:
                raise GateError("Decide the trip evidence first: " + ", ".join(open_items) + ".", open_items)
            trip = s.exec(select(Trip).where(Trip.case_id == case_id, Trip.hypothesis_code == h.code)
                          .order_by(Trip.n.desc())).first()
            if trip and trip.reply_file_id and not trip.sample_mix_json:
                raise GateError("Record the sample-mix check (or mark it not applicable) first.", ["Sample-mix check"])
            targets = [h]
        else:
            require(s, case, "run_tests")
            targets = hs
        items = C.items_by_id(s, case_id)
        links = C.links_for(s, case_id)
        results = []
        for h in targets:
            line = C.pass_line(h)
            r = C.evaluate(h, items, links, line)
            _store_verdict(s, case_id, h, r, line)
            results.append((h.code, r))
        if hypothesis_code:
            h = targets[0]
            h.links_reopened_for_trip = False
            s.add(h)
            for t in s.exec(select(Trip).where(Trip.case_id == case_id, Trip.hypothesis_code == h.code,
                                               Trip.retested_at == None)).all():  # noqa: E711
                t.retested_at = now()
                s.add(t)
            ov = s.get(Overall, case_id)
            if ov:
                ov.stale = True
                s.add(ov)
        else:
            C.flag(s, case, tests_run_at=now(), links_locked_at=now())
            case.current_step = 8
            s.add(case)
        s.commit()
    if hypothesis_code:
        activity.log(case_id, "consultant", "test_again", 9, f"Tested {hypothesis_code} again with the new evidence")
    else:
        activity.log(case_id, "consultant", "run_tests", 7, "Ran the tests. Links between evidence and ideas are now locked.")
    for code, r in results:
        activity.log(case_id, "rule_engine", "verdict", 8,
                     f"{code}: {RESULT_LABELS[r.result]}" + (f", confidence {V.CONFIDENCE_LABELS[r.confidence]}"
                                                             if r.confidence != "none" else "") + f". {r.why}",
                     {"code": code, "result": r.result, "confidence": r.confidence})


# ------------------------------------------------------------------ step 9

def create_trip(case_id: int, code: str, override: bool = False, override_reason: str = ""):
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "trip")
        h = next((x for x in C.hypotheses(s, case_id) if x.code == code), None)
        if not h:
            raise BadInput(f"Unknown idea {code}")
        v = s.exec(select(Verdict).where(Verdict.case_id == case_id, Verdict.hypothesis_code == code,
                                         Verdict.current == True)).first()  # noqa: E712
        if v and v.result in ("holds", "fails") and v.confidence in ("high", "medium"):
            raise GateError(f"{code} is already settled ({RESULT_LABELS[v.result]}, confidence "
                            f"{V.CONFIDENCE_LABELS[v.confidence]}). Follow-up requests are for ideas with not enough "
                            "evidence, sources that disagree, or weak confidence.", [])
        if h.links_reopened_for_trip:
            raise GateError(f"Finish the open trip for {code} first.", [])
        prev = s.exec(select(Trip).where(Trip.case_id == case_id, Trip.hypothesis_code == code)).all()
        ok, msg = T.check_trip(len(prev), override, override_reason, rules()["trips"]["free"],
                               rules()["trips"]["max_with_override"])
        if not ok:
            raise GateError(msg + ".", ["Override tick and reason"] if "override" in msg else [])
        unsent = [t for t in prev if not t.marked_sent_at]
        if unsent:
            raise GateError(f"Trip {unsent[0].n} for {code} is drafted but not yet marked as sent.", [])
        trip = Trip(case_id=case_id, hypothesis_code=code, n=len(prev) + 1,
                    override_reason=override_reason.strip() or None if len(prev) + 1 > rules()["trips"]["free"] else None)
        s.add(trip)
        s.commit()
        tid = trip.id
    if trip.override_reason:
        activity.log(case_id, "consultant", "trip_override", 9,
                     f"Asked a third time about {code}. Reason: {trip.override_reason}")

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            dl = C.deny_list(s, case)
            h = next(x for x in C.hypotheses(s, case_id) if x.code == code)
            items = C.items_by_id(s, case_id)
            held = [{"id": e.id, "title": e.title, "status": e.status} for e in items.values()
                    if any(ln.evidence_id == e.id and ln.hypothesis_code == code for ln in C.links_for(s, case_id))]
            files = [f.filename for f in s.exec(select(ClientFile).where(ClientFile.case_id == case_id)).all()]
        ctx.progress(label="Drafting a narrower question")
        out = await llm.run(C.llm_for(case), "DRAFT_FOLLOWUP", code,
                            {"idea": privacy.for_llm(h.text, dl), "measure": h.measure_name, "unit": h.measure_unit,
                             "evidence_held": held, "client_files": files}, case_id)
        q, _ = privacy.sanitise(out.question, privacy.DenyList(numbers=dl.numbers, number_labels=dl.number_labels))
        with session() as s:
            t = s.get(Trip, tid)
            t.question, t.what_we_have = q, out.what_we_have
            s.add(t)
            s.commit()
        activity.log(case_id, "llm", "followup_drafted", 9, f"Drafted a follow-up question for {code}")
        activity.log(case_id, "rule_engine", "followup_checked", 9,
                     "Checked the follow-up question for private numbers")

    jobs.start(case_id, f"trip_{tid}", job, step=9)
    return tid


def edit_trip(case_id: int, tid: int, question: str) -> None:
    with session() as s:
        t = s.get(Trip, tid)
        if not t or t.case_id != case_id:
            raise BadInput("trip not found")
        if t.marked_sent_at:
            raise GateError("This trip was already marked as sent.", [])
        t.question = question
        s.add(t)
        s.commit()
    activity.log(case_id, "consultant", "trip_edited", 9, "Edited the follow-up question")


def mark_trip_sent(case_id: int, tid: int) -> None:
    with session() as s:
        t = s.get(Trip, tid)
        if not t or t.case_id != case_id:
            raise BadInput("trip not found")
        if not t.question.strip():
            raise GateError("Wait for the question to be drafted.", [])
        t.marked_sent_at = now()
        s.add(t)
        s.commit()
    activity.log(case_id, "consultant", "trip_sent", 9,
                 f"Marked request {t.n} for {t.hypothesis_code} as sent. The tool sent nothing itself.")


def trip_reply(case_id: int, tid: int, filename: str, data: bytes):
    from .frame import add_file, read_file
    from .gather import _get, _grade_and_check, link_and_derive
    with session() as s:
        case = C.get_case(s, case_id)
        t = s.get(Trip, tid)
        if not t or t.case_id != case_id:
            raise BadInput("trip not found")
        if not t.marked_sent_at:
            raise GateError("Mark the question as sent before recording a reply.", ["Mark as sent"])
        if t.reply_file_id:
            raise GateError("This trip already has a reply.", [])
    fid = add_file(case_id, filename, data, "followup", trip_id=tid)

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            f = s.get(ClientFile, fid)
            t = s.get(Trip, tid)
            t.reply_file_id = fid
            s.add(t)
            s.commit()
        ctx.progress(label="Reading the reply")
        await read_file(case, f, 9)
        with session() as s:
            f = s.get(ClientFile, fid)
            eid, seq = C.next_eid(s, case_id)
            need = s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id,
                                                     EvidenceNeed.hypothesis_code == t.hypothesis_code,
                                                     EvidenceNeed.route == "client")).first()
            s.add(EvidenceItem(case_id=case_id, id=eid, seq=seq, need_ref=need.ref if need else "",
                               origin_type="client_file", source_name=f"Client reply: {filename}", title=filename,
                               publisher="Client", text=f.text_extract, figures_json=f.figures_json, file_id=fid,
                               trip_id=tid, simulated=bool(case.sample), status="pending_clean", bucket="trip",
                               published_date=(f.describe_json or {}).get("published_date", ""),
                               data_as_of=(f.describe_json or {}).get("data_as_of", "")))
            s.commit()
            hs = {h.code: h for h in C.hypotheses(s, case_id)}
            needs = {n.ref: n for n in s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all()}
        activity.log(case_id, "client", "trip_reply", 9, f"The client's reply arrived as {eid} ({filename})")
        ctx.progress(label="Linking and checking the reply")
        await link_and_derive(case, eid, hs, needs, step=9)
        with session() as s:
            e = _get(s, case_id, eid)
            from ..db.models import Frame
            from ..engine import credibility
            from ..settings import country_code, registry
            tier, reason = credibility.grade_tier(e.domain, e.origin_type, registry(), country_code(case.country))
            e.credibility_json = {**(e.credibility_json or {}), "tier": tier, "tier_reason": reason, "traced": False}
            _grade_and_check(s, case, e, hs, C.links_for(s, case_id), s.get(Frame, case_id), C.deny_list(s, case))
            e.status, e.bucket = "needs_decision", "trip"          # trip evidence always goes to the consultant
            s.add(e)
            h = hs[t.hypothesis_code]
            h.links_reopened_for_trip = True                       # only this idea's links reopen
            s.add(h)
            for p in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id,
                                                       EvidenceItem.status == "pending")).all():
                if needs.get(p.need_ref) and needs[p.need_ref].hypothesis_code == t.hypothesis_code:
                    p.decision_reason = f"Answered by the trip {t.n} reply ({eid})"
                    s.add(p)
            s.commit()
        activity.log(case_id, "rule_engine", "trip_links_reopened", 9,
                     f"Reopened {t.hypothesis_code} for the reply. Everything else stays locked.")
        pack = C.pack_for(case)
        mix = ((pack or {}).get("case", {}).get("trips", {}).get(t.hypothesis_code) or {}).get("sample_mix")
        if mix and case.mode == "fixtures":
            record_sample_mix(case_id, tid, mix["sample"], mix["target"], False, mix.get("target_note", ""))

    return jobs.start(case_id, f"trip_reply_{tid}", job, step=9)


def record_sample_mix(case_id: int, tid: int, sample: dict, target: dict, not_applicable: bool, note: str = "") -> dict:
    with session() as s:
        t = s.get(Trip, tid)
        if not t or t.case_id != case_id:
            raise BadInput("trip not found")
        if not_applicable:
            res = {"not_applicable": True}
        else:
            res = T.sample_mix({k: float(v) for k, v in sample.items()}, {k: float(v) for k, v in target.items()},
                               rules()["sample_mix"]["max_difference_pct_points"])
            res["target_note"] = note
        t.sample_mix_json = res
        s.add(t)
        s.commit()
    activity.log(case_id, "consultant" if not_applicable else "rule_engine", "sample_mix", 9,
                 "Marked the sample-mix check as not needed" if not_applicable else
                 ("Compared the reply's sample with the target group: " +
                  ("the mix matches" if res["passes"] else "the mix differs by more than the threshold")))
    return res


# ------------------------------------------------------------------ step 10

def engine_numbers(s, case_id: int) -> set[float]:
    nums: set[float] = set()
    for h in C.hypotheses(s, case_id):
        for v in (C.pass_line(h), h.pass_line_value, h.tolerance_pct):
            if v is not None:
                nums.add(round(float(v), 1))
        for a in h.assumptions_json or []:
            nums.add(round(float(a["value"]), 1))
        if h.pass_line_formula:
            for t in convert.value_tokens(h.pass_line_formula):
                nums.add(round(t, 1))
    for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all():
        for f in e.figures_json or []:
            if not f.get("verified"):
                continue
            for k in ("value", "low", "high"):
                if f.get(k) is not None:
                    v = float(f[k])
                    nums.update({round(v, 1), round(v), round(v, 2)})
    return nums


def validate_summary(s, case_id: int, sentences: list[dict], verdicts: dict[str, str]) -> list[str]:
    errs = []
    items = C.items_by_id(s, case_id)
    nums = engine_numbers(s, case_id)
    for i, sen in enumerate(sentences, start=1):
        text = sen["text"]
        for eid in sen["evidence_ids"]:
            if eid not in items:
                errs.append(f"sentence {i} cites {eid}, which does not exist")
        for m in re.finditer(r"\d+(?:[.,]\d+)*", text):
            v = float(m.group(0).replace(",", ""))
            if 1900 <= v <= 2100 and v.is_integer():
                continue
            if not any(abs(v - n) < 0.051 for n in nums):
                errs.append(f"sentence {i} contains {m.group(0)}, which is not in the engine's data")
        for code, word in re.findall(r"\b(H\d+)\b[^.]*?\b(holds|fails|conflicting|not enough evidence|not supported|"
                                     r"supported|sources disagree)\b", text, re.I):
            said = WORD_RESULTS[word.lower()]
            if code in verdicts and said != verdicts[code]:
                errs.append(f"sentence {i} says {code} is {word.lower()}, but the result is "
                            f"{RESULT_LABELS[verdicts[code]].lower()}")
        if re.search(r"\b(we recommend|recommendation|should (not )?(launch|proceed|go ahead|invest))\b", text, re.I):
            errs.append(f"sentence {i} reads like a conclusion; the consultant writes that")
    return errs


def template_summary(s, case_id: int, verdicts: list) -> list[dict]:
    hs = {h.code: h for h in C.hypotheses(s, case_id)}
    out = []
    for v in verdicts:
        h = hs[v.hypothesis_code]
        conf = f", confidence {V.CONFIDENCE_LABELS[v.confidence]}" if v.confidence != "none" else ""
        out.append({"text": f"{h.code} ({h.measure_name}): {RESULT_LABELS[v.result]}{conf}. {v.why}",
                    "evidence_ids": v.evidence_ids or []})
    return [o for o in out if o["evidence_ids"]] or out


def start_addup(case_id: int):
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "addup")
    activity.log(case_id, "consultant", "addup_requested", 10, "Asked for the answer to be added up")

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            hs = C.hypotheses(s, case_id)
            vs = s.exec(select(Verdict).where(Verdict.case_id == case_id, Verdict.current == True)).all()  # noqa: E712
            vmap = {v.hypothesis_code: v for v in vs}
            overall, rule_text = V.adding_up([{"code": h.code, "must_have": h.must_have,
                                                "result": vmap[h.code].result} for h in hs if h.code in vmap])
            ov = s.get(Overall, case_id) or Overall(case_id=case_id, result=overall)
            ov.result, ov.rule_applied, ov.computed_at, ov.stale = overall, rule_text, now(), False
            s.add(ov)
            s.commit()
            items = C.items_by_id(s, case_id)
            resolve = _resolve_map(items)
            payload = {"verdicts": [{"code": h.code, "idea": h.text, "must_have": h.must_have,
                                     "pass_line": C.pass_line(h), "unit": h.measure_unit, "comparator": h.comparator,
                                     "result": vmap[h.code].result, "confidence": vmap[h.code].confidence,
                                     "evidence": [{"id": f["evidence_id"], "figure": f["figure"]}
                                                  for f in vmap[h.code].detail_json.get("figures", [])]}
                                    for h in hs if h.code in vmap],
                       "overall": overall, "_resolve": resolve}
        activity.log(case_id, "rule_engine", "added_up", 10, f"Added up the results using the locked rule: {OVERALL_LABELS[overall]}. {rule_text}")
        ctx.progress(label="Writing the summary")
        client = C.llm_for(case)
        sentences, source = None, "llm"
        try:
            out = await llm.run(client, "SUMMARISE", "", payload, case_id)
            sents = [x.model_dump() for x in out.sentences]
            with session() as s:
                errs = validate_summary(s, case_id, sents, {k: v.result for k, v in vmap.items()})
            if errs:
                activity.log(case_id, "rule_engine", "summary_rejected", 10,
                             "The draft summary failed the checks (" + "; ".join(errs[:3]) + "). Drafting it once more.")
                raw = await client.raw("SUMMARISE", "", payload, case_id, retry_error="; ".join(errs))
                from ..llm.schemas import SummaryOut
                sents = [x.model_dump() for x in SummaryOut.model_validate(raw).sentences]
                with session() as s:
                    errs = validate_summary(s, case_id, sents, {k: v.result for k, v in vmap.items()})
            if not errs:
                sentences = sents
            else:
                activity.log(case_id, "rule_engine", "summary_rejected", 10,
                             "The second draft also failed the checks, so a plain summary was built from the results instead")
        except (JobFailure, Exception) as e:  # noqa: BLE001  (fall back, never invent)
            activity.log(case_id, "system", "summary_failed", 10, "The summary couldn't be drafted, so a plain summary was built from the results instead")
        with session() as s:
            if sentences is None:
                sentences = template_summary(s, case_id, list(vmap.values()))
                source = "template"
            summ = s.get(Summary, case_id) or Summary(case_id=case_id)
            summ.version = (summ.version or 0) + 1 if summ.sentences else 1
            summ.sentences, summ.source = sentences, source
            s.add(summ)
            s.commit()
        activity.log(case_id, "llm" if source == "llm" else "rule_engine", "summary_written", 10,
                     "Drafted the summary. Every sentence cites its evidence and passed the checks."
                     if source == "llm" else "Built a plain summary from the results")
        # what is still unknown (for step 11)
        ctx.progress(label="Listing what is still unknown")
        with session() as s:
            gaps = [{"code": h.code, "idea": h.text, "result": vmap[h.code].result,
                     "confidence": vmap[h.code].confidence} for h in hs if h.code in vmap
                    and (vmap[h.code].result in ("not_enough", "conflicting") or vmap[h.code].confidence == "low")]
            pend = [{"need": n.text, "idea": n.hypothesis_code} for n in
                    s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id,
                                                      EvidenceNeed.status == "pending")).all()]
        try:
            u = await llm.run(client, "UNKNOWNS", "", {"gaps": gaps, "pending": pend}, case_id)
            unknowns = [x.model_dump() for x in u.unknowns if x.idea in {h.code for h in hs}]
        except Exception:  # noqa: BLE001
            unknowns = [{"idea": g["code"], "text": f"{g['code']} rests on thin or borderline evidence."} for g in gaps]
        for g in gaps:
            if not any(x["idea"] == g["code"] for x in unknowns):
                conf = f", confidence {V.CONFIDENCE_LABELS[g['confidence']]}" if g["confidence"] != "none" else ""
                unknowns.append({"idea": g["code"], "text": f"{g['code']} ({RESULT_LABELS[g['result']]}{conf}) rests on "
                                 "thin or close-call evidence. More evidence would settle it."})
        with session() as s:
            summ = s.get(Summary, case_id)
            summ.unknowns = unknowns
            s.add(summ)
            c2 = C.get_case(s, case_id)
            c2.current_step = 11
            s.add(c2)
            s.commit()
        activity.log(case_id, "llm", "unknowns_listed", 11, f"Listed {len(unknowns)} things that are still unknown")

    return jobs.start(case_id, "addup", job, step=10)


def _resolve_map(items: dict) -> dict:
    out = {}
    for e in items.values():
        if e.seed_id:
            out[f"seed:{e.seed_id}"] = e.id
        if e.file_id and e.title:
            out[f"file:{e.title}"] = e.id
    return out


# ------------------------------------------------------------------ step 11

def sliders(s, case_id: int) -> list[dict]:
    r = rules()["sliders"]
    out = []
    for h in C.hypotheses(s, case_id):
        line = C.pass_line(h)
        if line is None:
            continue
        for a in h.assumptions_json or []:
            lo, hi = whatif.slider_range(float(a["value"]), a.get("unit", ""), a.get("min"), a.get("max"),
                                         r["default_range_pct"], tuple(r["zero_value_range"]), r["non_negative_units"])
            out.append({"kind": "assumption", "key": a["name"], "label": a["label"], "idea": h.code,
                        "value": float(a["value"]), "unit": a.get("unit", ""), "min": lo, "max": hi})
        lo, hi = whatif.slider_range(float(line), h.measure_unit, h.slider_min, h.slider_max,
                                     r["default_range_pct"], tuple(r["zero_value_range"]), r["non_negative_units"])
        out.append({"kind": "pass_line", "key": h.code, "label": f"{h.code} pass line ({h.measure_name})",
                    "idea": h.code, "value": float(line), "unit": h.measure_unit, "min": lo, "max": hi,
                    "formula": h.pass_line_formula or ""})
    return out


def what_if(case_id: int, assumptions: dict, pass_lines: dict) -> dict:
    """Recompute pass lines, verdicts and the overall result without writing to locked records."""
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "whatif")
        hs = C.hypotheses(s, case_id)
        items = C.items_by_id(s, case_id)
        links = C.links_for(s, case_id)
        current = {v.hypothesis_code: v for v in s.exec(select(Verdict).where(
            Verdict.case_id == case_id, Verdict.current == True)).all()}  # noqa: E712
        rows = []
        for h in hs:
            locked_line = C.pass_line(h)
            line = C.pass_line(h, assumptions)
            if h.code in (pass_lines or {}) and pass_lines[h.code] is not None:
                line = float(pass_lines[h.code])
            r = C.evaluate(h, items, links, line)
            cur = current.get(h.code)
            rows.append({"code": h.code, "text": h.text, "must_have": h.must_have, "unit": h.measure_unit,
                         "comparator": h.comparator, "line": line, "locked_line": locked_line,
                         "result": r.result, "confidence": r.confidence, "why": r.why,
                         "evidence_ids": r.evidence_ids,
                         "changed": bool(cur and (cur.result != r.result or cur.confidence != r.confidence))})
        overall, rule_text = V.adding_up([{"code": r["code"], "must_have": r["must_have"], "result": r["result"]}
                                          for r in rows])
        ov = s.get(Overall, case_id)
    return {"ideas": rows, "overall": overall, "overall_label": OVERALL_LABELS[overall], "rule_applied": rule_text,
            "overall_changed": bool(ov and ov.result != overall), "locked_plan_unchanged": True}


# ------------------------------------------------------------------ step 12

def save_conclusion(case_id: int, text: str) -> None:
    if not (text or "").strip():
        raise BadInput("Write the conclusion first")
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "conclusion")
        c = s.get(Conclusion, case_id) or Conclusion(case_id=case_id)
        c.text, c.saved_at = text, now()
        s.add(c)
        case.current_step = 12
        case.status = "concluded"
        s.add(case)
        s.commit()
    activity.log(case_id, "consultant", "conclusion_saved", 12, "Saved your conclusion")


# ------------------------------------------------------------------ exports and housekeeping

PRINCIPLE = ("The tool does the searching, sorting and maths and shows its working. You check what matters and "
             "make the call.")


def brief(case_id: int) -> dict:
    from .bundle import build
    return build(case_id)


def export_markdown(case_id: int) -> str:
    b = brief(case_id)
    c = b["case"]
    lines = [f"# Summary: {c['title']}", "", f"_{PRINCIPLE}_", "",
             f"**Client:** {c['client_name']} · **Country:** {c['country']} · **Industry:** {c['industry']} · "
             f"**Function:** {c['function']}", "", f"**The ask, as the client wrote it:** {c['raw_ask']}", ""]
    if b.get("frame"):
        f = b["frame"]
        lines += ["## The question", f"- What they believe (to be tested): {f['client_belief']}",
                  f"- The decision they face: {f['decision']}",
                  f"- How we compare numbers: {f['case_measure_name']} ({f['case_measure_definition']})", ""]
    lines += ["## Results", "", "| Idea | Target | Result | Confidence | Evidence |", "|---|---|---|---|---|"]
    for h in b["hypotheses"]:
        if h.get("removed_reason"):
            continue
        v = h.get("verdict") or {}
        conf = v.get("confidence")
        lines.append(f"| {h['code']} {h['text']}{' (critical)' if h['must_have'] else ''} | "
                     f"{'at least' if h['comparator'] == '>=' else 'at most'} {h['line_text']} | "
                     f"{RESULT_LABELS.get(v.get('result'), '—')} | "
                     f"{V.CONFIDENCE_LABELS.get(conf, '—') if conf and conf != 'none' else '—'} | "
                     f"{', '.join(v.get('evidence_ids') or []) or '—'} |")
    ov = b.get("overall")
    if ov:
        lines += ["", f"**The answer:** {OVERALL_LABELS[ov['result']]}. {ov['rule_applied']}"]
    if b.get("summary"):
        lines += ["", "## What the evidence says (each line cites its evidence)"]
        lines += [f"- {x['text']} [{', '.join(x['evidence_ids'])}]" for x in b["summary"]["sentences"]]
        if b["summary"].get("unknowns"):
            lines += ["", "## Still unknown"] + [f"- {u['idea']}: {u['text']}" for u in b["summary"]["unknowns"]]
    k = b["counts"]
    lines += ["", "## Evidence", f"- Collected: {k['collected']} · separate sources: {k['unique']} · passed the "
              f"quality check (sources reviewed by you): {k['auto_approved']} · decided by you: "
              f"{k['decided_by_person']} · rejected: {k['rejected']} · still waiting: {k['pending']}"]
    rej = [e for e in b["evidence"] if e["status"] == "rejected"]
    if rej:
        lines += ["", "### Rejected evidence (kept on record)"] + [f"- {e['id']} {e['title']}: {e['decision_reason']}"
                                                                   for e in rej]
    lines += ["", "## Your conclusion", "",
              (b.get("conclusion") or {}).get("text") or "_Not written yet._", ""]
    if c.get("sample"):
        lines += ["", "_Sample data (simulated)._"]
    return "\n".join(lines)


def export_json(case_id: int) -> str:
    b = brief(case_id)
    with session() as s:
        acts = s.exec(select(Activity).where(Activity.case_id == case_id).order_by(Activity.id)).all()
        b["activity"] = [a.model_dump() for a in acts]
    return json.dumps(b, indent=2, default=str)


def export_activity_csv(case_id: int) -> str:
    with session() as s:
        acts = s.exec(select(Activity).where(Activity.case_id == case_id).order_by(Activity.id)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "time", "actor", "step", "event", "message"])
    for a in acts:
        w.writerow([a.id, a.ts, a.actor, a.step, a.event_type, a.message])
    return buf.getvalue()


def reset_case(case_id: int) -> None:
    """Back to step 1 with the case details and client files kept. The activity record is never deleted."""
    from ..db import models as M
    with session() as s:
        case = C.get_case(s, case_id)
        for model in (M.Frame, M.RuleSet, M.Overall, M.Summary, M.Conclusion):
            obj = s.get(model, case_id)
            if obj:
                s.delete(obj)
        for model in (M.Hypothesis, M.EvidenceNeed, M.SourcePlanItem, M.EvidenceItem, M.EvidenceLink, M.Calc,
                      M.Verdict, M.Trip, M.Job):
            for obj in s.exec(select(model).where(model.case_id == case_id)).all():
                s.delete(obj)
        for f in s.exec(select(M.ClientFile).where(M.ClientFile.case_id == case_id)).all():
            if f.kind != "initial":
                s.delete(f)
            else:
                f.figures_json, f.describe_json = [], {}
                s.add(f)
        case.settings_json = {"ai_reads_client_files": (case.settings_json or {}).get("ai_reads_client_files", True)}
        case.current_step, case.status = 1, "open"
        s.add(case)
        s.commit()
    activity.log(case_id, "consultant", "case_reset", 1, "Reset the case to step 1")


def delete_case(case_id: int) -> None:
    from ..db import models as M
    with session() as s:
        C.get_case(s, case_id)
        reset_case(case_id)
        for model in (M.ClientFile, M.Activity, M.CostLedger):
            for obj in s.exec(select(model).where(model.case_id == case_id)).all():
                s.delete(obj)
        s.delete(s.get(Case, case_id))
        s.commit()


def status(case_id: int) -> dict:
    with session() as s:
        return step_status(s, C.get_case(s, case_id))
