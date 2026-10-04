"""Steps 4 to 7: plan the evidence, collect, clean and grade, review."""
from __future__ import annotations

import asyncio
import random

from sqlmodel import select

from .. import activity, jobs
from ..db.models import (Calc, Case, ClientFile, EvidenceItem, EvidenceLink, EvidenceNeed, Frame, SourcePlanItem,
                         now)
from ..db.session import session
from ..engine import checklist as CL, convert, credibility, dedup, privacy, spotcheck, verify
from ..errors import BadInput, GateError
from ..llm import interface as llm
from ..settings import country_code, registry, rules
from ..state_machine import require
from . import common as C

ORIGIN_GROUPS = [("open_web", "Open web"), ("firm_archive", "Firm archive"),
                 ("paid_db", "Paid or simulated databases"), ("client_file", "Client files"),
                 ("expert_note", "Expert notes")]


# ------------------------------------------------------------------ step 4

def default_source_plan(case: Case) -> list[dict]:
    """Live mode: a plan built from the registry pack for the case's country, plus the generic groups."""
    plan = [{"source_name": "Firm research archive", "domain": "", "origin_type": "firm_archive", "included": True},
            {"source_name": "Open web search", "domain": "", "origin_type": "open_web", "included": True}]
    code = country_code(case.country)
    pack = (registry().get("countries") or {}).get(code or "", {})
    for dom in (pack.get("tier1") or [])[:6] + (registry()["global"].get("tier1") or [])[:2]:
        plan.append({"source_name": dom.replace("*.", "Sites under "), "domain": dom, "origin_type": "open_web",
                     "included": True})
    return plan


def start_route(case_id: int):
    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            hs = C.hypotheses(s, case_id)
            files = s.exec(select(ClientFile).where(ClientFile.case_id == case_id)).all()
            dl = C.deny_list(s, case)
        ctx.progress(label="Checking client files and routing each need")
        payload = {"ideas": [{"code": h.code, "text": privacy.for_llm(h.text, dl), "measure": h.measure_name,
                              "unit": h.measure_unit} for h in hs],
                   "client_files": [{"name": f.filename, "figures": f.figures_json,
                                     "excerpt": privacy.for_llm(f.text_extract[:1500], dl)} for f in files]}
        out = await llm.run(C.llm_for(case), "ROUTE_NEEDS", "", payload, case_id)
        codes = {h.code for h in hs}
        by_name = {f.filename: f for f in files}
        with session() as s:
            for old in s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all():
                s.delete(old)
            for n in out.needs:
                if n.idea not in codes:
                    continue
                need = EvidenceNeed(case_id=case_id, ref=n.ref, hypothesis_code=n.idea, text=n.text, route=n.route,
                                    coverage=n.coverage, coverage_note=n.missing)
                if n.coverage != "not_covered":
                    f = by_name.get(n.file or "")
                    # the engine verifies that the cited location exists in the file
                    if f and verify.locate(f.text_extract, n.locator) is not None:
                        need.covered_by_file_id, need.covered_locator = f.id, n.locator
                    else:
                        need.coverage = "not_covered"
                        need.coverage_note = (f"The model cited {n.file or 'a file'} at '{n.locator}', but that "
                                              "location was not found, so this is treated as not covered.")
                need.status = "answered" if need.coverage == "answered_by_client_file" else "open"
                s.add(need)
            s.commit()
        activity.log(case_id, "llm", "needs_routed", 4,
                     f"Listed {len(out.needs)} things to find out and checked which ones the client's files already answer")
        activity.log(case_id, "rule_engine", "locators_checked", 4,
                     "Checked that every cited place in the client's files exists")
        # source plan
        with session() as s:
            case = C.get_case(s, case_id)
            if not s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id)).first():
                pack = C.pack_for(case)
                plan = pack["case"]["source_plan"] if pack else default_source_plan(case)
                for p in plan:
                    s.add(_plan_item(case, p))
            s.commit()
        # outbound queries for desk needs: sanitise, generate, then the hard filter
        with session() as s:
            needs = s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all()
        desk = [n for n in needs if n.route == "desk"]
        ctx.progress(label="Writing search queries", done=0, total=len(desk))
        for i, n in enumerate(desk, start=1):
            sanitised, removed = privacy.sanitise(n.text, dl)
            q = await llm.run(C.llm_for(case), "GENERATE_QUERIES", n.ref, {"need": sanitised}, case_id)
            rows = []
            for query in q.queries[:1]:                 # one query per need (cost control)
                blocked = privacy.check(query, dl)
                rows.append({"original": n.text, "sanitised": sanitised, "removed": removed, "query": query,
                             "blocked": blocked})
                if blocked:
                    activity.log(case_id, "rule_engine", "query_blocked", 4,
                                 f"Blocked a search that contained a private term: {', '.join(blocked)}",
                                 {"terms": blocked})
            with session() as s:
                nn = s.get(EvidenceNeed, n.id)
                nn.queries_json = rows
                s.add(nn)
                s.commit()
            ctx.progress(done=i)
        activity.log(case_id, "rule_engine", "outbound_sanitised", 4,
                     "Removed the client's name and private numbers from every search and request")
        build_requests(case_id)
        with session() as s:
            c2 = C.get_case(s, case_id)
            C.flag(s, c2, route_done=now())
            s.commit()

    return jobs.start(case_id, "route", job, step=4)


