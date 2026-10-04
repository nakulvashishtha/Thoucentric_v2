"""Passcode on every /api route, and the self-check with no keys (no network calls)."""
import asyncio

from backend.app import selfcheck


def test_passcode_protects_the_api(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSCODE", "open sesame")
    client.cookies.clear()
    assert client.get("/healthz").status_code == 200
    assert client.get("/api/session").json() == {"required": True, "signed_in": False}
    r = client.get("/api/cases")
    assert r.status_code == 401 and "passcode" in r.json()["reason"]
    assert client.post("/api/login", json={"passcode": "wrong"}).status_code == 401
    r = client.post("/api/login", json={"passcode": "open sesame"})
    assert r.status_code == 200 and "rw_session" in r.cookies
    assert "httponly" in r.headers["set-cookie"].lower() and "samesite=lax" in r.headers["set-cookie"].lower()
    assert client.get("/api/cases").status_code == 200
    monkeypatch.delenv("ADMIN_PASSCODE")
    client.cookies.clear()


def test_selfcheck_without_keys_shows_red_items_with_fixes(client, monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "TAVILY_API_KEY", "ADMIN_PASSCODE"):
        monkeypatch.delenv(k, raising=False)
    res = asyncio.run(selfcheck.run(live_calls=True))
    items = {i["key"]: i for i in res["items"]}
    assert items["database"]["ok"] is True
    for key in ("passcode", "MODEL_FAST", "MODEL_SMART", "search"):
        assert items[key]["ok"] is False and items[key]["fix"]
    assert not res["all_green"]
    assert client.get("/api/selfcheck").status_code == 200
