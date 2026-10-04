"""Rule engine unit tests. Pure functions, no I/O, no LLM."""
from datetime import date

import pytest

from backend.app.engine import checklist, convert, credibility, dedup, privacy, spotcheck, trips, verdict, whatif
from backend.app.engine.verdict import Fig

TODAY = date(2026, 10, 1)


# ------------------------------------------------------------ verdicts: the Sample 1 table (section 13)

def H1_figs():
    return [Fig("forecast", 13.8, 13.8, evidence_id="E1"), Fig("archive", 12, 18, evidence_id="E2")]


def test_h1_fails_high():
    assert verdict.verdict(H1_figs(), 20, ">=", 5, "market") == ("fails", "high")


def test_h1_cross_check_not_counted_and_copies_count_once():
    # five copies of the 13.8 forecast share one original group: still two independent sources
    figs = H1_figs() + [Fig("forecast", 13.8, 13.8) for _ in range(4)]
    assert verdict.verdict(figs, 20, ">=", 5, "market") == ("fails", "high")


def test_h2_not_enough_before_trip():
    assert verdict.verdict([], 24, "<=", 5, "client_operational") == ("not_enough", None)


def test_h2_holds_medium_after_trip():
    d = convert.derive("ratio", 2400, "INR", 110, "INR per month", "months")
    assert d.unit_ok and round(d.value, 1) == 21.8
    figs = [Fig("pilot", d.value, d.value, client_reported=True, calculated=True)]
    assert verdict.verdict(figs, 24, "<=", 5, "client_operational") == ("holds", "medium")


def test_h3_holds_medium():
    assert verdict.verdict([Fig("client", 34, 34, client_reported=True)], 30, ">=", 5,
                           "client_operational") == ("holds", "medium")


def test_h4_holds_low_and_fails_low_with_build_months_9():
    figs = [Fig("archive", 9, 11), Fig("expert", 10, 12)]
    line = whatif.eval_formula("18 - build_months", {"build_months": 6})
    assert line == 12
    assert verdict.verdict(figs, line, "<=", 5, "market") == ("holds", "low")
    line9 = whatif.eval_formula("18 minus build_months", {"build_months": 9})
    assert verdict.verdict(figs, line9, "<=", 5, "market") == ("fails", "low")


def test_overall_not_achievable():
    vs = [{"code": "H1", "must_have": True, "result": "fails"},
          {"code": "H2", "must_have": True, "result": "holds"},
          {"code": "H3", "must_have": False, "result": "holds"},
          {"code": "H4", "must_have": False, "result": "holds"}]
    assert verdict.adding_up(vs)[0] == "not_achievable"


# ------------------------------------------------------------ verdict edge cases

def test_single_market_source_is_not_enough():
    assert verdict.verdict([Fig("a", 30, 30)], 20, ">=", 5, "market")[0] == "not_enough"


def test_exactly_on_the_line_is_boundary():
    assert verdict.classify(20, 20, 20, ">=", 5) == ("pass", True)
    assert verdict.verdict([Fig("a", 20, 20), Fig("b", 30, 30)], 20, ">=", 5, "market") == ("holds", "low")


def test_range_straddling_line_uses_midpoint():
    assert verdict.classify(15, 23, 20, ">=", 5) == ("fail", True)
    assert verdict.classify(18, 26, 20, ">=", 5) == ("pass", True)


def test_conflicting_sides():
    assert verdict.verdict([Fig("a", 10, 10), Fig("b", 30, 30)], 20, ">=", 5, "market") == ("conflicting", "low")


def test_client_reported_cap_even_with_two_sources():
    figs = [Fig("a", 40, 40, client_reported=True), Fig("b", 45, 45, client_reported=True)]
    assert verdict.verdict(figs, 30, ">=", 5, "client_operational") == ("holds", "medium")


def test_single_calculated_market_figure_is_low():
    figs = [Fig("a", 30, 30, calculated=True)]
    assert verdict.verdict(figs, 20, ">=", 5, "market")[0] == "not_enough"
    # two figures from one calculated origin still count as one source
    assert verdict.verdict([Fig("a", 30, 30, calculated=True), Fig("a", 31, 31, calculated=True)],
                           20, ">=", 5, "market")[0] == "not_enough"