def _plan_item(case: Case, p: dict) -> SourcePlanItem:
    overrides = {}
    if p.get("stated_tier"):
        overrides[p.get("domain") or p["source_name"]] = (int(p["stated_tier"]), p.get("reason", ""))
    tier, reason = credibility.grade_tier(p.get("domain"), p.get("origin_type", "open_web"), registry(),
                                          country_code(case.country), case.industry, overrides)
    if not p.get("domain") and p.get("origin_type") == "open_web":
        tier, reason = None, "Each result is graded by its own domain"
    return SourcePlanItem(case_id=case.id, source_name=p["source_name"], domain=p.get("domain", ""),
                          origin_type=p.get("origin_type", "open_web"), tier=tier, tier_reason=reason,
                          stated_by_consultant=bool(p.get("stated_tier")), included=bool(p.get("included", True)),
                          removed_reason=p.get("removed_reason"))


def build_requests(case_id: int) -> None:
    """Copy-ready client request (only the gaps) and expert questions. The app sends nothing."""
    with session() as s:
        case = C.get_case(s, case_id)
        needs = s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all()
        files = {f.id: f for f in s.exec(select(ClientFile).where(ClientFile.case_id == case_id)).all()}
        dl = C.deny_list(s, case)
        have = []
        for n in needs:
            if n.coverage in ("answered_by_client_file", "partly") and n.covered_by_file_id in files:
                have.append(f"- {files[n.covered_by_file_id].filename} ({n.covered_locator}): "
                            f"{privacy.for_llm(n.text, dl)}" + (" (partly)" if n.coverage == "partly" else ""))
        gaps = [n for n in needs if n.route == "client" and n.coverage != "answered_by_client_file"]
        client_text = "What we already have from you\n" + ("\n".join(have) or "- Nothing yet") + \
            "\n\nWhat we still need\n" + ("\n".join(
                f"{i}. {privacy.for_llm(n.text, dl)}" + (f" Missing: {n.coverage_note}" if n.coverage_note else "")
                for i, n in enumerate(gaps, start=1)) or "- Nothing: your files already cover every request.")
        expert = [n for n in needs if n.route == "expert"]
        ex_lines, ex_removed = [], []
        for i, n in enumerate(expert, start=1):
            clean, removed = privacy.sanitise(n.text, dl)
            ex_lines.append(f"{i}. {clean}")
            ex_removed += removed
        expert_text = "Questions for experts\n" + ("\n".join(ex_lines) or "- None")
        blocked = privacy.check(expert_text, dl)
        C.flag(s, case, requests={"client": client_text, "client_gaps": len(gaps), "client_have": len(have),
                                  "expert": expert_text, "expert_removed": sorted(set(ex_removed)),
                                  "expert_blocked": blocked})
        s.commit()


def edit_source_plan(case_id: int, rows: list[dict]) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "edit_source_plan")
        existing = {p.id: p for p in s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id)).all()}
        msgs = []
        for r in rows:
            if r.get("id") in existing:
                p = existing[r["id"]]
                if "included" in r and bool(r["included"]) != p.included:
                    if not r["included"] and not (r.get("removed_reason") or "").strip():
                        raise BadInput("Unticking a source needs a short reason")
                    p.included = bool(r["included"])
                    p.removed_reason = None if p.included else r.get("removed_reason")
                    msgs.append(f"{'included' if p.included else 'removed'} {p.source_name}")
                s.add(p)
            else:
                if not r.get("source_name") or not r.get("stated_tier") or not (r.get("reason") or "").strip():
                    raise BadInput("A new source needs a name, a stated tier and a reason")
                s.add(_plan_item(case, r))
                msgs.append(f"added {r['source_name']} as Tier {r['stated_tier']}")
        s.commit()
    if msgs:
        activity.log(case_id, "consultant", "source_plan_edited", 4, "Edited the sources: " +
                     "; ".join(msgs))


def mark_sent(case_id: int, reviewed: bool):
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "mark_sent")
        if not reviewed:
            raise GateError("Tick 'I have reviewed the coverage, the source plan and what leaves the firm' first.",
                            ["Review tick"])
        C.flag(s, case, step4_reviewed_at=now(), requests_marked_sent_at=now())
        case.current_step = 5
        s.commit()
    activity.log(case_id, "consultant", "reviewed_outbound", 4,
                 "Checked the answers, the sources and what goes out")
    activity.log(case_id, "consultant", "requests_marked_sent", 4,
                 "Marked the client request and expert questions as sent. The tool sent nothing itself.")
    return start_collect(case_id)


# ------------------------------------------------------------------ step 5

def _new_item(s, case: Case, r, need_ref: str, status: str = "pending_clean", **kw) -> EvidenceItem:
    eid, seq = C.next_eid(s, case.id)
    e = EvidenceItem(case_id=case.id, id=eid, seq=seq, seed_id=r.seed_id, need_ref=need_ref,
                     origin_type=r.origin_type, source_name=r.source_name, title=r.title, url=r.url,
                     domain=credibility.normalise_domain(r.domain or r.url), publisher=r.publisher,
                     published_date=r.published_date, data_as_of=r.data_as_of, text=r.text,
                     text_hash=dedup.text_hash(r.text), simulated=r.simulated, script_tag=r.script_tag,
                     status="unreadable" if r.unreadable else status, **kw)
    s.add(e)
    s.commit()
    return e


