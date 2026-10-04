"""FastAPI app: the API under /api, the built frontend at /, and /healthz."""
from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from . import auth, jobs, selfcheck
from .api.routes import router
from .db.session import get_engine
from .errors import BadInput, GateError, JobFailure, NotFound
from .settings import FRONTEND_DIST, effective_mode, keys_present

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("workbench")

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_: FastAPI):
    await startup()
    yield


app = FastAPI(title="Research Workbench", docs_url=None, redoc_url=None, lifespan=lifespan)
app.include_router(router)
app.include_router(auth.router)


@app.middleware("http")
async def passcode_gate(request: Request, call_next):
    """The passcode protects every /api route. /healthz and the page itself stay open (they hold no data)."""
    path = request.url.path
    if path.startswith("/api/") and path not in auth.OPEN_PATHS and not auth.signed_in(request):
        return JSONResponse(status_code=401, content={"reason": "Enter the passcode to continue.", "required": []})
    return await call_next(request)


async def startup() -> None:
    jobs.set_loop(asyncio.get_running_loop())
    get_engine()
    jobs.fail_orphans()
    mode, notice = effective_mode()
    present = [k for k, v in keys_present().items() if v]
    log.info("Research Workbench starting in %s mode%s; variables present: %s", mode,
             f" ({notice})" if notice else "", ", ".join(present) or "none")
    asyncio.get_running_loop().create_task(selfcheck.log_at_startup())


@app.exception_handler(GateError)
def gate(_: Request, e: GateError):
    return JSONResponse(status_code=409, content={"reason": e.reason, "required": e.required})


@app.exception_handler(NotFound)
def not_found(_: Request, e: NotFound):
    return JSONResponse(status_code=404, content={"reason": str(e)})


@app.exception_handler(BadInput)
def bad(_: Request, e: BadInput):
    return JSONResponse(status_code=400, content={"reason": str(e)})


@app.exception_handler(JobFailure)
def job_fail(_: Request, e: JobFailure):
    return JSONResponse(status_code=400, content={"reason": str(e)})


@app.exception_handler(RequestValidationError)
def invalid(_: Request, e: RequestValidationError):
    return JSONResponse(status_code=400, content={"reason": "The request was not in the expected shape."})


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    """Serve the built frontend, with a single-page-app fallback for unknown non-API routes."""
    if path.startswith("api/"):
        return JSONResponse(status_code=404, content={"reason": "Not found"})
    target = (FRONTEND_DIST / path).resolve()
    if path and target.is_file() and FRONTEND_DIST.resolve() in target.parents:
        return FileResponse(target)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"message": "Frontend not built yet. Run the frontend build, or use the API."})
