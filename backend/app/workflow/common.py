"""Shared helpers for the workflow: case access, clients, deny-list, ids and verdict inputs."""
from __future__ import annotations

import asyncio
from datetime import date

from sqlmodel import Session, select

from .. import samples
from ..db.models import (Case, ClientFile, EvidenceItem, EvidenceLink, Frame, Hypothesis, RuleSet, now)
from ..engine import convert, privacy, verdict as V, whatif
from ..errors import JobFailure, NotFound
from ..llm.fixture import FixtureLLM
from ..llm.interface import LLMClient
from ..search.simulated import FixtureSearch
from ..settings import fixture_delay, rules

STEPS = [
    (1, "Type the ask", 0, True), (2, "Check the frame", 0, True), (3, "Agree the plan", 0, True),
    (4, "Plan the evidence", 1, True), (5, "Collect", 1, False), (6, "Clean", 1, False),
    (7, "Review", 1, True), (8, "Test", 2, False), (9, "Fill the gaps", 2, True),
    (10, "Add it up", 2, False), (11, "Stress-test", 2, False), (12, "Decide", 2, True),
]
PHASES = ["Frame the question", "Gather and check", "Work out what it means"]
COUNTED_STATUSES = {"approved", "auto_approved", "client_reported"}


def get_case(s: Session, case_id: int) -> Case:
    c = s.get(Case, case_id)
    if not c:
        raise NotFound(f"Case {case_id} not found")
    return c


def flag(s: Session, case: Case, **kw) -> None:
    d = dict(case.settings_json or {})
    d.update(kw)
    case.settings_json = d
    case.updated_at = now()
    s.add(case)


def today() -> date:
    return date.today()


def pack_for(case: Case) -> dict | None:
    return samples.load(case.sample) if case.sample else None


def llm_for(case: Case) -> LLMClient:
    if case.mode == "fixtures":
        pack = pack_for(case)
        if not pack:
            raise JobFailure("This blank case needs live mode: fixtures mode only has stored replies for the "
                             "sample cases. Load a sample case, or add live keys and switch to live mode.")
        return FixtureLLM(pack["fixtures"])
    from ..llm.live import LiveLLM  # built in the live layer
    return LiveLLM()


def search_for(case: Case):
    if case.mode == "fixtures":
        pack = pack_for(case)
        if not pack:
            raise JobFailure("This blank case needs live mode. Load a sample case to use fixtures mode.")
        return FixtureSearch(pack["seeds"])
    from ..search.live import live_search  # built in the live layer
    return live_search()


async def pause(case: Case) -> None:
    """Fixtures mode waits a moment per item so progress is visible; live mode waits for real work."""
    if case.mode == "fixtures":
        await asyncio.sleep(fixture_delay())


def deny_list(s: Session, case: Case) -> privacy.DenyList:
    figs: list[str] = []
    for f in s.exec(select(ClientFile).where(ClientFile.case_id == case.id)).all():
        for fig in f.figures_json or []:
            val = fig.get("value") if fig.get("value") is not None else fig.get("low")
            figs.append(f"{fig.get('quote_span', '')} {val} {fig.get('unit', '')}")
    return privacy.build_deny_list(case.client_name, list(case.client_aliases or []),
                                   list(case.private_numbers or []), figs)


def next_eid(s: Session, case_id: int) -> tuple[str, int]:
    rows = s.exec(select(EvidenceItem.seq).where(EvidenceItem.case_id == case_id)).all()
    n = (max(rows) if rows else 0) + 1
    return f"E{n}", n


def hypotheses(s: Session, case_id: int, include_removed: bool = False) -> list[Hypothesis]:
    hs = s.exec(select(Hypothesis).where(Hypothesis.case_id == case_id).order_by(Hypothesis.order)).all()
    return [h for h in hs if include_removed or not h.removed_reason]


def assumption_values(h: Hypothesis, overrides: dict | None = None) -> dict[str, float]:
    vals = {a["name"]: float(a["value"]) for a in (h.assumptions_json or [])}
    for k, v in (overrides or {}).items():
        if k in vals:
            vals[k] = float(v)
    return vals


def pass_line(h: Hypothesis, overrides: dict | None = None) -> float | None:
    if h.pass_line_formula:
        try:
            return whatif.eval_formula(h.pass_line_formula, assumption_values(h, overrides))
        except (ValueError, SyntaxError, ZeroDivisionError):
            return h.pass_line_value
    return h.pass_line_value


def items_by_id(s: Session, case_id: int) -> dict[str, EvidenceItem]:
    return {e.id: e for e in s.exec(select(EvidenceItem).where(EvidenceItem.case_id == case_id)).all()}


def links_for(s: Session, case_id: int) -> list[EvidenceLink]:
    return list(s.exec(select(EvidenceLink).where(EvidenceLink.case_id == case_id)).all())


def eligible_figs(h: Hypothesis, items: dict[str, EvidenceItem], links: list[EvidenceLink]) -> tuple[list[V.Fig], list[dict]]:
    """Eligible evidence: supports_test links whose item is approved or client-reported, not a copy, not the
    belief, with a verified figure on the idea's measure (calculated figures need a confirmed formula)."""
    figs: list[V.Fig] = []
    skipped: list[dict] = []
    for ln in links:
        if ln.hypothesis_code != h.code or ln.role != "supports_test":
            continue
        e = items.get(ln.evidence_id)
        if not e:
            continue
        why = None
        if e.duplicate_of:
            why = f"copy of {e.duplicate_of}"
        elif e.status not in COUNTED_STATUSES:
            why = f"status {e.status}"
        fig = (e.figures_json or [])[ln.figure_index] if ln.figure_index < len(e.figures_json or []) else None
        if why is None and not fig:
            why = "no figure"
        if why is None and not fig.get("verified"):
            why = "figure could not be verified"
        if why is None and fig.get("kind") == "calculated" and not (fig.get("derivation") or {}).get("formula_confirmed"):
            why = "formula not confirmed"
        conv = None
        if why is None:
            low = fig["value"] if fig.get("value") is not None else fig["low"]
            high = fig["value"] if fig.get("value") is not None else fig["high"]
            conv = convert.convert_range(float(low), float(high), fig.get("unit", ""), h.measure_unit)
            if conv is None:
                why = f"unit '{fig.get('unit')}' is not convertible to '{h.measure_unit}'"
        if why:
            skipped.append({"evidence_id": e.id, "reason": why})
            continue
        figs.append(V.Fig(origin=e.original_group_id or e.id, low=conv[0], high=conv[1],
                          client_reported=(e.status == "client_reported" or e.origin_type == "client_file"),
                          calculated=fig.get("kind") == "calculated", evidence_id=e.id))
    return figs, skipped


def evaluate(h: Hypothesis, items: dict[str, EvidenceItem], links: list[EvidenceLink],
             line: float | None = None) -> V.VerdictResult:
    L = pass_line(h) if line is None else line
    figs, _ = eligible_figs(h, items, links)
    return V.evaluate(figs, float(L), h.comparator, h.tolerance_pct, h.fact_type, h.measure_unit,
                      rules().get("minimum_sources"))


def frame_of(s: Session, case_id: int) -> Frame | None:
    return s.get(Frame, case_id)


def ruleset_of(s: Session, case_id: int) -> RuleSet | None:
    return s.get(RuleSet, case_id)
