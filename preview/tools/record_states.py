"""Record real app states for the offline preview.

Runs Sample 1 through the real backend (demo data mode, no keys, no network) and saves the exact JSON the
frontend receives at each point of the journey. The preview replays these states, so its screens show the
app's real data. Run from the repository root:  .venv/bin/python preview/tools/record_states.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.update(MODE="fixtures", FIXTURE_DELAY="0.08", DATA_DIR=tempfile.mkdtemp(prefix="rw-preview-"))
for k in ("ANTHROPIC_API_KEY", "TAVILY_API_KEY", "ADMIN_PASSCODE"):
    os.environ.pop(k, None)

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import samples  # noqa: E402
from backend.app.main import app  # noqa: E402

NAME = "sample_01_card_launch"
OUT = ROOT / "preview" / "tools" / "states.json"


def _plain_paths(res: dict) -> dict:
    """The recording runs in a temporary folder; show the app's default folder instead."""
    for i in res["items"]:
        if i["key"] == "database":
            i["detail"] = "Saving cases in ./data"
    return res


def main() -> None:
    script = samples.load(NAME)["script"]
    states: dict[str, dict] = {}
    with TestClient(app) as c:
        def call(method, path, **kw):
            r = c.request(method, f"/api{path}", **kw)
            assert r.status_code < 300, (path, r.status_code, r.text)
            return r.json() if "json" in r.headers.get("content-type", "") else r.text

        cid = call("POST", f"/samples/{NAME}/load")["id"]

        def snap(name: str) -> dict:
            b = call("GET", f"/cases/{cid}")
            states[name] = {"bundle": b, "activity": call("GET", f"/cases/{cid}/activity")}
            return b

        def wait(kind: str) -> None:
            for _ in range(600):
                j = call("GET", f"/cases/{cid}")["jobs"].get(kind)
                if j and j["status"] in ("done", "failed"):
                    assert j["status"] == "done", j
                    return
                time.sleep(0.03)
            raise SystemExit(f"{kind} timed out")

        snap("s1_loaded")
        call("POST", f"/cases/{cid}/read-ask"); wait("frame"); snap("s1_framed")
        call("POST", f"/cases/{cid}/frame/confirm"); wait("plan"); snap("s2_planned")
        call("PUT", f"/cases/{cid}/hypotheses",
             json=[{"code": x["code"], "removed_reason": x["reason"]} for x in script["remove_ideas"]])
        call("POST", f"/cases/{cid}/plan/lock", json={"ticked": True}); wait("route"); snap("s3_locked")
        # gathering and checking run as background jobs: keep a few frames of each so the preview can animate them
        call("POST", f"/cases/{cid}/requests/mark-sent", json={"reviewed": True})
        frames: list[tuple[str, dict]] = []
        for _ in range(2000):
            b = call("GET", f"/cases/{cid}")
            running = b["running_jobs"]
            if running:
                frames.append((running[0], b))
            if b["progress"]["done"].get("6"):
                break
            time.sleep(0.05)
        for kind, prefix in (("collect", "s5_collect"), ("clean", "s6_clean")):
            fs = [b for k, b in frames if k == kind]
            pick = [fs[int(i * (len(fs) - 1) / 3)] for i in range(4)] if len(fs) >= 4 else fs
            for i, b in enumerate(pick):
                states[f"{prefix}_{i}"] = {"bundle": b, "activity": []}
        snap("s7_review")
        # the consultant's review, made by the pack's recorded rules (the same rules the automated tests use)
        rv = script["review"]
        b = call("GET", f"/cases/{cid}")
        for e in b["evidence"]:
            if e["bucket"] == "auto":
                if e["spot_check_selected"]:
                    call("POST", f"/cases/{cid}/review/spot-check/{e['id']}", json={"matches": True})
                call("POST", f"/cases/{cid}/review/seen/{e['id']}")
        for e in call("GET", f"/cases/{cid}")["evidence"]:
            if e["bucket"] == "decision" and e["status"] == "needs_decision":
                for rule in rv["rules"]:
                    m = rule["match"]
                    ok = all(((e.get("credibility_json") or {}).get(k) if k == "matches_belief" else e.get(k)) == v
                             for k, v in m.items())
                    if ok:
                        calc = any(f.get("kind") == "calculated" for f in e["figures_json"])
                        call("POST", f"/cases/{cid}/evidence/{e['id']}/decision",
                             json={"action": rule["action"], "reason": rule.get("reason", ""), "confirm_formula": calc})
                        break
        call("POST", f"/cases/{cid}/review/confirm-sources", json={"ticked": True})
        call("POST", f"/cases/{cid}/test/run"); snap("s8_tested")
        t = script["trips"][0]
        tid = call("POST", f"/cases/{cid}/trips", json={"hypothesis": t["idea"]})["trip_id"]
        wait(f"trip_{tid}"); snap("s9_drafted")
        call("POST", f"/cases/{cid}/trips/{tid}/mark-sent"); snap("s9_sent")
        data = samples.file_bytes(NAME, t["reply_file"], "replies")
        call("POST", f"/cases/{cid}/trips/{tid}/reply", files={"file": (t["reply_file"], data)})
        wait(f"trip_reply_{tid}"); snap("s9_replied")
        for e in call("GET", f"/cases/{cid}")["evidence"]:
            if e["bucket"] == "trip" and e["status"] == "needs_decision":
                call("POST", f"/cases/{cid}/evidence/{e['id']}/decision",
                     json={"action": t["decide"], "confirm_formula": True})
        call("POST", f"/cases/{cid}/retest", json={"hypothesis": t["idea"]}); snap("s9_retested")
        call("POST", f"/cases/{cid}/addup/run"); wait("addup"); snap("s10_added")
        exports = {"md": call("GET", f"/cases/{cid}/export?format=md"),
                   "json": json.dumps(call("GET", f"/cases/{cid}/export?format=json"), indent=2)}
        # a blank case in demo data mode: what really happens when you start your own case without keys
        bid = call("POST", "/cases", json={"title": "New case"})["id"]
        blank_new = call("GET", f"/cases/{bid}")
        call("PUT", f"/cases/{bid}", json={"client_name": "Your client", "country": "India", "industry": "Retail",
                                           "function": "Strategy", "raw_ask": "Your client's question"})
        call("POST", f"/cases/{bid}/read-ask")
        for _ in range(200):
            j = call("GET", f"/cases/{bid}")["jobs"].get("frame")
            if j and j["status"] == "failed":
                break
            time.sleep(0.03)
        blank_failed_job = call("GET", f"/cases/{bid}")["jobs"]["frame"]
        # what if: the real engine's answers for a few slider positions, used to check the preview's own maths
        whatif_checks = []
        for body in ({"assumptions": {"build_months": 9}}, {"assumptions": {"required_growth": 12}},
                     {"pass_lines": {"H2": 20}}, {"pass_lines": {"H3": 36}}):
            whatif_checks.append({"body": body, "result": call("POST", f"/cases/{cid}/whatif", json=body)})
        meta = {"samples": call("GET", "/samples"), "settings": call("GET", "/settings"),
                "selfcheck": _plain_paths(call("GET", "/selfcheck")), "blank_new": blank_new,
                "blank_failed_job": blank_failed_job, "exports": exports, "whatif_checks": whatif_checks,
                "sample_reply": {"name": t["reply_file"], "b64": __import__("base64").b64encode(data).decode()}}
    OUT.write_text(json.dumps({"states": states, "meta": meta}), encoding="utf-8")
    print(f"recorded {len(states)} states -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
