"""Every gate refuses early calls with 409; the locked plan cannot change."""
from tests.e2e.script_runner import Runner

S1 = "sample_01_card_launch"


def _new(client):
    r = Runner(client, S1)
    r.cid = client.post(f"/api/samples/{S1}/load").json()["id"]
    return r


def test_early_calls_are_refused(client):
    r = _new(client)
    for method, path, body in [("POST", "/frame/confirm", None), ("POST", "/plan/lock", {"ticked": True}),
                               ("POST", "/requests/mark-sent", {"reviewed": True}), ("POST", "/collect/start", None),
                               ("POST", "/clean/run", None), ("POST", "/test/run", None),
                               ("POST", "/addup/run", None), ("POST", "/whatif", {}),
                               ("PUT", "/conclusion", {"text": "x"}), ("POST", "/trips", {"hypothesis": "H1"})]:
        res = client.request(method, f"/api/cases/{r.cid}{path}", json=body)
        assert res.status_code == 409, (path, res.status_code, res.text)
        assert set(res.json()) == {"reason", "required"}


def test_plan_lock_needs_tick_and_plan_is_immutable_after_lock(client):
    r = _new(client)
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/frame/confirm"); r.wait("plan")
    r.call("PUT", "/frame", expect=409, json={"decision": "changed"})          # frame fixed after confirm
    r.call("POST", "/plan/lock", expect=409, json={"ticked": False})
    r.call("PUT", "/hypotheses", json=[{"code": "H5", "removed_reason": "Would not change the decision"}])
    r.call("POST", "/plan/lock", json={"ticked": True}); r.wait("route")
    for row in ({"code": "H1", "pass_line_value": 10}, {"code": "H1", "tolerance_pct": 50},
                {"code": "H2", "measure_unit": "years"}, {"code": "H3", "must_have": True}):
        res = client.put(f"/api/cases/{r.cid}/hypotheses", json=[row])
        assert res.status_code == 409 and "locked" in res.json()["reason"].lower()


def test_lock_requires_a_must_have(client):
    r = _new(client)
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/frame/confirm"); r.wait("plan")
    r.call("PUT", "/hypotheses", json=[{"code": "H1", "must_have": False}, {"code": "H2", "must_have": False}])
    res = client.post(f"/api/cases/{r.cid}/plan/lock", json={"ticked": True})
    assert res.status_code == 409 and "critical" in res.json()["reason"]


def test_review_gate_and_links_lock_after_tests(client):
    r = _new(client)
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/frame/confirm"); r.wait("plan")
    r.call("POST", "/plan/lock", json={"ticked": True}); r.wait("route")
    r.call("POST", "/requests/mark-sent", expect=409, json={"reviewed": False})
    r.call("POST", "/requests/mark-sent", json={"reviewed": True})
    r.wait("collect"); r.wait("clean")
    res = client.post(f"/api/cases/{r.cid}/test/run")
    assert res.status_code == 409 and res.json()["required"]
    rbi = next(e for e in r.case()["evidence"] if e["seed_id"] == "web_rbi")
    r.call("POST", f"/evidence/{rbi['id']}/decision", expect=409, json={"action": "reject", "reason": ""})
    # the quick double-check is optional: the review is ready without it, and Skip is recorded
    pick = next(e for e in r.case()["evidence"] if e["spot_check_selected"])
    r.call("POST", f"/review/spot-check/{pick['id']}", json={"skip": True})
    r.review(spot_check=False)
    rv = r.case()["review"]
    assert rv["ready"] and rv["spot_total"] == 1 and not any("double-check" in m for m in rv["missing"])
    assert any(a["message"] == f"Quick double-check skipped by you ({pick['id']})" for a in r.call("GET", "/activity"))
    r.call("POST", "/test/run")
    e = next(e for e in r.case()["evidence"] if e["status"] == "approved")
    r.call("PUT", f"/evidence/{e['id']}/links", expect=409, json=[{"hypothesis_code": "H1", "role": "context"}])


def test_trip_evidence_reopens_only_that_idea_and_trip_limits(client):
    r = Runner(client, S1)
    r.run_to_tests()
    tid = r.call("POST", "/trips", json={"hypothesis": "H2"})["trip_id"]
    r.wait(f"trip_{tid}")
    r.call("POST", "/trips", expect=409, json={"hypothesis": "H2"})            # trip 1 not yet marked sent
    r.call("POST", "/trips", expect=409, json={"hypothesis": "H1"})            # H1 is settled (Fails, High)
    r.call("POST", f"/trips/{tid}/sent")
    from backend.app import samples
    r.call("POST", f"/trips/{tid}/reply", files={"file": ("pilot_costs.xlsx",
                                                         samples.file_bytes(S1, "pilot_costs.xlsx", "replies"))})
    r.wait(f"trip_reply_{tid}")
    b = r.case()
    reopened = [h["code"] for h in b["hypotheses"] if h["links_reopened_for_trip"]]
    assert reopened == ["H2"]
    other = next(e for e in b["evidence"] if e["status"] == "approved" and not e["trip_id"])
    r.call("PUT", f"/evidence/{other['id']}/links", expect=409, json=[{"hypothesis_code": "H1", "role": "context"}])
    r.call("POST", "/test/run", expect=409, json={"hypothesis": "H2"})        # trip evidence undecided
    r.call("POST", "/addup/run", expect=409)                                  # reopened links block add-up
    trip_item = next(e for e in b["evidence"] if e["bucket"] == "trip")
    # its calculation uses two verified quotes from the same file, so accepting it also checks the formula
    r.call("POST", f"/evidence/{trip_item['id']}/decision", json={"action": "keep_client_reported"})
    acts = [a["message"] for a in r.call("GET", "/activity")]
    assert f"Accepted as the client's data: {trip_item['id']} (formula checked)" in acts
    r.call("POST", "/test/run", json={"hypothesis": "H2"})
    b = r.case()
    assert not any(h["links_reopened_for_trip"] for h in b["hypotheses"])
    # H4 (Low confidence) can go back: trips 1 and 2 are free, trip 3 needs the override and a reason,
    # trip 4 is refused even with an override
    for n in (1, 2, 3, 4):
        body = {"hypothesis": "H4"}
        if n >= 3:
            r.call("POST", "/trips", expect=409, json=body)
            body.update(override=True, override_reason="Client asked for one more check")
        res = client.post(f"/api/cases/{r.cid}/trips", json=body)
        if n == 4:
            assert res.status_code == 409 and "limit is 3" in res.json()["reason"]
            break
        assert res.status_code == 200, res.text
        t = res.json()["trip_id"]
        r.wait(f"trip_{t}")
        r.call("POST", f"/trips/{t}/sent")
    trips = [t for t in r.case()["trips"] if t["hypothesis_code"] == "H4"]
    assert trips[-1]["override_reason"] == "Client asked for one more check"