def start_collect(case_id: int):
    with session() as s:
        require(s, C.get_case(s, case_id), "collect")
        if (C.get_case(s, case_id).settings_json or {}).get("collect_finished_at"):
            raise GateError("Collection has already finished.", [])

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            needs = s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all()
            plan = s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id)).all()
            files = s.exec(select(ClientFile).where(ClientFile.case_id == case_id,
                                                    ClientFile.kind == "initial")).all()
            dl = C.deny_list(s, case)
        included = {p.source_name for p in plan if p.included} | {"Experts"}
        limit = rules()["fast_demo"]["max_sources_per_need"]
        search = C.search_for(case)
        groups = {g: {"label": label, "done": 0, "total": 0, "state": "waiting"} for g, label in ORIGIN_GROUPS}
        ctx.progress(label="Collecting", groups=groups, pending=[])
        activity.log(case_id, "rule_engine", "collect_started", 5,
                     "Started collecting evidence from the chosen sources")
        stopped = False
        desk = [n for n in needs if n.route == "desk"]
        sem = asyncio.Semaphore(rules()["fast_demo"]["search_concurrency"])

        async def one(n: EvidenceNeed, origin: str):
            q = next((r for r in (n.queries_json or []) if not r.get("blocked")), None)
            if not q:
                return []
            if privacy.check(q["query"], dl):        # hard filter right before every outbound call
                activity.log(case_id, "rule_engine", "query_blocked", 5, "Blocked a search that contained a private term")
                return []
            async with sem:
                return await search.search(q["query"], n.ref, origin, included, limit)

        for origin in ("open_web", "firm_archive", "paid_db"):
            if not any(p.included and p.origin_type == origin for p in plan):
                groups[origin]["state"] = "not in plan"
                continue
            groups[origin]["state"] = "searching"
            ctx.progress(groups=groups)
            results = await asyncio.gather(*[one(n, origin) for n in desk])
            flat = [(n, r) for n, rs in zip(desk, results) for r in rs]
            groups[origin]["total"] = len(flat)
            for n, r in flat:
                if ctx.stop_requested:
                    stopped = True
                    break
                with session() as s:
                    _new_item(s, case, r, n.ref)
                groups[origin]["done"] += 1
                ctx.progress(groups=groups)
                await C.pause(case)
            groups[origin]["state"] = "stopped" if stopped else "done"
            ctx.progress(groups=groups)
            activity.log(case_id, "rule_engine", "group_collected", 5,
                         f"{groups[origin]['label']}: collected {groups[origin]['done']} items")
            if stopped:
                break
        # client files already received are used first
        if not stopped:
            groups["client_file"].update(state="reading", total=len(files))
            for f in files:
                with session() as s:
                    covering = [n for n in needs if n.covered_by_file_id == f.id]
                    need = next((n for n in covering if n.coverage == "answered_by_client_file"), None) or \
                        (covering[0] if covering else None)
                    eid, seq = C.next_eid(s, case_id)
                    s.add(EvidenceItem(case_id=case_id, id=eid, seq=seq, need_ref=need.ref if need else "",
                                       origin_type="client_file", source_name=f"Client file: {f.filename}",
                                       title=f.filename, publisher="Client", text=f.text_extract,
                                       text_hash=dedup.text_hash(f.text_extract), file_id=f.id,
                                       simulated=bool(case.sample), figures_json=f.figures_json,
                                       published_date=(f.describe_json or {}).get("published_date", ""),
                                       data_as_of=(f.describe_json or {}).get("data_as_of", "")))
                    s.commit()
                groups["client_file"]["done"] += 1
                ctx.progress(groups=groups)
                await C.pause(case)
            groups["client_file"]["state"] = "done"
            activity.log(case_id, "client", "client_files_used", 5,
                         f"Added the {len(files)} client files you already had as evidence")
        # expert replies: in fixtures mode the sample's simulated replies arrive now
        if not stopped and case.mode == "fixtures":
            arrivals = search.arrivals("expert_note")
            groups["expert_note"].update(state="receiving", total=len(arrivals))
            for r in arrivals:
                with session() as s:
                    _new_item(s, case, r, r.extra.get("need_ref", ""))
                groups["expert_note"]["done"] += 1
                ctx.progress(groups=groups)
                await C.pause(case)
            groups["expert_note"]["state"] = "done"
            if arrivals:
                activity.log(case_id, "expert", "expert_notes_received", 5,
                             f"Received {len(arrivals)} expert notes (sample data, simulated)")
        # what has not arrived stays visible as pending
        pending = []
        with session() as s:
            # files that were already received do not answer the gaps they only partly cover
            have_needs = {e.need_ref for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all()
                          if e.file_id is None or e.origin_type == "expert_note"}
            for n in needs:
                if n.route in ("client", "expert") and n.coverage != "answered_by_client_file" and n.ref not in have_needs:
                    eid, seq = C.next_eid(s, case_id)
                    who = "the client" if n.route == "client" else "experts"
                    s.add(EvidenceItem(case_id=case_id, id=eid, seq=seq, need_ref=n.ref,
                                       origin_type="client_file" if n.route == "client" else "expert_note",
                                       source_name=f"Awaiting {who}", title=f"Awaiting {who}: {n.text}",
                                       status="pending", bucket="pending"))
                    nn = s.get(EvidenceNeed, n.id)
                    nn.status = "pending"
                    s.add(nn)
                    pending.append({"id": eid, "need": n.ref, "text": n.text, "from": who})
            case2 = C.get_case(s, case_id)
            C.flag(s, case2, collect_finished_at=now(), collect_stopped=stopped)
            case2.current_step = 6
            s.commit()
        ctx.progress(pending=pending, label="Stopped" if stopped else "Finished")
        for p in pending:
            activity.log(case_id, "rule_engine", "pending", 5, f"Still waiting for {p['id']} from {p['from']}: {p['text']}")
        activity.log(case_id, "system", "collect_finished", 5,
                     "Stopped collecting. Moving on with what has arrived." if stopped
                     else "Finished collecting. Checking the evidence now.")
        start_clean(case_id)

    return jobs.start(case_id, "collect", job, step=5)