def test_why_text_is_template_and_names_figures():
    r = verdict.evaluate(H1_figs(), 20, ">=", 5, "market", "% a year")
    assert r.result == "fails" and r.confidence == "high"
    assert "13.8" in r.why and "12 to 18" in r.why and "20% a year" in r.why
    assert "INDEPENDENT_AGREE" in r.reason_codes


def test_adding_up_consultant_decides_and_achievable():
    vs = [{"code": "H1", "must_have": True, "result": "not_enough"},
          {"code": "H2", "must_have": False, "result": "fails"}]
    assert verdict.adding_up(vs)[0] == "consultant_decides"
    assert verdict.adding_up([{"code": "H1", "must_have": True, "result": "holds"},
                              {"code": "H2", "must_have": False, "result": "fails"}])[0] == "achievable"


# ------------------------------------------------------------ numbers, units and derivations

@pytest.mark.parametrize("text,expected", [
    ("13.8%", (13.8, 13.8)), ("12 to 18", (12, 18)), ("12-18%", (12, 18)), ("about 30%", (30, 30)),
    ("5.53 crore", (5.53e7, 5.53e7)), ("10.80 crore", (1.08e8, 1.08e8)), ("Rs 2,400", (2400, 2400)),
    ("1,20,000", (120000, 120000)), ("12,5 %", (12.5, 12.5)), ("2.5 million", (2.5e6, 2.5e6)),
    ("approximately 9 to 11 months", (9, 11)), ("3 lakh", (3e5, 3e5)),
])
def test_parse_number(text, expected):
    lo, hi = convert.parse_number(text)
    assert lo == pytest.approx(expected[0]) and hi == pytest.approx(expected[1])


def test_safe_conversions_only():
    assert convert.conversion("%", "percent").ok
    assert convert.conversion("% a year", "percent per year").ok
    assert convert.conversion("ratio", "%").factor == 100
    assert convert.conversion("years", "months").factor == 12
    assert convert.conversion("INR per year", "INR per month").factor == pytest.approx(1 / 12)
    assert not convert.conversion("USD", "INR").ok          # no currency conversion
    assert not convert.conversion("cards", "percent").ok    # unconvertible goes to a person


def test_derivations_and_unit_check():
    r = convert.derive("ratio", 2400, "INR", 110, "INR per month", "months")
    assert r.unit_ok and r.value == pytest.approx(21.818, abs=1e-3)
    d = convert.derive("difference", 36, "months", 12, "months", "months")
    assert d.unit_ok and d.value == 24
    c = convert.derive("cagr", 5.53, "crore cards", 10.80, "crore cards", "% a year", years=5,
                       a_period="Dec 2019", b_period="Dec 2024")
    assert c.unit_ok and c.years_ok and round(c.value, 1) == 14.3
    bad_years = convert.derive("cagr", 5.53, "cards", 10.80, "cards", "% a year", years=4,
                               a_period="Dec 2019", b_period="Dec 2024")
    assert not bad_years.years_ok
    mismatch = convert.derive("ratio", 2400, "INR", 110, "cards", "months")
    assert not mismatch.unit_ok and "confirmation" in mismatch.note


# ------------------------------------------------------------ credibility

REG = {
    "global": {"tier1": ["*.gov", "*.gov.*"], "tier3": ["reuters.com"], "tier4": ["medium.com"]},
    "countries": {"IN": {"tier1": ["rbi.org.in", "*.gov.in"], "tier3": ["livemint.com"]}},
}


def test_tiers():
    assert credibility.grade_tier("https://www.rbi.org.in/Scripts/x.aspx", "open_web", REG, "IN")[0] == 1
    assert credibility.grade_tier("data.gov.uk", "open_web", REG)[0] == 1
    assert credibility.grade_tier("reuters.com", "open_web", REG)[0] == 3
    assert credibility.grade_tier("medium.com", "open_web", REG)[0] == 4
    assert credibility.grade_tier("unknown-blog.example", "open_web", REG)[0] == 4
    assert credibility.grade_tier("x", "firm_archive", REG)[0] == 2
    assert credibility.grade_tier("x", "paid_db", REG)[0] == 2
    assert credibility.grade_tier("x", "client_file", REG)[0] is None
    assert credibility.grade_tier("x", "expert_note", REG)[0] is None
    # country pack only applies to its country
    assert credibility.grade_tier("livemint.com", "open_web", REG, "US")[0] == 4
    # consultant-added source with a stated tier
    assert credibility.grade_tier("press.sample", "open_web", REG, plan_overrides={"press.sample": (3, "r")})[0] == 3


