"""Pass-line formulas over named assumptions, slider ranges and what-if recomputation (step 11)."""
from __future__ import annotations

import ast
import operator

from .convert import canon_unit

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def eval_formula(expr: str, names: dict[str, float]) -> float:
    """Safe arithmetic over numbers and named assumptions. Accepts 'minus', 'plus', 'times', 'divided by'."""
    e = (expr or "").strip()
    for word, sym in ((" divided by ", " / "), (" minus ", " - "), (" plus ", " + "), (" times ", " * ")):
        e = e.replace(word, sym)
    tree = ast.parse(e, mode="eval")

    def ev(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id not in names:
                raise ValueError(f"unknown assumption '{n.id}'")
            return float(names[n.id])
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub):
            return -ev(n.operand)
        raise ValueError("only numbers, assumption names and + - * / are allowed")

    return ev(tree)


def formula_names(expr: str) -> list[str]:
    e = (expr or "")
    for word, sym in ((" divided by ", " / "), (" minus ", " - "), (" plus ", " + "), (" times ", " * ")):
        e = e.replace(word, sym)
    try:
        return sorted({n.id for n in ast.walk(ast.parse(e, mode="eval")) if isinstance(n, ast.Name)})
    except SyntaxError:
        return []


def _non_negative(unit: str, non_negative_units: list[str]) -> bool:
    u = canon_unit(unit)
    canon = {canon_unit(x) for x in non_negative_units}
    return u in canon or any(u.startswith(c + " ") for c in canon)


def slider_range(value: float, unit: str, explicit_min: float | None, explicit_max: float | None,
                 pct: float = 50, zero_range: tuple[float, float] = (-10, 10),
                 non_negative_units: list[str] | None = None) -> tuple[float, float]:
    """Default ±50% of the current value (0 uses −10 to +10), clamped at 0 for units that cannot be negative."""
    if explicit_min is not None and explicit_max is not None:
        return float(explicit_min), float(explicit_max)
    if value == 0:
        lo, hi = zero_range
    else:
        lo, hi = sorted((value * (1 - pct / 100), value * (1 + pct / 100)))
    if _non_negative(unit, non_negative_units or []):
        lo = max(0.0, lo)
    if explicit_min is not None:
        lo = float(explicit_min)
    if explicit_max is not None:
        hi = float(explicit_max)
    return round(lo, 4), round(hi, 4)
