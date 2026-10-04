"""Verdict logic per idea (section 8.4), adding-up rule (8.5) and fixed 'why' templates."""
from __future__ import annotations

from dataclasses import dataclass, field

from .convert import fmt


@dataclass
class Fig:
    origin: str                 # original_group_id: one per independent source
    low: float
    high: float
    client_reported: bool = False
    calculated: bool = False
    evidence_id: str = ""


def classify(low, high, L, cmp, tol_pct):
    T = abs(L) * tol_pct / 100.0
    d = 1 if cmp == '>=' else -1
    if low != high and low <= L <= high:                 # range straddles the line
        mid = (low + high) / 2
        return ('pass' if (mid - L) * d >= 0 else 'fail'), True
    nearest = low if abs(low - L) <= abs(high - L) else high
    margin = (nearest - L) * d
    return ('pass' if margin >= 0 else 'fail'), abs(margin) <= T


def verdict(figs, L, cmp, tol_pct, fact_type):  # figs: origin, low, high, client_reported, calculated
    n = len({f.origin for f in figs})
    if n < (2 if fact_type == 'market' else 1): return ('not_enough', None)
    cls = [classify(f.low, f.high, L, cmp, tol_pct) for f in figs]
    sides = {c[0] for c in cls}; boundary = any(c[1] for c in cls)
    if len(sides) == 2: return ('conflicting', 'low')
    res = 'holds' if sides == {'pass'} else 'fails'
    single_calc = fact_type == 'market' and n == 1 and all(f.calculated for f in figs)
    if boundary or single_calc: return (res, 'low')
    if all(f.client_reported for f in figs) or n < 2: return (res, 'medium')
    return (res, 'high')


@dataclass
class VerdictResult:
    result: str
    confidence: str             # high | medium | low | none
    reason_codes: list[str] = field(default_factory=list)
    why: str = ""
    evidence_ids: list[str] = field(default_factory=list)
    figure_classes: list[dict] = field(default_factory=list)


RESULT_LABELS = {"holds": "Supported", "fails": "Not supported", "conflicting": "Sources disagree",
                 "not_enough": "Not enough evidence"}
CONFIDENCE_LABELS = {"high": "Strong", "medium": "Fair", "low": "Weak", "none": "none"}


def with_unit(v: float, unit: str) -> str:
    u = (unit or "").strip()
    return f"{fmt(v)}{'' if u.startswith('%') or not u else ' '}{u}"


def _fig_text(f: Fig, unit: str = "") -> str:
    if f.low == f.high:
        return with_unit(f.low, unit) if unit else fmt(f.low)
    return f"{fmt(f.low)} to {with_unit(f.high, unit) if unit else fmt(f.high)}"


def evaluate(figs: list[Fig], L: float, cmp: str, tol_pct: float, fact_type: str, unit: str,
             min_sources: dict | None = None) -> VerdictResult:
    """Run the reference verdict and attach reason codes and a plain 'why' built from fixed templates."""
    result, conf = verdict(figs, L, cmp, tol_pct, fact_type)
    need = (min_sources or {}).get(fact_type, 2 if fact_type == "market" else 1)
    n = len({f.origin for f in figs})
    classes = []
    for f in figs:
        side, boundary = classify(f.low, f.high, L, cmp, tol_pct)
        classes.append({"evidence_id": f.evidence_id, "figure": _fig_text(f), "side": side, "boundary": boundary,
                        "straddles": f.low != f.high and f.low <= L <= f.high, "text": _fig_text(f, unit),
                        "low": f.low, "high": f.high, "client_reported": f.client_reported,
                        "calculated": f.calculated})
    codes: list[str] = []
    line = with_unit(L, unit)
    target = f"the target of {'at least' if cmp == '>=' else 'at most'} {line}"
    figures = _join(sorted({_fig_text(f, unit) for f in figs})) if figs else ""
    if result == "not_enough":
        codes.append("NOT_ENOUGH_SOURCES")
        if n == 0:
            why = (f"No usable evidence yet. This idea needs {need} separate "
                   f"source{'s' if need > 1 else ''} to compare with {target}.")
        else:
            why = (f"Only {n} separate source so far ({figures}). This "
                   f"{'market figure' if fact_type == 'market' else 'idea'} needs {need}.")
        return VerdictResult(result, "none", codes, why, [f.evidence_id for f in figs], classes)

    straddle = [c["text"] for c in classes if c["boundary"] and c["straddles"]]
    near = [c["text"] for c in classes if c["boundary"] and not c["straddles"]]
    if result == "conflicting":
        codes.append("CONFLICTING")
        passing = [c["text"] for c in classes if c["side"] == "pass"]
        failing = [c["text"] for c in classes if c["side"] == "fail"]
        why = (f"The sources disagree. {_join(passing)} meet{'s' if len(passing) == 1 else ''} {target}, "
               f"but {_join(failing)} do{'es' if len(failing) == 1 else ''} not.")
    else:
        verb = "meet" if result == "holds" else "miss"
        if len(figs) == 1:
            verb += "es" if verb == "miss" else "s"
        why = f"{figures} {verb} {target}"
        if straddle or near:
            codes.append("BOUNDARY")
            parts = []
            if straddle:
                parts.append(f"{_join(straddle)} span{'s' if len(straddle) == 1 else ''} the target")
            if near:
                parts.append(f"{_join(near)} {'is' if len(near) == 1 else 'are'} within the {fmt(tol_pct)}% "
                             "close-call margin")
            why += ". It's a close call: " + " and ".join(parts)
        elif result == "holds":
            codes.append("ALL_PASS_CLEAR")
            why += " by more than the close-call margin"
        else:
            codes.append("ALL_FAIL_CLEAR")
            why += " by more than the close-call margin"
        single_calc = fact_type == "market" and n == 1 and all(f.calculated for f in figs)
        if single_calc:
            codes.append("SINGLE_CALCULATED")
            why += ". It rests on one calculated figure"
        if conf == "medium":
            if all(f.client_reported for f in figs):
                codes.append("CLIENT_REPORTED_CAP")
                why += ". Confidence stays at Fair because the evidence comes from the client"
            else:
                codes.append("SINGLE_SOURCE")
                why += ". There's only one separate source"
        elif conf == "high":
            codes.append("INDEPENDENT_AGREE")
            why += f", and {n} separate sources agree"
        why += "."
    return VerdictResult(result, conf, codes, why[0].upper() + why[1:], [f.evidence_id for f in figs], classes)


def _join(parts: list[str]) -> str:
    parts = list(parts)
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1] if parts else ""


OVERALL_LABELS = {
    "not_achievable": "Not achievable",
    "consultant_decides": "Needs your decision",
    "achievable": "Achievable",
}


def adding_up(verdicts: list[dict]) -> tuple[str, str]:
    """verdicts: [{code, must_have, result}] -> (overall, rule_applied text)."""
    must = [v for v in verdicts if v["must_have"]]
    failed = [v["code"] for v in must if v["result"] == "fails"]
    if failed:
        return "not_achievable", (f"Critical idea {_join(failed)} is not supported, so the plan is not achievable "
                                  "at the agreed targets.")
    unsettled = [v["code"] for v in must if v["result"] in ("conflicting", "not_enough")]
    if unsettled:
        return "consultant_decides", (f"Critical idea {_join(unsettled)} isn't settled yet, so the answer needs "
                                      "your decision.")
    return "achievable", "Every critical idea is supported, so the plan is achievable at the agreed targets."
