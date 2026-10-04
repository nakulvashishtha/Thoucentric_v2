"""With no keys the app starts in fixtures mode with its banner, and does not fail."""
import os


def test_starts_without_keys(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}
    s = client.get("/api/settings").json()
    assert s["mode"] == "fixtures"
    assert not s["keys"]["ANTHROPIC_API_KEY"]


def test_live_requested_without_keys_falls_back(monkeypatch):
    from backend.app import settings
    monkeypatch.setenv("MODE", "live")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert settings.effective_mode() == ("fixtures", "Live keys not found")


def test_blank_case_in_fixtures_mode_explains_it_needs_live(client):
    cid = client.post("/api/cases", json={"client_name": "Acme", "country": "US", "industry": "Retail",
                                          "function": "Pricing", "raw_ask": "Can we raise prices?"}).json()["id"]
    client.post(f"/api/cases/{cid}/read-ask")
    import time
    for _ in range(100):
        j = client.get(f"/api/cases/{cid}").json()["jobs"].get("frame")
        if j and j["status"] in ("done", "failed"):
            break
        time.sleep(0.05)
    assert j["status"] == "failed" and "needs live mode" in j["error"]
