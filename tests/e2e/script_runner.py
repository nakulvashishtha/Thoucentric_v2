"""Drives a sample pack through all 12 steps via the API, using the pack's consultant_script.json.

The script uses generic rules (status, origin type, script tags), never fixed evidence ids.
"""
from __future__ import annotations

import time

from backend.app import samples


class Runner:
    def __init__(self, client, name: str, log=print):
        self.c = client
        self.name = name
        self.pack = samples.load(name)
        self.script = self.pack["script"]
        self.log = log
        self.cid = None

    # ---- helpers
    def call(self, method: str, path: str, expect: int = 200, **kw):
        r = self.c.request(method, f"/api/cases/{self.cid}{path}", **kw)
        assert r.status_code == expect, f"{method} {path} -> {r.status_code} {r.text}"
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text

    def case(self) -> dict:
        return self.call("GET", "")

    def wait(self, kind: str, timeout: float = 30) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            j = self.case()["jobs"].get(kind)
            if j and j["status"] in ("done", "failed"):
                assert j["status"] == "done", f"job {kind} failed: {j['error']}"
                return j
            time.sleep(0.05)
        raise AssertionError(f"job {kind} timed out")

    def verdicts(self) -> dict:
        return {h["code"]: (h["verdict"]["result"], h["verdict"]["confidence"])
                for h in self.case()["hypotheses"] if h["verdict"] and not h["removed_reason"]}

    # ---- the 12 steps
    def run_to_tests(self) -> None:
        r = self.c.post(f"/api/samples/{self.name}/load")
        assert r.status_code == 200, r.text
        self.cid = r.json()["id"]
        self.call("POST", "/read-ask"); self.wait("frame")                     # step 1
        self.call("POST", "/frame/confirm"); self.wait("plan")                 # step 2
        removals = [{"code": x["code"], "removed_reason": x["reason"]} for x in self.script.get("remove_ideas", [])]
        if removals:
            self.call("PUT", "/hypotheses", json=removals)
        self.call("POST", "/plan/lock", json={"ticked": True}); self.wait("route")   # step 3
        self.call("POST", "/requests/mark-sent", json={"reviewed": True})       # step 4
        self.wait("collect"); self.wait("clean")                                # steps 5 and 6
        self.review()                                                           # step 7
        self.call("POST", "/test/run")                                          # step 8

    def _matches(self, e: dict, match: dict) -> bool:
        for k, v in match.items():
            actual = (e.get("credibility_json") or {}).get(k) if k == "matches_belief" else e.get(k)
            if actual != v:
                return False
        return True

    def decide_by_rules(self, e: dict, rules: list[dict], confirm: bool) -> None:
        has_calc = any(f.get("kind") == "calculated" for f in e["figures_json"])
        for rule in rules:
            if self._matches(e, rule["match"]):
                self.call("POST", f"/evidence/{e['id']}/decision",
                          json={"action": rule["action"], "reason": rule.get("reason", ""),
                                "confirm_formula": bool(confirm and has_calc and e["formula_needs_you"])})
                return
        raise AssertionError(f"no script rule for {e['id']}")

    def review(self, spot_check: bool = True) -> None:
        rv = self.script["review"]
        for e in self.case()["evidence"]:
            if e["bucket"] == "auto":
                if spot_check and e["spot_check_selected"]:
                    self.call("POST", f"/review/spot-check/{e['id']}", json={"matches": rv["spot_check"] == "matches"})
                if rv.get("mark_all_auto_approved_seen"):
                    self.call("POST", f"/review/seen/{e['id']}")
        for e in self.case()["evidence"]:
            if e["bucket"] == "decision" and e["status"] == "needs_decision":
                self.decide_by_rules(e, rv["rules"], rv.get("confirm_all_derivations", False))
        if rv.get("tick_sources_box"):
            self.call("POST", "/review/confirm-sources", json={"ticked": True})

    def run_trips(self) -> None:
        for t in self.script.get("trips", []):
            tid = self.call("POST", "/trips", json={"hypothesis": t["idea"]})["trip_id"]
            self.wait(f"trip_{tid}")
            self.call("POST", f"/trips/{tid}/sent")
            data = samples.file_bytes(self.name, t["reply_file"], "replies")
            self.call("POST", f"/trips/{tid}/reply", files={"file": (t["reply_file"], data)})
            self.wait(f"trip_reply_{tid}")
            for e in self.case()["evidence"]:
                if e["bucket"] == "trip" and e["status"] == "needs_decision":
                    self.call("POST", f"/evidence/{e['id']}/decision",
                              json={"action": t["decide"],
                                    "confirm_formula": t.get("confirm_formula", False) and e["formula_needs_you"]})
            self.call("POST", "/test/run", json={"hypothesis": t["idea"]})

    def finish(self) -> None:
        self.call("POST", "/addup/run"); self.wait("addup")                     # step 10
        self.call("PUT", "/conclusion", json={"text": self.script["conclusion"]})   # step 12