def stop_collect(case_id: int) -> None:
    j = jobs.running(case_id, "collect")
    if j:
        jobs.request_stop(j.id)
        activity.log(case_id, "consultant", "collect_stop", 5, "Stopped collecting")


def add_reply(case_id: int, filename: str, data: bytes, kind: str):
    from .frame import add_file
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "upload_reply")
    fid = add_file(case_id, filename, data, kind)

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            f = s.get(ClientFile, fid)
            eid, seq = C.next_eid(s, case_id)
            s.add(EvidenceItem(case_id=case_id, id=eid, seq=seq, origin_type=kind if kind == "expert_note" else "client_file",
                               source_name=("Expert note: " if kind == "expert_note" else "Client file: ") + filename,
                               title=filename, publisher="Expert" if kind == "expert_note" else "Client",
                               text=f.text_extract, text_hash=dedup.text_hash(f.text_extract), file_id=fid))
            s.commit()
        activity.log(case_id, "expert" if kind == "expert_note" else "client", "reply_received", 5,
                     f"Reply received as {eid} ({filename})")

    return jobs.start(case_id, f"reply_{fid}", job, step=5)


# ------------------------------------------------------------------ step 6

async def read_and_verify(case: Case, eid: str, step: int = 6) -> None:
    """READ_SOURCE (figures and source description in one call), then verify every quote in code."""
    with session() as s:
        e = s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case.id, EvidenceItem.id == eid)).one()
        dl = C.deny_list(s, case)
        f = s.get(ClientFile, e.file_id) if e.file_id else None
    if f is not None and f.figures_json:          # client files were read once at upload
        figs = [dict(x) for x in f.figures_json]
        desc = f.describe_json or {}
    else:
        key = e.seed_id or (f"file:{f.filename}" if f else e.id)
        text = privacy.for_llm(_window(e.text), dl)
        out = await llm.run(C.llm_for(case), "READ_SOURCE", key,
                            {"source_text": text, "title": e.title, "publisher": e.publisher, "url": e.url,
                             "published_date": e.published_date, "origin_type": e.origin_type}, case.id)
        figs = []
        for fig in out.figures:
            d = fig.model_dump()
            d["kind"] = "reported"
            figs.append(d)
        desc = out.describe.model_dump()
    for d in figs:
        if d.get("kind") != "calculated":
            ok, note = verify.verify_figure(e.text, d)
            d["verified"], d["verify_note"] = ok, note
    with session() as s:
        e = s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case.id, EvidenceItem.id == eid)).one()
        e.figures_json = figs
        e.credibility_json = {**(e.credibility_json or {}), "describe": desc}
        if not e.published_date and desc.get("published_date"):
            e.published_date = desc["published_date"]
        if not e.data_as_of and desc.get("data_as_of"):
            e.data_as_of = desc["data_as_of"]
        s.add(e)
        s.commit()


