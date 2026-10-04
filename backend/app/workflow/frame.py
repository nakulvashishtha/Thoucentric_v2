"""Steps 1 to 3: type the ask, check the frame, agree the plan and lock it."""
from __future__ import annotations

from sqlmodel import select

from .. import activity, jobs, samples
from ..db.models import (Case, ClientFile, EvidenceItem, EvidenceLink, Frame, Hypothesis, RuleSet, now)
from ..db.session import session
from ..engine import credibility, privacy, verify
from ..errors import BadInput, GateError, JobFailure
from ..files import parse as fparse
from ..llm import interface as llm
from ..settings import country_code, effective_mode, registry, rules
from ..state_machine import require
from . import common as C


# ------------------------------------------------------------------ step 1

def create_case(data: dict, mode: str | None = None, sample: str = "") -> int:
    fields = ["client_name", "country", "industry", "function", "raw_ask"]
    with session() as s:
        c = Case(title=data.get("title") or (data.get("client_name") or "New case"),
                 client_name=(data.get("client_name") or "").strip(),
                 client_aliases=[a.strip() for a in data.get("client_aliases") or [] if a and a.strip()],
                 private_numbers=[p.strip() for p in data.get("private_numbers") or [] if p and p.strip()],
                 country=(data.get("country") or "").strip(), industry=(data.get("industry") or "").strip(),
                 function=(data.get("function") or "").strip(), raw_ask=data.get("raw_ask") or "",
                 mode=mode or effective_mode()[0], sample=sample,
                 settings_json={"ai_reads_client_files": True})
        s.add(c)
        s.commit()
        cid = c.id
    activity.log(cid, "consultant", "case_created", 1,
                 "Started a case" + (" from a sample" if sample else ""),
                 {k: bool(data.get(k)) for k in fields})
    return cid


def update_case(case_id: int, data: dict) -> None:
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "edit_case")
        for k in ("client_name", "country", "industry", "function", "title"):
            if k in data:
                setattr(c, k, (data[k] or "").strip())
        if "raw_ask" in data:
            c.raw_ask = data["raw_ask"] or ""          # stored verbatim; nothing is tidied
        if "client_aliases" in data:
            c.client_aliases = [a.strip() for a in data["client_aliases"] if a and a.strip()]
        if "private_numbers" in data:
            c.private_numbers = [p.strip() for p in data["private_numbers"] if p and p.strip()]
        if "ai_reads_client_files" in data:
            C.flag(s, c, ai_reads_client_files=bool(data["ai_reads_client_files"]))
        c.updated_at = now()
        s.add(c)
        s.commit()
    activity.log(case_id, "consultant", "case_edited", 1, "Edited the case details",
                 {"fields": sorted(data.keys())})


def add_file(case_id: int, filename: str, data: bytes, kind: str = "initial", trip_id: int | None = None) -> int:
    if len(data) > rules()["limits"]["max_upload_mb"] * 1024 * 1024:
        raise BadInput(f"{filename} is larger than {rules()['limits']['max_upload_mb']} MB")
    try:
        text = fparse.parse(filename, data)
    except fparse.UnsupportedFile as e:
        raise BadInput(str(e))
    except Exception:
        raise BadInput(f"We couldn't read {filename}. Try again, or upload it as a csv, xlsx or txt file.")
    with session() as s:
        C.get_case(s, case_id)
        f = ClientFile(case_id=case_id, filename=filename, kind=kind, text_extract=text, trip_id=trip_id)
        s.add(f)
        s.commit()
        fid = f.id
    actor = "expert" if kind == "expert_note" else "client" if kind in ("initial", "followup") else "consultant"
    activity.log(case_id, actor, "file_uploaded", 1 if kind == "initial" else 9 if trip_id else 5,
                 f"Added the file {filename}",
                 {"file_id": fid})
    return fid