def test_recency():
    assert credibility.recency("Dec 2024", None, 36, TODAY)[0]
    assert not credibility.recency(None, "2019-01", 36, TODAY)[0]
    assert credibility.recency(None, "2019-01", 120, TODAY)[0]
    assert credibility.recency(None, None, 36, TODAY) == (False, "no usable date")   # missing date fails
    assert not credibility.recency("2030-01", None, 36, TODAY)[0]                     # future counts as missing
    assert not credibility.recency("sometime", None, 36, TODAY)[0]


def test_traced():
    assert credibility.traced(1, False, False)
    assert credibility.traced(3, True, False)
    assert not credibility.traced(3, False, False)


# ------------------------------------------------------------ checklist

def base(**kw):
    d = dict(origin_type="paid_db", is_belief=False, tier=2, traced=True, corroborated=False, recent=True,
             recency_actual="2025-06", recency_window=36, convertible=True, convertible_actual="same unit", has_derivation=False,
             verified=True, verified_actual="found", duplicate_of=None, privacy_flag=False,
             supports_must_have=False, sets_pass_line=False)
    d.update(kw)
    return checklist.ChecklistInput(**d)


def test_checklist_all_pass():
    tests = checklist.run_checklist(base())
    assert len(tests) == 9 and checklist.all_pass(tests)
    assert all({"test", "pass", "threshold", "actual"} <= set(t) for t in tests)


@pytest.mark.parametrize("kw,failing", [
    ({"origin_type": "client_file", "tier": None}, "Not from the client or an expert"),
    ({"origin_type": "expert_note", "tier": None}, "Not from the client or an expert"),
    ({"is_belief": True}, "Not from the client or an expert"),
    ({"origin_type": "open_web", "tier": 3, "traced": True}, "Source quality is Official or Trusted"),
    ({"origin_type": "open_web", "tier": None}, "Source quality is Official or Trusted"),
    ({"tier": 4}, "Source quality is Official or Trusted"),
    ({"tier": 3, "traced": True, "corroborated": False}, "Source quality is Official or Trusted"),
    ({"recent": False}, "Source is recent enough"),
    ({"traced": False}, "Names its original source or method"),
    ({"convertible": False}, "Uses the idea's measure"),
    ({"has_derivation": True}, "Uses the idea's measure"),
    ({"verified": False}, "Quote found in the source"),
    ({"duplicate_of": "E1"}, "Not a duplicate"),
    ({"privacy_flag": True}, "No private terms"),
    ({"supports_must_have": True}, "Not needed for a critical idea"),
    ({"sets_pass_line": True}, "Not needed for a critical idea"),
])
def test_checklist_failures(kw, failing):
    tests = checklist.run_checklist(base(**kw))
    assert failing in checklist.failing(tests)
    assert not checklist.all_pass(tests)


def test_tier3_traced_and_corroborated_passes_tier_test():
    tests = checklist.run_checklist(base(tier=3, traced=True, corroborated=True))
    assert "Source quality is Official or Trusted" not in checklist.failing(tests)


def test_open_web_official_page_can_pass():
    assert checklist.all_pass(checklist.run_checklist(base(origin_type="open_web", tier=1)))


# ------------------------------------------------------------ de-duplication

def test_dedup_rules():
    items = [
        dedup.DedupItem("E1", "paid_db", "https://db.sample/forecast", "2025-03", 2, "", "forecast text",
                        [(13.8, 13.8)]),
        dedup.DedupItem("E2", "open_web", "https://news.sample/a?utm_source=x", "2025-04", 3, "db forecast",
                        "news a", [(13.8, 13.8)]),
        dedup.DedupItem("E3", "open_web", "https://www.news.sample/a/", "2025-04", 3, "", "news a again"),
        dedup.DedupItem("E4", "open_web", "https://other.sample/b", "2025-05", 3, "DB Forecast",
                        "something else", [(13.8, 13.8)]),
        dedup.DedupItem("E5", "firm_archive", "", "2024-01", 2, "", "independent study 12 to 18",
                        [(12, 18)]),
    ]
    # E1 does not name an original; E2 and E4 name the same one -> grouped with each other
    r = dedup.group_items(items)
    assert r.duplicate_of["E3"] == "E2" or r.group_of["E3"] == r.group_of["E2"]
    assert r.group_of["E4"] == r.group_of["E2"]
    assert r.duplicate_of["E5"] is None and r.duplicate_of["E1"] is None