def _window(text: str) -> str:
    """Send only the text around candidate figures, at most max_page_chars (cost control)."""
    limit = rules()["limits"]["max_page_chars"]
    if len(text or "") <= limit:
        return text or ""
    import re
    hits = [m.start() for m in re.finditer(r"\d", text)]
    if not hits:
        return text[:limit]
    centre = hits[len(hits) // 2]
    start = max(0, min(centre - limit // 2, len(text) - limit))
    return text[start:start + limit]


def start_clean(case_id: int):
    with session() as s:
        require(s, C.get_case(s, case_id), "clean")

    async def job(ctx: jobs.JobCtx) -> None:
        with session() as s:
            case = C.get_case(s, case_id)
            items = [e for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id,
                                                                  EvidenceItem.trip_id == None)).all()  # noqa: E711
                     if e.status == "pending_clean"]
            hs = {h.code: h for h in C.hypotheses(s, case_id)}
            needs = {n.ref: n for n in s.exec(select(EvidenceNeed).where(EvidenceNeed.case_id == case_id)).all()}
            frame = s.get(Frame, case_id)
            dl = C.deny_list(s, case)
        ctx.progress(label="Checking for copies before reading", done=0, total=len(items), stage="dedup_pre")
        # 1. copies by address or identical text are found before reading, so they cost nothing
        pre = dedup.pre_read_duplicates([(e.id, e.url, e.text) for e in items if e.origin_type not in
                                         ("client_file", "expert_note")])
        with session() as s:
            for e in items:
                if e.id in pre:
                    ee = _get(s, case_id, e.id)
                    ee.duplicate_of, ee.duplicate_rule = pre[e.id], "same address or identical text"
                    ee.status, ee.bucket = "duplicate", "duplicate"
                    s.add(ee)
            s.commit()
        if pre:
            activity.log(case_id, "rule_engine", "copies_found", 6,
                         f"Found {len(pre)} exact copies before reading, so they weren't read twice")
        to_read = [e for e in items if e.id not in pre]
        ctx.progress(label="Reading sources", done=0, total=len(to_read), stage="read")
        sem = asyncio.Semaphore(rules()["fast_demo"]["extraction_concurrency"])
        done = 0

        async def read(e: EvidenceItem):
            nonlocal done
            async with sem:
                await read_and_verify(case, e.id)
                await C.pause(case)
            done += 1
            ctx.progress(done=done)

        await asyncio.gather(*[read(e) for e in to_read])
        activity.log(case_id, "llm", "sources_read", 6,
                     f"Read {len(to_read)} sources and pulled out each figure with its quote")
        with session() as s:
            fresh = [_get(s, case_id, e.id) for e in to_read]
        nfig = sum(len(e.figures_json) for e in fresh)
        nver = sum(1 for e in fresh for f in e.figures_json if f.get("verified"))
        activity.log(case_id, "rule_engine", "quotes_verified", 6,
                     f"Found {nver} of {nfig} figures word for word in their sources. "
                     f"{nfig - nver} couldn't be found and won't count in the tests.")
        # 2. grade tier, then de-duplicate (earliest, most primary item is the original)
        ctx.progress(label="Grading credibility and tracing copies", stage="grade")
        cc = country_code(case.country)
        overrides = _plan_overrides(case_id)
        with session() as s:
            for e in fresh + [x for x in items if x.id in pre]:
                ee = _get(s, case_id, e.id)
                tier, reason = credibility.grade_tier(ee.domain, ee.origin_type, registry(), cc, case.industry,
                                                      overrides)
                d = (ee.credibility_json or {}).get("describe", {})
                ee.credibility_json = {**ee.credibility_json, "tier": tier, "tier_reason": reason,
                                       "method_cited": bool(d.get("method_cited")),
                                       "original_source_name": d.get("original_source_name", ""),
                                       "traced": credibility.traced(tier, d.get("method_cited"),
                                                                    d.get("original_source_named"))}
                s.add(ee)
            s.commit()
            fresh = [_get(s, case_id, e.id) for e in to_read]
            counted = [e for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all()
                       if e.status in C.COUNTED_STATUSES and not e.duplicate_of]
        ditems = [_dedup_item(e) for e in fresh + counted]
        res = dedup.group_items(ditems, rules()["dedup"]["similarity_threshold"])
        with session() as s:
            for e in fresh:
                ee = _get(s, case_id, e.id)
                ee.original_group_id = res.group_of.get(e.id, e.id)
                if res.duplicate_of.get(e.id):
                    ee.duplicate_of, ee.duplicate_rule = res.duplicate_of[e.id], res.rule_of.get(e.id, "copy")
                    ee.status, ee.bucket = "duplicate", "duplicate"
                s.add(ee)
            for e in items:
                if e.id in pre:
                    ee = _get(s, case_id, e.id)
                    root = _get(s, case_id, pre[e.id])
                    ee.original_group_id = root.original_group_id or root.id
                    if root.duplicate_of:
                        ee.duplicate_of = root.duplicate_of
                    s.add(ee)
            s.commit()
        ndup = len([1 for v in res.duplicate_of.values() if v])
        activity.log(case_id, "rule_engine", "deduplicated", 6,
                     f"Traced {ndup} copies to their original source. Each original counts once.")
        # 3. links (default: the need's idea) and derived figures computed by the engine
        ctx.progress(label="Linking evidence to ideas", stage="link")
        with session() as s:
            uniques = [e for e in (_get(s, case_id, x.id) for x in to_read) if not e.duplicate_of]
        for e in uniques:
            await link_and_derive(case, e.id, hs, needs)
        # 4. recency, belief match, privacy and the checklist
        ctx.progress(label="Running the checklist", stage="checklist")
        with session() as s:
            all_links = C.links_for(s, case_id)
            for e in uniques:
                ee = _get(s, case_id, e.id)
                _grade_and_check(s, case, ee, hs, all_links, frame, dl)
            s.commit()
            # Tier 3 corroboration needs the other items graded first, so run the checklist once more
            for e in uniques:
                ee = _get(s, case_id, e.id)
                _grade_and_check(s, case, ee, hs, all_links, frame, dl)
            s.commit()
            auto = [e.id for e in (_get(s, case_id, x.id) for x in uniques) if e.status == "auto_approved"]
            dec = [e.id for e in (_get(s, case_id, x.id) for x in uniques) if e.status == "needs_decision"]
        activity.log(case_id, "rule_engine", "checklist_run", 6,
                     f"Ran the quality check: {len(auto)} passed, {len(dec)} need your call")
        # 5. spot check of auto-approved items
        pack = C.pack_for(case)
        seed = pack["seed"] if pack else random.SystemRandom().randint(1, 10**9)
        picks = spotcheck.pick(auto, seed, rules()["spot_check"]["fraction"], rules()["spot_check"]["minimum"])
        with session() as s:
            for eid in picks:
                ee = _get(s, case_id, eid)
                ee.spot_check_selected = True
                s.add(ee)
            case2 = C.get_case(s, case_id)
            C.flag(s, case2, clean_finished_at=now(), spot_seed=seed)
            case2.current_step = 7
            s.commit()
        activity.log(case_id, "rule_engine", "spot_check_picked", 6,
                     f"Picked {len(picks)} of the {len(auto)} items that passed for a quick double-check: "
                     f"{', '.join(picks) or 'none'} (seed {seed})", {"seed": seed, "picks": picks})

    return jobs.start(case_id, "clean", job, step=6)


def _get(s, case_id: int, eid: str) -> EvidenceItem:
    return s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id, EvidenceItem.id == eid)).one()


