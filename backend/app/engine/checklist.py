"""Auto-approval checklist (section 8.3). All nine tests must pass; every test reports threshold and actual."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChecklistInput:
    origin_type: str
    is_belief: bool
    tier: int | None
    traced: bool
    corroborated: bool            # a second independent item within tolerance (only matters for Tier 3)
    recent: bool
    recency_actual: str
    recency_window: int
    convertible: bool
    convertible_actual: str
    has_derivation: bool
    verified: bool
    verified_actual: str
    duplicate_of: str | None
    privacy_flag: bool
    supports_must_have: bool
    sets_pass_line: bool
    never_auto_origins: list[str] = field(default_factory=lambda: ["client_file", "expert_note"])


def run_checklist(c: ChecklistInput) -> list[dict]:
    tests: list[dict] = []

    def add(name: str, ok: bool, threshold: str, actual: str) -> None:
        tests.append({"test": name, "pass": bool(ok), "threshold": threshold, "actual": actual})

    origin_label = {"client_file": "client file", "expert_note": "expert note", "open_web": "web page",
                    "firm_archive": "firm archive", "paid_db": "research database", "benchmark": "benchmark"}
    src_ok = c.origin_type not in c.never_auto_origins and not c.is_belief
    actual = "the client's claim" if c.is_belief else origin_label.get(c.origin_type, c.origin_type)
    add("Not from the client or an expert", src_ok, "not a client file, an expert note or the client's claim", actual)

    names = {1: "Official", 2: "Trusted", 3: "Press", 4: "Unverified"}
    if c.tier in (1, 2):
        tier_ok, tier_actual = True, names[c.tier]
    elif c.tier == 3:
        tier_ok = c.traced and c.corroborated
        tier_actual = "Press, " + ("names its source and agrees with a separate source" if tier_ok else
                                   "does not name its source" if not c.traced else "no separate source agrees")
    elif c.tier == 4:
        tier_ok, tier_actual = False, "Unverified"
    else:
        tier_ok, tier_actual = False, "no rating (a person decides)"
    add("Source quality is Official or Trusted", tier_ok,
        "Official or Trusted (Press only if it names its source and a separate source agrees)", tier_actual)

    add("Source is recent enough", c.recent, f"dated within {c.recency_window} months", c.recency_actual)
    add("Names its original source or method", c.traced, "names where the figure comes from",
        "yes" if c.traced else "no")
    conv_ok = c.convertible and not c.has_derivation
    add("Uses the idea's measure", conv_ok, "same unit as the idea, or a safe conversion; no calculated figure",
        "a calculated figure, so you decide" if c.has_derivation else c.convertible_actual)
    add("Quote found in the source", c.verified, "the figure appears in the quoted text", c.verified_actual)
    add("Not a duplicate", c.duplicate_of is None, "not a copy of a source already counted",
        "original" if c.duplicate_of is None else f"copy of {c.duplicate_of}")
    add("No private terms", not c.privacy_flag, "no private client data", "none" if not c.privacy_flag else "found")
    load = c.supports_must_have or c.sets_pass_line
    add("Not needed for a critical idea", not load, "does not support a critical idea or set a target",
        "supports a critical idea" if c.supports_must_have else "sets a target" if c.sets_pass_line else "no")
    return tests


def all_pass(tests: list[dict]) -> bool:
    return all(t["pass"] for t in tests)


def failing(tests: list[dict]) -> list[str]:
    return [t["test"] for t in tests if not t["pass"]]