def test_dedup_similarity_and_client_material_never_merged():
    t = "Banks report a 28 to 36 percent lower acquisition cost for existing customers across retail products"
    items = [dedup.DedupItem("E1", "paid_db", "", "2025-01", 2, "", t),
             dedup.DedupItem("E2", "paid_db", "", "2025-02", 2, "", t + " in 2025"),
             dedup.DedupItem("E3", "client_file", "", "", None, "", t)]
    r = dedup.group_items(items)
    assert r.duplicate_of["E2"] == "E1" and r.duplicate_of["E3"] is None


def test_pre_read_duplicates():
    out = dedup.pre_read_duplicates([("a", "https://x.sample/p?utm_campaign=1", "t1"),
                                     ("b", "https://www.x.sample/p", "t2"), ("c", "", "T1 ")])
    assert out == {"b": "a", "c": "a"}


# ------------------------------------------------------------ privacy

def test_privacy_filter():
    dl = privacy.build_deny_list("Example Client Ltd", ["ECL"], ["Rs 1,500 crore budget"],
                                 ["Rs 3,100 per card", "42%", "2025", "17"])
    assert privacy.check("India credit cards in use, annual growth forecast 2025 to 2030", dl) == []
    assert privacy.check("How fast is Example Client Ltd growing?", dl) == ["Example Client Ltd"]
    assert privacy.check("cost of 3,100 per card", dl)            # unit-bearing client figure blocks
    assert privacy.check("budget of 1,500 crore", dl)            # private number blocks
    assert privacy.check("about 42 percent", dl)                 # client figure with a unit blocks
    assert privacy.check("there are 17 items", dl) == []         # small plain integers pass
    clean, removed = privacy.sanitise("Can Example Client Ltd reach the growth its card launch needs?", dl)
    assert "Example Client" not in clean and removed == ["Example Client Ltd"]
    assert privacy.for_llm("ECL wants growth", dl) == "the client wants growth"


# ------------------------------------------------------------ spot check, trips, sliders

def test_spot_check_size_and_determinism():
    assert spotcheck.size(0) == 0 and spotcheck.size(1) == 1 and spotcheck.size(6) == 2
    assert spotcheck.size(10) == 2 and spotcheck.size(11) == 3 and spotcheck.size(30) == 6
    ids = [f"E{i}" for i in range(1, 8)]
    assert spotcheck.pick(ids, 7) == spotcheck.pick(list(reversed(ids)), 7)


def test_trip_limits():
    assert trips.check_trip(0, False, None)[0]
    assert trips.check_trip(1, False, None)[0]
    assert not trips.check_trip(2, False, None)[0]
    assert not trips.check_trip(2, True, "  ")[0]
    assert trips.check_trip(2, True, "Client asked for a second pilot")[0]
    assert not trips.check_trip(3, True, "reason")[0]


def test_sample_mix():
    ok = trips.sample_mix({"existing": 42, "new": 58}, {"existing": 40, "new": 60}, 10)
    assert ok["passes"]
    bad = trips.sample_mix({"existing": 80, "new": 20}, {"existing": 40, "new": 60}, 10)
    assert not bad["passes"]


def test_slider_ranges():
    nn = ["percent", "months"]
    assert whatif.slider_range(20, "% a year", None, None, non_negative_units=nn) == (10, 30)
    assert whatif.slider_range(0, "percent", None, None, non_negative_units=nn) == (0, 10)
    assert whatif.slider_range(0, "index", None, None, non_negative_units=nn) == (-10, 10)
    assert whatif.slider_range(-4, "index", None, None, non_negative_units=nn) == (-6, -2)
    assert whatif.slider_range(6, "months", 3, 12, non_negative_units=nn) == (3, 12)


def test_formula_safety():
    assert whatif.eval_formula("36 - 12", {}) == 24
    with pytest.raises(ValueError):
        whatif.eval_formula("__import__('os')", {})
    with pytest.raises(ValueError):
        whatif.eval_formula("x + 1", {})