def test_case_reset_and_delete(client):
    r = _new(client)
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/reset")
    assert r.case()["frame"] is None and r.case()["progress"]["current"] == 1
    r.call("DELETE", "")
    assert client.get(f"/api/cases/{r.cid}").status_code == 404


def test_an_edited_search_cannot_bring_back_a_private_term(client):
    from tests.e2e.script_runner import Runner
    r = Runner(client, "sample_01_card_launch")
    res = client.post("/api/samples/sample_01_card_launch/load")
    r.cid = res.json()["id"]
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/frame/confirm"); r.wait("plan")
    r.call("PUT", "/hypotheses", json=[{"code": "H5", "removed_reason": "not needed"}])
    r.call("POST", "/plan/lock", json={"ticked": True}); r.wait("route")
    bad = client.put(f"/api/cases/{r.cid}/needs/N1/query", json={"query": "Example Client card growth"})
    assert bad.status_code == 409 and "Example Client" in bad.json()["required"]
    good = client.put(f"/api/cases/{r.cid}/needs/N1/query", json={"query": "India card growth forecast"})
    assert good.status_code == 200
    n1 = next(n for n in r.case()["needs"] if n["ref"] == "N1")
    assert n1["queries_json"][0]["query"] == "India card growth forecast"


def test_formula_from_other_sources_or_assumptions_needs_a_confirmation(client):
    from sqlmodel import select
    from backend.app.db.models import EvidenceItem
    from backend.app.db.session import session
    r = _new(client)
    r.call("POST", "/read-ask"); r.wait("frame")
    r.call("POST", "/frame/confirm"); r.wait("plan")
    r.call("POST", "/plan/lock", json={"ticked": True}); r.wait("route")
    r.call("POST", "/requests/mark-sent", json={"reviewed": True})
    r.wait("collect"); r.wait("clean")
    rbi = next(e for e in r.case()["evidence"] if e["seed_id"] == "web_rbi")
    with session() as s:   # make its calculation lean on an assumption
        e = s.exec(select(EvidenceItem).where(EvidenceItem.case_id == r.cid, EvidenceItem.id == rbi["id"])).one()
        figs = [dict(f) for f in e.figures_json]
        for f in figs:
            if f.get("kind") == "calculated":
                f["derivation"] = {**f["derivation"], "assumptions": ["years"]}
        e.figures_json = figs
        s.add(e)
        s.commit()
    res = client.post(f"/api/cases/{r.cid}/evidence/{rbi['id']}/decision", json={"action": "approve"})
    assert res.status_code == 409 and "Accept and confirm formula" in res.json()["reason"]
    r.call("POST", f"/evidence/{rbi['id']}/decision", json={"action": "approve", "confirm_formula": True})
    assert f"Accepted {rbi['id']} (formula confirmed by you)" in [a["message"] for a in r.call("GET", "/activity")]


def test_stress_test_value_can_become_the_new_target(client):
    r = Runner(client, S1)
    r.run_to_tests()
    r.run_trips()
    r.finish()
    r.call("POST", "/plan/retarget", expect=400, json={"kind": "assumption", "key": "build_months", "value": 99})
    r.call("POST", "/plan/retarget", json={"kind": "assumption", "key": "build_months", "value": 9})
    r.wait("addup")
    b = r.case()
    h4 = next(h for h in b["hypotheses"] if h["code"] == "H4")
    assert (h4["verdict"]["result"], h4["verdict"]["confidence"]) == ("fails", "low") and h4["verdict"]["version"] > 1
    assert b["overall"]["result"] == "not_achievable"
    assert not b["conclusion"]["saved_at"] and b["conclusion"]["text"]          # the conclusion is saved again
    assert b["progress"]["current"] == 12
    acts = [a["message"] for a in r.call("GET", "/activity")]
    assert any(m.startswith("Changed H4 target from 12 to 9 months after the stress test") for m in acts)
    assert "Locked the targets again. Evidence you reviewed is kept." in acts
    # decisions on evidence are untouched
    assert any(e["status"] == "rejected" for e in b["evidence"])