def set_file_figures(case_id: int, file_id: int, figures: list[dict]) -> None:
    """'AI reads client files: off' — the consultant types figures with a source locator."""
    with session() as s:
        f = s.get(ClientFile, file_id)
        if not f or f.case_id != case_id:
            raise BadInput("We couldn't find that file. Refresh the page and try again.")
        clean = []
        for fig in figures:
            if fig.get("value") in (None, "") or not fig.get("unit"):
                continue
            q = str(fig.get("quote_span") or fig["value"])
            clean.append({"value": float(fig["value"]), "unit": fig["unit"], "period": fig.get("period", ""),
                          "quote_span": q, "locator": fig.get("locator", ""), "kind": "reported",
                          "typed_by_consultant": True})
        f.figures_json = clean
        s.add(f)
        s.commit()
    activity.log(case_id, "consultant", "figures_typed", 1, f"Typed in {len(clean)} figures from a client file")


async def read_file(case: Case, f: ClientFile, step: int) -> list[dict]:
    """READ_SOURCE over a client file, then verify every quoted span in code."""
    with session() as s:
        dl = C.deny_list(s, case)
    out = await llm.run(C.llm_for(case), "READ_SOURCE", f"file:{f.filename}",
                        {"source_text": privacy.for_llm(f.text_extract[: rules()["limits"]["max_page_chars"]], dl),
                         "title": f.filename, "origin_type": "client_file"}, case.id)
    figs = []
    for fig in out.figures:
        d = fig.model_dump()
        d["kind"] = "reported"
        ok, note = verify.verify_figure(f.text_extract, d)
        d["verified"], d["verify_note"] = ok, note
        figs.append(d)
    with session() as s:
        ff = s.get(ClientFile, f.id)
        ff.figures_json = figs
        ff.describe_json = out.describe.model_dump()
        s.add(ff)
        s.commit()
    n_ok = len([x for x in figs if x["verified"]])
    activity.log(case.id, "llm", "file_read", step, f"Read {f.filename} and found {len(figs)} figures")
    activity.log(case.id, "rule_engine", "quotes_verified", step,
                 f"Found {n_ok} of {len(figs)} figures word for word in {f.filename}"
                 + ("" if n_ok == len(figs) else ". The others are marked as not found in the file."))
    return figs


def read_ask(case_id: int):
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "read_ask")
    activity.log(case_id, "consultant", "read_ask", 1, "Asked for the ask to be checked")

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            files = s.exec(select(ClientFile).where(ClientFile.case_id == case_id,
                                                    ClientFile.kind == "initial")).all()
            dl = C.deny_list(s, case)
        reads = bool((case.settings_json or {}).get("ai_reads_client_files", True))
        ctx.progress(label="Reading client files", done=0, total=len(files))
        for i, f in enumerate(files, start=1):
            if reads:
                await read_file(case, f, 1)
            ctx.progress(done=i)
        ctx.progress(label="Framing the question")
        payload = {"ask": privacy.for_llm(case.raw_ask, dl), "country": case.country, "industry": case.industry,
                   "function": case.function}
        out = await llm.run(C.llm_for(case), "FRAME", "", payload, case_id)
        with session() as s:
            fr = s.get(Frame, case_id) or Frame(case_id=case_id)
            for k, v in out.model_dump().items():
                setattr(fr, k, v)
            fr.proposed = out.model_dump()
            fr.confirmed_at = None
            s.add(fr)
            c2 = C.get_case(s, case_id)
            c2.current_step = 2
            s.add(c2)
            s.commit()
        activity.log(case_id, "llm", "frame_proposed", 2,
                     "Drafted the question: what the client believes, the decision they face, and how to compare numbers")

    return jobs.start(case_id, "frame", job, step=1)


# ------------------------------------------------------------------ step 2

def edit_frame(case_id: int, data: dict) -> None:
    keys = ("client_belief", "decision", "case_measure_name", "case_measure_definition")
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "edit_frame")
        fr = s.get(Frame, case_id)
        changed = []
        for k in keys:
            if k in data and data[k] != getattr(fr, k):
                setattr(fr, k, data[k])
                changed.append(k)
        s.add(fr)
        s.commit()
    if changed:
        activity.log(case_id, "consultant", "frame_edited", 2,
                     "Edited the question: " + ", ".join(FRAME_NAMES.get(k, k) for k in changed),
                     {"fields": changed})