def _plan_overrides(case_id: int) -> dict:
    with session() as s:
        return {p.domain: (p.tier, p.tier_reason) for p in
                s.exec(select(SourcePlanItem).where(SourcePlanItem.case_id == case_id)).all()
                if p.stated_by_consultant and p.domain and p.tier}


def _dedup_item(e: EvidenceItem) -> dedup.DedupItem:
    figs = []
    for f in e.figures_json or []:
        if f.get("verified") and f.get("kind") != "calculated":
            lo = f["value"] if f.get("value") is not None else f["low"]
            hi = f["value"] if f.get("value") is not None else f["high"]
            figs.append((float(lo), float(hi)))
    return dedup.DedupItem(e.id, e.origin_type, e.url, e.published_date or "", (e.credibility_json or {}).get("tier"),
                           (e.credibility_json or {}).get("original_source_name", ""), e.text, figs)


async def link_and_derive(case: Case, eid: str, hs: dict, needs: dict, step: int = 6) -> None:
    """LINK_EVIDENCE proposes links and derivations; the engine computes derived figures and unit checks."""
    with session() as s:
        e = _get(s, case.id, eid)
        f = s.get(ClientFile, e.file_id) if e.file_id else None
        dl = C.deny_list(s, case)
    key = e.seed_id or (f"file:{f.filename}" if f else e.id)
    need = needs.get(e.need_ref)
    payload = {"evidence": {"id": e.id, "title": e.title, "figures": e.figures_json,
                            "excerpt": privacy.for_llm(e.text[:1200], dl)},
               "ideas": [{"code": h.code, "text": privacy.for_llm(h.text, dl), "measure": h.measure_name,
                          "unit": h.measure_unit} for h in hs.values()],
               "default_idea": need.hypothesis_code if need else None}
    out = await llm.run(C.llm_for(case), "LINK_EVIDENCE", key, payload, case.id)
    figs = [dict(x) for x in e.figures_json]
    base_n = len(figs)
    calcs = []
    for d in out.derivations:
        if d.a_ref >= base_n or d.b_ref >= base_n:
            continue
        a, b = figs[d.a_ref], figs[d.b_ref]
        av = a["value"] if a.get("value") is not None else a.get("low")
        bv = b["value"] if b.get("value") is not None else b.get("low")
        r = convert.derive(d.op, float(av), a.get("unit", ""), float(bv), b.get("unit", ""), d.result_unit, d.years,
                           a.get("period"), b.get("period"))
        verified = bool(a.get("verified") and b.get("verified") and r.value is not None)
        pa, pb = a.get("period", ""), b.get("period", "")
        figs.append({"value": r.value, "unit": d.result_unit, "period": pa if pa == pb else f"{pa} to {pb}".strip(" to"),
                     "kind": "calculated", "quote_span": "", "locator": "", "verified": verified,
                     "verify_note": "recomputed from its stored inputs" if verified else "inputs not verified",
                     "derivation": {"op": d.op, "input_figure_refs": [d.a_ref, d.b_ref], "years": d.years,
                                    "result_unit": d.result_unit, "rationale": d.rationale, "formula": r.formula,
                                    "unit_ok": r.unit_ok, "years_ok": r.years_ok, "note": r.note,
                                    "formula_confirmed": False}})
        calcs.append(Calc(case_id=case.id, evidence_ids=[e.id], formula_text=r.formula,
                          inputs_json={"a": av, "a_unit": a.get("unit"), "b": bv, "b_unit": b.get("unit"),
                                       "years": d.years, "op": d.op}, result_value=r.value, unit=d.result_unit))
    links = [ln for ln in out.links if ln.idea in hs and ln.figure_index < len(figs)]
    if not links and need and need.hypothesis_code in hs and figs:
        from ..llm.schemas import LinkOut
        links = [LinkOut(idea=need.hypothesis_code, role="supports_test", figure_index=0)]
    with session() as s:
        ee = _get(s, case.id, eid)
        ee.figures_json = figs
        s.add(ee)
        for old in s.exec(select(EvidenceLink).where(EvidenceLink.case_id == case.id,
                                                     EvidenceLink.evidence_id == eid)).all():
            s.delete(old)
        for ln in links:
            s.add(EvidenceLink(case_id=case.id, evidence_id=eid, hypothesis_code=ln.idea, role=ln.role,
                               figure_index=ln.figure_index, proposed_by="llm"))
        for c in calcs:
            s.add(c)
        s.commit()
    if calcs:
        activity.log(case.id, "rule_engine", "derived", step,
                     f"Worked out {len(calcs)} figure(s) for {eid}: "
                     + "; ".join(c.formula_text for c in calcs) + ". You confirm the formula.")


