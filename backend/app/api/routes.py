"""REST API (section 11). Every mutating endpoint checks the state machine; unmet gates return 409."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel

from .. import activity, budget, jobs, samples, selfcheck
from ..search import archive
from ..errors import BadInput
from ..settings import CONFIG_DIR, app_settings, effective_mode, keys_present, save_app_settings
from ..workflow import bundle, frame, gather, replay, results

router = APIRouter(prefix="/api")


class CaseIn(BaseModel):
    title: Optional[str] = None
    client_name: Optional[str] = None
    client_aliases: Optional[list[str]] = None
    private_numbers: Optional[list[str]] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    function: Optional[str] = None
    raw_ask: Optional[str] = None
    ai_reads_client_files: Optional[bool] = None


def ok(**kw) -> dict:
    return {"ok": True, **kw}


def jv(j) -> dict | None:
    return bundle.job(j.id) if j else None


# ------------------------------------------------------------------ cases

@router.get("/cases")
def list_cases():
    return bundle.case_list()


@router.post("/cases")
def create_case(body: CaseIn):
    cid = frame.create_case(body.model_dump(exclude_none=True))
    return {"id": cid}


@router.post("/cases/import")
async def import_case(file: Optional[UploadFile] = File(None)):
    import json
    if file is None:
        raise BadInput("Choose the JSON file you downloaded from this tool.")
    try:
        data = json.loads(file.file.read().decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise BadInput("This file isn't valid JSON. Use the file from Download JSON on the last step.")
    return {"id": results.import_case(data)}


@router.get("/cases/{cid}")
def get_case(cid: int):
    return bundle.build(cid)


@router.put("/cases/{cid}")
def update_case(cid: int, body: CaseIn):
    frame.update_case(cid, body.model_dump(exclude_none=True))
    return ok()


@router.delete("/cases/{cid}")
def delete_case(cid: int):
    results.delete_case(cid)
    return ok()


@router.post("/cases/{cid}/reset")
def reset_case(cid: int):
    results.reset_case(cid)
    return ok()


@router.post("/cases/{cid}/files")
async def upload(cid: int, file: Optional[UploadFile] = File(None), kind: str = Form("initial"),
                 text: Optional[str] = Form(None), filename: Optional[str] = Form(None)):
    if kind not in ("initial", "followup", "expert_note", "archive"):
        raise BadInput("That kind of file isn't expected here.")
    name, data = _payload(file, text, filename)
    if kind == "initial":
        fid = frame.add_file(cid, name, data, "initial")
        return ok(file_id=fid)
    j = gather.add_reply(cid, name, data, kind)
    return ok(job=jv(j))


def _payload(file: Optional[UploadFile], text: Optional[str], filename: Optional[str]) -> tuple[str, bytes]:
    if file is not None:
        return file.filename or "upload", file.file.read()
    if text and text.strip():
        return (filename or "pasted-note.txt"), text.encode("utf-8")
    raise BadInput("Add a file or paste some text first.")


@router.put("/cases/{cid}/files/{fid}/figures")
def type_figures(cid: int, fid: int, body: dict):
    frame.set_file_figures(cid, fid, body.get("figures") or [])
    return ok()


# ------------------------------------------------------------------ steps 1 to 3

@router.post("/cases/{cid}/read-ask")
def read_ask(cid: int):
    return ok(job=jv(frame.read_ask(cid)))


@router.put("/cases/{cid}/frame")
def edit_frame(cid: int, body: dict):
    frame.edit_frame(cid, body)
    return ok()


@router.post("/cases/{cid}/frame/confirm")
def confirm_frame(cid: int):
    return ok(job=jv(frame.confirm_frame(cid)))


@router.post("/cases/{cid}/plan/retry")
def retry_plan(cid: int):
    return ok(job=jv(frame.start_plan(cid)))


@router.get("/cases/{cid}/hypotheses")
def get_hypotheses(cid: int):
    return bundle.build(cid)["hypotheses"]


@router.put("/cases/{cid}/hypotheses")
def put_hypotheses(cid: int, body: list[dict]):
    frame.edit_hypotheses(cid, body)
    return ok()


@router.post("/cases/{cid}/plan/lock")
def lock_plan(cid: int, body: dict):
    return ok(job=jv(frame.lock_plan(cid, bool(body.get("ticked")))))


# ------------------------------------------------------------------ steps 4 to 7

@router.get("/cases/{cid}/needs")
def get_needs(cid: int):
    return bundle.build(cid)["needs"]


@router.put("/cases/{cid}/needs/{ref}/query")
def edit_query(cid: int, ref: str, body: dict):
    gather.edit_query(cid, ref, body.get("query", ""))
    return ok()


@router.post("/cases/{cid}/needs/retry")
def retry_route(cid: int):
    return ok(job=jv(gather.start_route(cid)))


@router.get("/cases/{cid}/source-plan")
def get_plan(cid: int):
    return bundle.build(cid)["plan"]


@router.put("/cases/{cid}/source-plan")
def put_plan(cid: int, body: list[dict]):
    gather.edit_source_plan(cid, body)
    return ok()


@router.post("/cases/{cid}/requests/mark-sent")
def mark_sent(cid: int, body: dict):
    return ok(job=jv(gather.mark_sent(cid, bool(body.get("reviewed")))))


@router.post("/cases/{cid}/collect/start")
def collect_start(cid: int):
    return ok(job=jv(gather.start_collect(cid)))


@router.post("/cases/{cid}/collect/stop")
def collect_stop(cid: int):
    gather.stop_collect(cid)
    return ok()


@router.post("/cases/{cid}/clean/run")
def clean_run(cid: int):
    return ok(job=jv(gather.start_clean(cid)))


@router.get("/cases/{cid}/evidence")
def get_evidence(cid: int):
    return bundle.build(cid)["evidence"]


@router.post("/cases/{cid}/evidence/{eid}/decision")
def decision(cid: int, eid: str, body: dict):
    gather.decide(cid, eid, body.get("action", ""), body.get("reason") or "", bool(body.get("confirm_formula")))
    return ok()


@router.put("/cases/{cid}/evidence/{eid}/links")
def put_links(cid: int, eid: str, body: list[dict]):
    gather.set_links(cid, eid, body)
    return ok()


@router.post("/cases/{cid}/review/seen/{eid}")
def seen(cid: int, eid: str, body: Optional[dict] = None):
    gather.mark_seen(cid, eid, bool((body or {}).get("send_to_review")))
    return ok()


@router.post("/cases/{cid}/review/spot-check/{eid}")
def spot(cid: int, eid: str, body: dict):
    gather.spot_check(cid, eid, bool(body.get("matches")), bool(body.get("skip")))
    return ok()


@router.post("/cases/{cid}/review/confirm-sources")
def confirm_sources(cid: int, body: dict):
    gather.confirm_sources(cid, bool(body.get("ticked", True)))
    return ok()


# ------------------------------------------------------------------ steps 8 to 12

@router.post("/cases/{cid}/test/run")
def run_tests(cid: int, body: Optional[dict] = None):
    results.run_tests(cid, (body or {}).get("hypothesis"))
    return ok()


@router.post("/cases/{cid}/trips")
def create_trip(cid: int, body: dict):
    tid = results.create_trip(cid, body.get("hypothesis", ""), bool(body.get("override")),
                              body.get("override_reason") or "")
    return ok(trip_id=tid)


@router.put("/cases/{cid}/trips/{tid}")
def edit_trip(cid: int, tid: int, body: dict):
    results.edit_trip(cid, tid, body.get("question", ""))
    return ok()


@router.post("/cases/{cid}/trips/{tid}/sent")
@router.post("/cases/{cid}/trips/{tid}/mark-sent")
def trip_sent(cid: int, tid: int):
    results.mark_trip_sent(cid, tid)
    return ok()


@router.post("/cases/{cid}/trips/{tid}/reply")
async def trip_reply(cid: int, tid: int, file: Optional[UploadFile] = File(None), text: Optional[str] = Form(None),
                     filename: Optional[str] = Form(None)):
    name, data = _payload(file, text, filename)
    return ok(job=jv(results.trip_reply(cid, tid, name, data)))


@router.post("/cases/{cid}/trips/{tid}/sample-mix")
def sample_mix(cid: int, tid: int, body: dict):
    return results.record_sample_mix(cid, tid, body.get("sample") or {}, body.get("target") or {},
                                     bool(body.get("not_applicable")), body.get("note") or "")


@router.post("/cases/{cid}/retest")
def retest(cid: int, body: dict):
    results.run_tests(cid, body.get("hypothesis") or "")
    return ok()


@router.get("/cases/{cid}/unknowns")
def unknowns(cid: int):
    return (bundle.build(cid).get("summary") or {}).get("unknowns") or []


@router.post("/cases/{cid}/sample/advance")
def sample_advance(cid: int, to: int):
    return ok(job=jv(replay.advance(cid, to)))


@router.post("/cases/{cid}/addup/run")
def addup(cid: int):
    return ok(job=jv(results.start_addup(cid)))


@router.post("/cases/{cid}/whatif")
def whatif(cid: int, body: dict):
    return results.what_if(cid, body.get("assumptions") or {}, body.get("pass_lines") or {})


@router.post("/cases/{cid}/plan/retarget")
def retarget(cid: int, body: dict):
    return ok(job=jv(results.retarget(cid, body.get("kind", ""), body.get("key", ""), body.get("value"))))


@router.put("/cases/{cid}/conclusion")
def conclusion(cid: int, body: dict):
    results.save_conclusion(cid, body.get("text", ""))
    return ok()


@router.get("/cases/{cid}/export")
def export(cid: int, format: str = "md"):
    title = bundle.build(cid)["case"]["title"].replace(" ", "_").replace("/", "-")[:60] or f"case_{cid}"
    if format == "md":
        return PlainTextResponse(results.export_markdown(cid), media_type="text/markdown",
                                 headers={"Content-Disposition": f'attachment; filename="{title}.md"'})
    if format == "json":
        return Response(results.export_json(cid), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{title}.json"'})
    if format == "html":
        from ..workflow.printable import render
        return HTMLResponse(render(cid))
    if format == "activity_csv":
        return PlainTextResponse(results.export_activity_csv(cid), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{title}_activity.csv"'})
    raise BadInput("Choose Markdown, JSON or the printable page.")


@router.get("/cases/{cid}/activity")
def get_activity(cid: int, since_id: int = 0, format: str = "json"):
    if format == "csv":
        return export(cid, "activity_csv")
    return activity.since(cid, since_id)


@router.get("/cases/{cid}/jobs/{jid}")
def get_job(cid: int, jid: int):
    j = bundle.job(jid)
    if not j:
        raise BadInput("We lost track of that task. Refresh the page.")
    return j


# ------------------------------------------------------------------ samples and settings

@router.post("/cases/{cid}/use-demo-data")
def use_demo_data(cid: int):
    frame.use_demo_data(cid)
    return ok()


@router.post("/cases/{cid}/fresh-answers")
def fresh_answers(cid: int, body: dict):
    frame.set_bypass_cache(cid, bool(body.get("on")))
    return ok()


@router.get("/selfcheck")
async def run_selfcheck():
    return await selfcheck.run(live_calls=True)


@router.get("/archive")
def archive_list():
    return archive.listing()


@router.post("/archive")
async def archive_add(file: UploadFile = File(...), title: str = Form(""), published_date: str = Form("")):
    from ..files import parse as fparse
    name = file.filename or "document"
    data = file.file.read()
    try:
        text = fparse.parse(name, data)
    except fparse.UnsupportedFile as e:
        raise BadInput(str(e))
    except Exception:
        raise BadInput(f"We couldn't read {name}. Try again, or upload a csv, xlsx, txt or pdf file instead.")
    return {"id": archive.add(title.strip() or name, name, text, published_date.strip())}


@router.delete("/archive/{doc_id}")
def archive_remove(doc_id: int):
    archive.remove(doc_id)
    return ok()


@router.get("/samples")
def list_samples():
    return samples.listing()


@router.post("/samples/{name}/load")
def load_sample(name: str):
    try:
        cid = frame.load_sample(name)
    except KeyError:
        raise BadInput("That sample isn't available.")
    return {"id": cid}


@router.get("/samples/{name}/replies/{filename}")
def sample_reply(name: str, filename: str):
    """A sample pack's simulated reply file, so a demo can play the client's answer at step 9."""
    try:
        data = samples.file_bytes(name, filename, "replies")
    except KeyError:
        raise BadInput("No such sample reply")
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.put("/settings")
def put_settings(body: dict):
    before = app_settings().get("double_check", True)
    after = save_app_settings(body).get("double_check", True)
    if before != after:
        gather.log_double_check_setting(after)
    return get_settings()


@router.get("/settings")
def get_settings():
    mode, notice = effective_mode()
    return {"mode": mode, "notice": notice, "keys": keys_present(), "app": app_settings(), "spend": budget.status(None),
            "rules_yaml": (CONFIG_DIR / "rules.yaml").read_text(encoding="utf-8"),
            "registry_yaml": (CONFIG_DIR / "source_registry.yaml").read_text(encoding="utf-8")}