def confirm_frame(case_id: int):
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "confirm_frame")
        fr = s.get(Frame, case_id)
        if not all([fr.client_belief.strip(), fr.decision.strip(), fr.case_measure_name.strip(),
                    fr.case_measure_definition.strip()]):
            raise GateError("Fill in all three boxes first.", ["belief", "decision", "measure"])
        fr.confirmed_at = now()
        s.add(fr)
        c.current_step = 3
        s.add(c)
        s.commit()
    activity.log(case_id, "consultant", "frame_confirmed", 2,
                 "Confirmed the question. The client's belief is now a claim to test, not a fact.")
    return start_plan(case_id)


def start_plan(case_id: int):
    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            fr = s.get(Frame, case_id)
            dl = C.deny_list(s, case)
            files = s.exec(select(ClientFile).where(ClientFile.case_id == case_id)).all()
        ctx.progress(label="Drafting the ideas to test")
        payload = {"frame": {k: privacy.for_llm(getattr(fr, k), dl) for k in
                             ("client_belief", "decision", "case_measure_name", "case_measure_definition")},
                   "ask": privacy.for_llm(case.raw_ask, dl),
                   "client_files": [{"name": f.filename, "figures": f.figures_json} for f in files],
                   "max_ideas": rules()["limits"]["max_ideas"]}
        out = await llm.run(C.llm_for(case), "PLAN_HYPOTHESES", "", payload, case_id)
        with session() as s:
            for old in s.exec(select(Hypothesis).where(Hypothesis.case_id == case_id)).all():
                s.delete(old)
            for i, idea in enumerate(out.ideas):
                s.add(Hypothesis(
                    case_id=case_id, code=idea.code, text=idea.text, fact_type=idea.fact_type,
                    measure_name=idea.measure_name, measure_unit=idea.measure_unit,
                    measure_definition=idea.measure_definition, comparator=idea.comparator,
                    pass_line_value=idea.pass_line_value, pass_line_formula=idea.pass_line_formula,
                    assumptions_json=[a.model_dump() for a in idea.assumptions],
                    tolerance_pct=idea.tolerance_pct or rules()["tolerance_pct_default"],
                    recency_category=idea.recency_category, pass_line_source_type=idea.source_type,
                    pass_line_source_note=idea.source_note, must_have=idea.must_have, order=i))
            rs = s.get(RuleSet, case_id) or RuleSet(case_id=case_id)
            rs.adding_up_rule = rules()["adding_up_rule"]
            rs.thresholds_json = {k: rules()[k] for k in ("tolerance_pct_default", "recency_months", "checklist",
                                                          "minimum_sources", "spot_check", "trips")}
            s.add(rs)
            s.commit()
            hs = C.hypotheses(s, case_id)
        activity.log(case_id, "llm", "ideas_drafted", 3, f"Drafted {len(out.ideas)} ideas to test, each with a target")
        # Benchmarks for pass lines are fetched now, before the plan locks and before client evidence is read.
        bench = [(h, next(i for i in out.ideas if i.code == h.code)) for h in hs
                 if h.pass_line_source_type == "benchmark"]
        ctx.progress(label="Fetching pass-line benchmarks", done=0, total=len(bench))
        for n, (h, idea) in enumerate(bench, start=1):
            await fetch_benchmark(case_id, h, idea.benchmark_need or idea.source_note)
            ctx.progress(done=n)
        with session() as s:
            c2 = C.get_case(s, case_id)
            C.flag(s, c2, plan_ready_at=now())
            s.commit()

    return jobs.start(case_id, "plan", job, step=3)


