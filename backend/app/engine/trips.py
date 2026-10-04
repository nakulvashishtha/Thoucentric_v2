"""Return-trip limits (section 8.7) and the sample-mix check for trip replies."""
from __future__ import annotations


def check_trip(previous_trips: int, override: bool, override_reason: str | None,
               free: int = 2, max_with_override: int = 3) -> tuple[bool, str]:
    n = previous_trips + 1
    if n <= free:
        return True, f"Request {n} of {free}"
    if n <= max_with_override:
        if override and (override_reason or "").strip():
            return True, f"Request {n} (reason: {override_reason.strip()})"
        return False, f"Request {n} needs the tick and a written reason"
    return False, f"You can't send request {n}: the limit is {max_with_override} per idea"


def sample_mix(sample: dict[str, float], target: dict[str, float], max_diff_points: float) -> dict:
    """Compare the makeup of a sample with the target population, in percentage points."""
    rows = []
    for k in sorted(set(sample) | set(target)):
        s, t = sample.get(k), target.get(k)
        diff = None if s is None or t is None else abs(s - t)
        rows.append({"dimension": k, "sample": s, "target": t, "difference": diff,
                     "flag": diff is None or diff > max_diff_points})
    return {"rows": rows, "passes": not any(r["flag"] for r in rows), "threshold": max_diff_points}
