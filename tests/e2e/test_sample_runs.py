"""Scripted end-to-end runs through all 12 steps in fixtures mode, via the API."""
from .script_runner import Runner

S1 = "sample_01_card_launch"


def test_sample_1_full_journey(client):
    r = Runner(client, S1)
    r.run_to_tests()
    b = r.case()
    k = b["counts"]
    assert (k["collected"], k["unique"]) == (25, 16)
    assert k["by_origin"] == {"open_web": 9, "firm_archive": 4, "paid_db": 7, "client_file": 3, "expert_note": 2}
    assert 5 <= k["auto_approved"] <= 7
    assert k["pending"] == 1                                   # the client's sign-up cost has not arrived
    picks = [e for e in b["evidence"] if e["spot_check_selected"]]
    assert any(e["seed_id"] == "arch_approvals_9_11" for e in picks)
    assert r.verdicts() == {"H1": ("fails", "high"), "H2": ("not_enough", "none"),
                            "H3": ("holds", "medium"), "H4": ("holds", "low")}
    r.run_trips()
    assert r.verdicts()["H2"] == ("holds", "medium")
    r.finish()
    b = r.case()
    assert b["overall"]["result"] == "not_achievable"
    assert b["summary"]["source"] == "llm"
    ids = {e["id"] for e in b["evidence"]}
    assert all(set(s["evidence_ids"]) <= ids for s in b["summary"]["sentences"])
    w = r.call("POST", "/whatif", json={"assumptions": {"build_months": 9}})
    h4 = next(x for x in w["ideas"] if x["code"] == "H4")
    assert (h4["line"], h4["result"], h4["confidence"]) == (9, "fails", "low")
    assert w["locked_plan_unchanged"] and r.verdicts()["H4"] == ("holds", "low")   # nothing written
    assert b["conclusion"]["text"]
    assert all(s["state"] == "done" for s in b["progress"]["steps"])
    # every action is in the activity record with the right actor, and exports as CSV
    acts = r.call("GET", "/activity")
    actors = {a["actor"] for a in acts}
    assert {"consultant", "llm", "rule_engine", "client", "expert"} <= actors
    assert any(a["event_type"] == "query_checked" for a in acts)
    csv_text = r.call("GET", "/export?format=activity_csv")
    assert csv_text.startswith("id,time,actor,step,event,message")
    md = r.call("GET", "/export?format=md")
    assert "Not achievable. Critical idea H1 is not supported" in md and "No method shown" in md


def test_privacy_and_coverage_in_sample_1(client):
    r = Runner(client, S1)
    r.run_to_tests()
    b = r.case()
    n1 = next(n for n in b["needs"] if n["ref"] == "N1")
    q = n1["queries_json"][0]
    assert "Example Client" in q["original"] and "Example Client" not in q["sanitised"]
    assert q["query"] == "India credit cards in use, annual growth forecast 2025 to 2030" and q["blocked"] == []
    cov = {n["ref"]: n["coverage"] for n in b["needs"]}
    assert cov["N3"] == "answered_by_client_file" and cov["N6"] == "answered_by_client_file" and cov["N4"] == "partly"
    req = b["case"]["settings_json"]["requests"]
    assert "What we already have from you" in req["client"] and "acquisition_analysis.csv" in req["client"]
    assert req["client_gaps"] == 1                     # only the gap is requested
    assert "Example Client" not in req["expert"]
    # unticked sources are never searched
    assert not any(e["seed_id"] == "web_forum" for e in b["evidence"])
    # benchmarks were fetched at step 3 with tier and date
    bench = [e for e in b["evidence"] if e["status"] == "pass_line_source"]
    assert len(bench) == 2 and all(e["tier"] in (1, 2) and e["date"] for e in bench)
    # items below Official or Trusted, client, expert and must-have-supporting items are never auto-approved
    for e in b["evidence"]:
        if e["status"] == "auto_approved":
            assert e["origin_type"] in ("open_web", "firm_archive", "paid_db") and e["tier"] in (1, 2)
            assert not any(f.get("kind") == "calculated" for f in e["figures_json"])
            assert not any(l["role"] == "supports_test" and l["hypothesis_code"] in ("H1", "H2") for l in e["links"])
    # rejected and pending items stay visible
    assert any(e["status"] == "rejected" and e["decision_reason"] == "No method shown" for e in b["evidence"])
    assert any(e["status"] == "pending" for e in b["evidence"])