def _grade_and_check(s, case: Case, e: EvidenceItem, hs: dict, links: list, frame, dl) -> None:
    my_links = [ln for ln in links if ln.evidence_id == e.id]
    primary = next((ln for ln in my_links if ln.role == "supports_test"), None) or (my_links[0] if my_links else None)
    h = hs.get(primary.hypothesis_code) if primary else None
    window = rules()["recency_months"][h.recency_category if h else "size_growth_price"]
    recent, rec_actual = credibility.recency(e.data_as_of, e.published_date, window, C.today())
    cred = dict(e.credibility_json or {})
    cred.update(recency_ok=recent, recency_actual=rec_actual, recency_window=window)
    # the client's belief is a claim to test, never evidence for itself
    belief_vals = convert.value_tokens(frame.client_belief if frame else "")
    matches_belief = e.origin_type == "client_file" and any(
        f.get("value") is not None and any(abs(float(f["value"]) - b) < 1e-9 for b in belief_vals)
        and convert.conversion(f.get("unit", ""), (h.measure_unit if h else f.get("unit", ""))).ok
        for f in e.figures_json or [])
    cred["matches_belief"] = matches_belief
    fig = (e.figures_json or [])[primary.figure_index] if primary and primary.figure_index < len(e.figures_json or []) else None
    if not fig or not h:
        convertible, conv_actual = False, "no linked figure"
    elif fig.get("kind") == "calculated" and not (fig.get("derivation") or {}).get("formula_confirmed"):
        convertible, conv_actual = False, "derived figure needs your formula confirmation"
    else:
        c = convert.conversion(fig.get("unit", ""), h.measure_unit)
        convertible = c.ok
        conv_actual = (c.formula if c.ok else f"'{fig.get('unit')}' cannot be put on '{h.measure_unit}'")
    verified = bool(fig and fig.get("verified"))
    corroborated = False
    if cred.get("tier") == 3 and fig and h:
        L = C.pass_line(h) or 0
        tol = abs(L) * h.tolerance_pct / 100.0
        mine = fig.get("value") if fig.get("value") is not None else fig.get("low")
        for ln in links:
            if ln.hypothesis_code != h.code or ln.evidence_id == e.id:
                continue
            other = _get(s, case.id, ln.evidence_id)
            if other.duplicate_of or other.original_group_id == e.original_group_id or other.bucket == "pending":
                continue
            of = (other.figures_json or [])[ln.figure_index] if ln.figure_index < len(other.figures_json or []) else None
            if of and of.get("verified"):
                ov = of.get("value") if of.get("value") is not None else of.get("low")
                if mine is not None and ov is not None and abs(float(ov) - float(mine)) <= tol:
                    corroborated = True
    privacy_flag = e.origin_type not in ("client_file",) and bool(
        [t for t in privacy.check(e.text, dl) if t in dl.terms])
    tests = CL.run_checklist(CL.ChecklistInput(
        origin_type=e.origin_type, is_belief=matches_belief, tier=cred.get("tier"), traced=bool(cred.get("traced")),
        corroborated=corroborated, recent=recent, recency_actual=rec_actual, recency_window=window,
        convertible=convertible, convertible_actual=conv_actual,
        has_derivation=any(f.get("kind") == "calculated" for f in e.figures_json or []), verified=verified,
        verified_actual=(fig or {}).get("verify_note", "no figure"), duplicate_of=e.duplicate_of,
        privacy_flag=privacy_flag,
        supports_must_have=any(ln.role == "supports_test" and hs.get(ln.hypothesis_code) and
                               hs[ln.hypothesis_code].must_have for ln in my_links),
        sets_pass_line=any(ln.role == "sets_pass_line" for ln in my_links),
        never_auto_origins=rules()["checklist"]["never_auto_approve_origins"]))
    e.credibility_json = cred
    e.checklist_json = tests
    if e.status in ("pending_clean", "auto_approved", "needs_decision"):
        if CL.all_pass(tests):
            e.status, e.bucket = "auto_approved", "auto"
        else:
            e.status, e.bucket = "needs_decision", "decision"
    s.add(e)


# ------------------------------------------------------------------ step 7

DECISIONS = {
    "approve": "approved", "keep_client_reported": "client_reported", "keep_belief": "belief_under_test",
    "keep_cross_check": "cross_check", "reject": "rejected",
}


def _can_touch(s, case: Case, e: EvidenceItem, action: str) -> None:
    if e.trip_id:
        hcodes = {ln.hypothesis_code for ln in C.links_for(s, case.id) if ln.evidence_id == e.id}
        reopened = {h.code for h in C.hypotheses(s, case.id) if h.links_reopened_for_trip}
        if not hcodes & reopened and not (hcodes == set() and reopened):
            raise GateError("This trip's idea has been tested again, so its evidence is locked.", [])
        return
    require(s, case, action)


