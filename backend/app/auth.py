"""Passcode on the whole app (section 14). Unset ADMIN_PASSCODE means local development: no passcode."""
from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .settings import env

COOKIE = "rw_session"
OPEN_PATHS = {"/api/session", "/api/login"}
MAX_TRIES, WINDOW = 10, 300          # at most 10 passcode attempts per 5 minutes from one address
_tries: dict[str, list[float]] = {}

router = APIRouter(prefix="/api")


def _token(passcode: str) -> str:
    return hmac.new(passcode.encode(), b"research-workbench-session-v1", hashlib.sha256).hexdigest()


def required() -> bool:
    return bool(env("ADMIN_PASSCODE"))


def signed_in(request: Request) -> bool:
    pc = env("ADMIN_PASSCODE")
    if not pc:
        return True
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), _token(pc))


def _https(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.split(",")[0].strip() == "https"


@router.get("/session")
def session_state(request: Request):
    return {"required": required(), "signed_in": signed_in(request)}


@router.post("/login")
def login(body: dict, request: Request, response: Response):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0]
    now = time.time()
    recent = [t for t in _tries.get(ip, []) if now - t < WINDOW]
    if len(recent) >= MAX_TRIES:
        return JSONResponse(status_code=429, content={"reason": "Too many tries. Wait five minutes, then try again."})
    pc = env("ADMIN_PASSCODE")
    if pc and not hmac.compare_digest(str(body.get("passcode", "")), pc):
        _tries[ip] = recent + [now]
        return JSONResponse(status_code=401, content={"reason": "That passcode isn't right. Check it and try again."})
    _tries.pop(ip, None)
    if pc:
        response.set_cookie(COOKIE, _token(pc), httponly=True, samesite="lax", secure=_https(request),
                            max_age=7 * 24 * 3600, path="/")
    return {"ok": True}
