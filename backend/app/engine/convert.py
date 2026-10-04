"""Number normalisation, unit conversion and derived figures. Pure functions, no I/O."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

SCALES = {
    "thousand": 1e3, "k": 1e3,
    "lakh": 1e5, "lakhs": 1e5, "lac": 1e5,
    "crore": 1e7, "crores": 1e7, "cr": 1e7,
    "million": 1e6, "mn": 1e6, "m": 1e6,
    "billion": 1e9, "bn": 1e9, "b": 1e9,
}

_NUM = r"\d+(?:[.,]\d+)*"
_SCALE = r"(?:\s*(thousand|lakhs?|lac|crores?|cr|million|mn|billion|bn|k|m|b)\b)?"
_RANGE_SEP = r"\s*(?:-|–|—|to)\s*"


def _to_float(token: str) -> float:
    """Handle '1,234.5', Indian grouping '1,20,000', and decimal commas '12,5'."""
    t = token.strip()
    if "," in t and "." in t:
        return float(t.replace(",", ""))
    if "," in t:
        parts = t.split(",")
        if all(len(p) == 3 for p in parts[1:]) or (len(parts) > 2 and all(len(p) in (2, 3) for p in parts[1:])):
            return float(t.replace(",", ""))
        if len(parts) == 2 and len(parts[1]) in (1, 2):
            return float(parts[0] + "." + parts[1])
        return float(t.replace(",", ""))
    return float(t)


def parse_number(text: str) -> tuple[float, float] | None:
    """Return (low, high) for the first number or range in text; None if no number.

    Handles commas, lakh/crore, million/billion, %, decimal commas, ranges ('12 to 18',
    '12-18%') and 'about'/'approximately'.
    """
    if text is None:
        return None
    s = str(text).lower().replace(" ", " ")
    s = re.sub(r"\b(about|approximately|approx\.?|around|roughly|nearly|some|~)\s*", "", s)
    m = re.search(rf"({_NUM}){_SCALE}{_RANGE_SEP}({_NUM}){_SCALE}", s)
    if m:
        lo = _to_float(m.group(1))
        hi = _to_float(m.group(3))
        sc_hi = SCALES.get(m.group(4) or "", 1.0)
        sc_lo = SCALES.get(m.group(2) or "", sc_hi)
        lo, hi = lo * sc_lo, hi * sc_hi
        return (min(lo, hi), max(lo, hi))
    m = re.search(rf"({_NUM}){_SCALE}", s)
    if not m:
        return None
    v = _to_float(m.group(1)) * SCALES.get(m.group(2) or "", 1.0)
    return (v, v)


def value_tokens(text: str) -> list[float]:
    """Every number that appears in text, normalised (used for quote verification and privacy)."""
    out: list[float] = []
    s = str(text or "").lower()
    for m in re.finditer(rf"({_NUM}){_SCALE}", s):
        try:
            base = _to_float(m.group(1))
        except ValueError:
            continue
        out.append(base)
        if m.group(2):
            out.append(base * SCALES[m.group(2)])
    return out


# ---------------------------------------------------------------- units

_UNIT_SYNONYMS = {
    "%": "percent", "per cent": "percent", "pct": "percent", "percentage": "percent",
    "percentage points": "percent",
    "month": "months", "mo": "months", "mos": "months",
    "year": "years", "yr": "years", "yrs": "years",
}


def canon_unit(unit: str | None) -> str:
    u = (unit or "").strip().lower()
    u = re.sub(r"\s+", " ", u)
    u = re.sub(r"\b(a|per|each|every)\s+(year|annum)\b", "per year", u)
    u = re.sub(r"\bp\.?a\.?\b|\bannual(ly)?\b|\byoy\b|/\s*year|/\s*yr", "per year", u)
    u = re.sub(r"\b(a|per|each|every)\s+month\b|/\s*month|/\s*mo\b", "per month", u)
    u = u.replace("%", " percent ").replace("per cent", "percent")
    u = re.sub(r"\s+", " ", u).strip()
    return _UNIT_SYNONYMS.get(u, u)


@dataclass
class Conversion:
    ok: bool
    factor: float = 1.0
    formula: str = ""


def conversion(from_unit: str, to_unit: str) -> Conversion:
    """Safe conversion table only. No currency or other conversions."""
    a, b = canon_unit(from_unit), canon_unit(to_unit)
    if a == b:
        return Conversion(True, 1.0, "same unit")
    pairs = {
        ("ratio", "percent"): (100.0, "ratio × 100 = percent"),
        ("percent", "ratio"): (0.01, "percent ÷ 100 = ratio"),
        ("months", "years"): (1 / 12, "months ÷ 12 = years"),
        ("years", "months"): (12.0, "years × 12 = months"),
    }
    if (a, b) in pairs:
        f, txt = pairs[(a, b)]
        return Conversion(True, f, txt)
    if a.endswith(" per year") and b.endswith(" per month") and a[:-9] == b[:-10]:
        return Conversion(True, 1 / 12, "per-year rate ÷ 12 = per-month rate")
    if a.endswith(" per month") and b.endswith(" per year") and a[:-10] == b[:-9]:
        return Conversion(True, 12.0, "per-month rate × 12 = per-year rate")
    return Conversion(False)


def convert_range(low: float, high: float, from_unit: str, to_unit: str) -> tuple[float, float, str] | None:
    c = conversion(from_unit, to_unit)
    if not c.ok:
        return None
    lo, hi = low * c.factor, high * c.factor
    return (min(lo, hi), max(lo, hi), c.formula)


# ---------------------------------------------------------------- derived figures

def _period_year(period: str | None) -> int | None:
    m = re.search(r"(19|20)\d{2}", str(period or ""))
    return int(m.group(0)) if m else None


def _strip_scale_words(unit: str) -> str:
    u = canon_unit(unit)
    return re.sub(r"\b(thousand|lakhs?|crores?|million|billion)\b", "", u).strip()


@dataclass
class Derivation:
    value: float | None
    result_unit: str
    formula: str
    unit_ok: bool
    years_ok: bool = True
    note: str = ""


def derive(op: str, a: float, a_unit: str, b: float, b_unit: str, result_unit: str,
           years: float | None = None, a_period: str | None = None, b_period: str | None = None) -> Derivation:
    """Compute a derived figure proposed by LINK_EVIDENCE. The engine computes; the consultant confirms."""
    ua, ub, ur = _strip_scale_words(a_unit), _strip_scale_words(b_unit), canon_unit(result_unit)
    if op == "ratio":
        if b == 0:
            return Derivation(None, result_unit, "a ÷ b with b = 0", False, note="division by zero")
        val = a / b
        expected = None
        if ub == f"{ua} per month":
            expected = "months"
        elif ub == f"{ua} per year":
            expected = "years"
        elif ua == ub:
            expected = "ratio"
            if ur == "percent":
                val *= 100
                expected = "percent"
        unit_ok = expected is not None and expected == ur
        return Derivation(val, result_unit, f"{_fmt(a)} ÷ {_fmt(b)} = {_fmt(val)}", unit_ok,
                          note="" if unit_ok else "unit check needs your confirmation")
    if op == "difference":
        val = a - b
        unit_ok = ua == ub and ur == ua
        return Derivation(val, result_unit, f"{_fmt(a)} − {_fmt(b)} = {_fmt(val)}", unit_ok,
                          note="" if unit_ok else "unit check needs your confirmation")
    if op == "cagr":
        if not years or years <= 0 or a <= 0 or b <= 0:
            return Derivation(None, result_unit, "compound rate needs positive values and years", False,
                              note="cannot compute")
        val = (math.pow(b / a, 1.0 / years) - 1.0) * 100.0
        unit_ok = ua == ub and ur == "percent per year"
        ya, yb = _period_year(a_period), _period_year(b_period)
        years_ok = ya is not None and yb is not None and abs((yb - ya) - years) < 1e-9
        note = []
        if not unit_ok:
            note.append("unit check needs your confirmation")
        if not years_ok:
            note.append(f"years ({_fmt(years)}) do not match the periods ({a_period} to {b_period})")
        return Derivation(val, result_unit,
                          f"({_fmt(b)} ÷ {_fmt(a)})^(1/{_fmt(years)}) − 1 = {_fmt(val)}%", unit_ok, years_ok,
                          "; ".join(note))
    return Derivation(None, result_unit, f"unknown operation {op}", False, note="unknown operation")


def _fmt(x: float) -> str:
    if x is None:
        return "?"
    if abs(x - round(x)) < 1e-9:
        return f"{int(round(x)):,}"
    if abs(x) >= 100:
        return f"{x:,.1f}"
    return f"{x:.4g}" if abs(x) < 1 else f"{x:.3g}" if abs(x) < 10 else f"{x:.1f}"


fmt = _fmt