def decide(case_id: int, eid: str, action: str, reason: str = "", confirm_formula: bool = False) -> None:
    if action not in DECISIONS:
        raise BadInput(f"Unknown decision {action}")
    with session() as s:
        case = C.get_case(s, case_id)
        e = _get(s, case_id, eid)
        _can_touch(s, case, e, "decide")
        if e.bucket not in ("decision", "trip") and not (e.bucket == "auto" and action == "reject"):
            raise GateError(f"{eid} is not waiting for a decision.", [])
        if action == "reject" and not reason.strip():
            raise GateError("Rejecting needs a reason.", ["reason"])
        figs = [dict(f) for f in e.figures_json or []]
        derived = [f for f in figs if f.get("kind") == "calculated"]
        if confirm_formula:
            for f in derived:
                f["derivation"] = {**f["derivation"], "formula_confirmed": True}
            e.figures_json = figs
            activity.log(case_id, "consultant", "formula_confirmed", 7 if not e.trip_id else 9,
                         f"Confirmed the formula for {eid}: " +
                         "; ".join(f["derivation"]["formula"] for f in derived))
        if action in ("approve", "keep_client_reported") and any(
                not f["derivation"].get("formula_confirmed") for f in derived
                if _figure_used(s, case_id, eid, figs.index(f))):
            raise GateError(f"Confirm the formula for {eid} before approving it.", ["Confirm the formula"])
        if action == "keep_cross_check":
            for ln in s.exec(select(EvidenceLink).where(EvidenceLink.case_id == case_id,
                                                        EvidenceLink.evidence_id == eid)).all():
                if ln.role == "supports_test":
                    ln.role, ln.proposed_by, ln.confirmed = "cross_check", "consultant", True
                    s.add(ln)
        if action in ("approve", "keep_client_reported", "keep_belief"):
            for ln in s.exec(select(EvidenceLink).where(EvidenceLink.case_id == case_id,
                                                        EvidenceLink.evidence_id == eid)).all():
                ln.confirmed = True
                s.add(ln)
        e.status = DECISIONS[action]
        e.decided_by = "consultant"
        e.decision_reason = reason.strip()
        e.seen_by_consultant = True
        s.add(e)
        s.commit()
    label = {"approve": "Accepted", "keep_client_reported": "Accepted as the client's data:",
             "keep_belief": "Kept as the client's claim:", "keep_cross_check": "Kept as a sense check only:",
             "reject": "Rejected"}[action]
    activity.log(case_id, "consultant", "decision", 9 if e.trip_id else 7,
                 f"{label} {eid}" + (f": {reason.strip()}" if reason.strip() else ""),
                 {"evidence_id": eid, "action": action})


def _figure_used(s, case_id: int, eid: str, idx: int) -> bool:
    return any(ln.evidence_id == eid and ln.figure_index == idx and ln.role == "supports_test"
               for ln in C.links_for(s, case_id))


def set_links(case_id: int, eid: str, rows: list[dict]) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        e = _get(s, case_id, eid)
        _can_touch(s, case, e, "edit_links")
        codes = {h.code for h in C.hypotheses(s, case_id)}
        for r in rows:
            if r.get("hypothesis_code") not in codes or r.get("role") not in ("supports_test", "cross_check",
                                                                              "context"):
                raise BadInput("Links need a kept idea and a role (supports the test, cross-check or context)")
        for old in s.exec(select(EvidenceLink).where(EvidenceLink.case_id == case_id,
                                                     EvidenceLink.evidence_id == eid)).all():
            if old.role != "sets_pass_line":
                s.delete(old)
        for r in rows:
            s.add(EvidenceLink(case_id=case_id, evidence_id=eid, hypothesis_code=r["hypothesis_code"], role=r["role"],
                               figure_index=int(r.get("figure_index", 0)), proposed_by="consultant", confirmed=True))
        s.commit()
    activity.log(case_id, "consultant", "links_changed", 9 if e.trip_id else 7,
                 f"Changed which idea {eid} supports: " +
                 ", ".join(f"{r['hypothesis_code']} ({r['role'].replace('_', ' ')})" for r in rows))


def mark_seen(case_id: int, eid: str, send_to_review: bool = False) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "seen")
        e = _get(s, case_id, eid)
        if e.bucket != "auto":
            raise GateError(f"{eid} is not an auto-approved item.", [])
        if send_to_review:
            e.status, e.bucket, e.spot_check_selected = "needs_decision", "decision", False
            e.decision_reason = ""
        else:
            e.seen_by_consultant = True
        s.add(e)
        s.commit()
    activity.log(case_id, "consultant", "sent_to_review" if send_to_review else "seen", 7,
                 f"Moved {eid} to Needs your call" if send_to_review else
                 f"Looked at the source of {eid}")


def spot_check(case_id: int, eid: str, matches: bool) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "spot_check")
        e = _get(s, case_id, eid)
        if not e.spot_check_selected:
            raise GateError(f"{eid} wasn't picked for the quick double-check.", [])
        e.spot_check_result = "matches" if matches else "does_not_match"
        e.seen_by_consultant = True
        if not matches:
            # a mismatch moves the item to the decision group; the checklist does not approve it again
            e.status, e.bucket = "needs_decision", "decision"
            tests = [dict(t) for t in e.checklist_json if t["test"] != "Quick double-check"]
            tests.append({"test": "Quick double-check", "pass": False, "threshold": "matches its source",
                          "actual": "spot check did not match"})
            e.checklist_json = tests
        s.add(e)
        s.commit()
    activity.log(case_id, "consultant", "spot_check", 7,
                 f"Double-checked {eid}: " + ("it matches its source" if matches else
                                             "it doesn't match, so it moved to Needs your call"))


def confirm_sources(case_id: int, ticked: bool) -> None:
    with session() as s:
        case = C.get_case(s, case_id)
        require(s, case, "confirm_sources")
        C.flag(s, case, sources_reviewed_at=now() if ticked else None)
        s.commit()
    activity.log(case_id, "consultant", "sources_reviewed", 7,
                 "Confirmed the sources have been checked" if ticked else
                 "Unticked the sources check")
