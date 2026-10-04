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
    # an item with an unconfirmed derivation cannot be approved
    rbi = next(e for e in r.case()["evidence"] if e["seed_id"] == "web_rbi")
    r.call("POST", f"/evidence/{rbi['id']}/decision", expect=409, json={"action": "approve"})
    r.call("POST", f"/evidence/{rbi['id']}/decision", expect=409, json={"action": "reject", "reason": ""})
    r.review()
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
    r.call("POST", f"/evidence/{trip_item['id']}/decision", expect=409, json={"action": "keep_client_reported"})
    r.call("POST", f"/evidence/{trip_item['id']}/decision",
           json={"action": "keep_client_reported", "confirm_formula": True})
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