async def fetch_benchmark(case_id: int, h: Hypothesis, need_text: str) -> None:
    from .gather import read_and_verify  # shared reader

    with session() as s:
        case = C.get_case(s, case_id)
        dl = C.deny_list(s, case)
    sanitised, removed = privacy.sanitise(need_text, dl)
    q = await llm.run(C.llm_for(case), "GENERATE_QUERIES", f"bench:{h.code}", {"need": sanitised}, case_id)
    query = q.queries[0]
    blocked = privacy.check(query, dl)
    if blocked:
        activity.log(case_id, "rule_engine", "query_blocked", 3,
                     f"Blocked a search that contained a private term: {', '.join(blocked)}",
                     {"terms": blocked})
        return
    activity.log(case_id, "rule_engine", "query_checked", 3, f"Checked the benchmark search for {h.code}. It contains no private terms.", {"query": query, "removed": removed})
    search = C.search_for(case)
    if case.mode == "fixtures":
        results = search.benchmarks(h.code)
    else:
        results = await search.search(query, f"bench:{h.code}", "open_web", {"*"}, 2)
    for r in results[:2]:
        with session() as s:
            eid, seq = C.next_eid(s, case_id)
            e = EvidenceItem(case_id=case_id, id=eid, seq=seq, seed_id=r.seed_id, need_ref=f"bench:{h.code}",
                             origin_type="benchmark", found_in=r.found_in or r.origin_type,
                             source_name=r.source_name, title=r.title, url=r.url, domain=r.domain,
                             publisher=r.publisher, published_date=r.published_date, data_as_of=r.data_as_of,
                             text=r.text, simulated=r.simulated, status="pass_line_source", bucket="reference")
            s.add(e)
            s.commit()
        await read_and_verify(case, eid, step=3)
        with session() as s:
            e = s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id, EvidenceItem.id == eid)).one()
            tier, reason = credibility.grade_tier(e.domain, e.found_in, registry(), country_code(case.country),
                                                  case.industry)
            ok, actual = credibility.recency(e.data_as_of, e.published_date,
                                             rules()["recency_months"][h.recency_category], C.today())
            d = (e.credibility_json or {}).get("describe", {})
            e.credibility_json = {**e.credibility_json, "tier": tier, "tier_reason": reason, "recency_ok": ok,
                                  "recency_actual": actual, "traced": credibility.traced(
                                      tier, d.get("method_cited"), d.get("original_source_named")),
                                  "method_cited": bool(d.get("method_cited")),
                                  "original_source_name": d.get("original_source_name", "")}
            e.original_group_id = e.id
            s.add(e)
            s.add(EvidenceLink(case_id=case_id, evidence_id=eid, hypothesis_code=h.code, role="sets_pass_line",
                               figure_index=0, proposed_by="rule_engine", confirmed=True))
            s.commit()
        activity.log(case_id, "rule_engine", "benchmark_graded", 3,
                     f"Found a benchmark for the {h.code} target. Source quality: {credibility.tier_label(tier)}; date: {actual}",
                     {"evidence_id": eid})


# ------------------------------------------------------------------ step 3

FRAME_NAMES = {"client_belief": "what they believe", "decision": "the decision they face",
               "case_measure_name": "the measure", "case_measure_definition": "the measure's definition"}
FIELD_NAMES = {"text": "wording", "fact_type": "type", "measure_name": "measure", "measure_unit": "unit",
               "measure_definition": "measure definition", "comparator": "direction", "pass_line_value": "target",
               "pass_line_formula": "target formula", "assumptions_json": "assumptions", "slider_min": "slider range",
               "slider_max": "slider range", "tolerance_pct": "close-call margin",
               "pass_line_source_type": "target source", "pass_line_source_note": "target source note",
               "recency_category": "recency window"}

EDITABLE = {"text", "fact_type", "measure_name", "measure_unit", "measure_definition", "comparator",
            "pass_line_value", "pass_line_formula", "assumptions_json", "slider_min", "slider_max", "tolerance_pct",
            "pass_line_source_type", "pass_line_source_note", "must_have", "removed_reason", "recency_category"}


def edit_hypotheses(case_id: int, rows: list[dict]) -> None:
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "edit_hypotheses")
        existing = {h.code: h for h in C.hypotheses(s, case_id, include_removed=True)}
        changes = []
        for row in rows:
            h = existing.get(row.get("code"))
            if h is None:
                if len([x for x in existing.values() if not x.removed_reason]) >= rules()["limits"]["max_ideas"]:
                    raise BadInput(f"You can test up to {rules()['limits']['max_ideas']} ideas. Remove one first.")
                h = Hypothesis(case_id=case_id, code=row.get("code") or f"H{len(existing) + 1}",
                               text=row.get("text", ""), order=len(existing))
                existing[h.code] = h
                changes.append(f"added {h.code}")
            for k, v in row.items():
                if k in EDITABLE and getattr(h, k) != v:
                    if k == "removed_reason" and v is not None and not str(v).strip():
                        raise BadInput("Add a short reason for removing this idea.")
                    setattr(h, k, v)
                    if k == "removed_reason":
                        changes.append(f"removed {h.code} ({v})" if v else f"restored {h.code}")
                    elif k == "must_have":
                        changes.append(f"{h.code} {'is now' if v else 'is no longer'} critical")
                    else:
                        changes.append(f"changed the {FIELD_NAMES.get(k, k)} of {h.code}")
            s.add(h)
        s.commit()
    if changes:
        activity.log(case_id, "consultant", "plan_edited", 3, "Edited the ideas: " + "; ".join(changes[:8])
                     + (" …" if len(changes) > 8 else ""), {"changes": changes})


def plan_problems(s, case_id: int) -> list[str]:
    from ..engine import whatif
    hs = C.hypotheses(s, case_id)
    probs = []
    if not hs:
        probs.append("keep at least one idea")
    if not any(h.must_have for h in hs):
        probs.append("mark at least one idea as critical")
    links = C.links_for(s, case_id)
    for h in hs:
        if C.pass_line(h) is None:
            probs.append(f"give {h.code} a target")
        if h.pass_line_formula:
            try:
                whatif.eval_formula(h.pass_line_formula, C.assumption_values(h))
            except Exception as e:
                probs.append(f"the target formula for {h.code} doesn't work ({e})")
        if not h.measure_name.strip() or not h.measure_unit.strip():
            probs.append(f"give {h.code} a measure and unit")
        if h.fact_type not in ("market", "client_operational"):
            probs.append(f"choose a type for {h.code}")
        if not h.pass_line_source_note.strip():
            probs.append(f"say where the {h.code} target comes from")
        if h.pass_line_source_type == "benchmark" and not any(
                ln.hypothesis_code == h.code and ln.role == "sets_pass_line" for ln in links):
            probs.append(f"the {h.code} target says it comes from a benchmark, but no benchmark was found; change its source")
    return probs


def lock_plan(case_id: int, ticked: bool):
    with session() as s:
        c = C.get_case(s, case_id)
        require(s, c, "lock_plan")
        if not ticked:
            raise GateError("Tick the box to confirm the targets first.", ["Tick the box"])
        probs = plan_problems(s, case_id)
        if probs:
            raise GateError("Fix these first: " + "; ".join(probs) + ".", probs)
        t = now()
        for h in C.hypotheses(s, case_id, include_removed=True):
            h.locked_at = t
            s.add(h)
        rs = s.get(RuleSet, case_id)
        rs.locked_at = t
        s.add(rs)
        c.current_step = 4
        s.add(c)
        s.commit()
        n = len(C.hypotheses(s, case_id))
    activity.log(case_id, "consultant", "plan_locked", 3,
                 f"Locked the targets for {n} ideas. Targets, critical ideas and the quality check can no longer change.")
    from .gather import start_route
    return start_route(case_id)


def load_sample(name: str) -> int:
    pack = samples.load(name)
    d = pack["case"]["details"]
    cid = create_case({**d, "title": pack["case"].get("title")}, mode="fixtures", sample=name)
    for f in pack["case"].get("client_files", []):
        add_file(cid, f["filename"], samples.file_bytes(name, f["filename"]), f.get("kind", "initial"))
    activity.log(cid, "system", "sample_loaded", 1, "Loaded a sample case. Its data is simulated.")
    return cid


def describe_err(e: Exception) -> str:
    return str(e) if isinstance(e, (JobFailure, GateError, BadInput)) else type(e).__name__
