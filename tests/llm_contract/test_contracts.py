"""LLM contract tests with mocked clients: no real calls."""
import asyncio

import pytest

from backend.app.errors import JobFailure
from backend.app.llm import interface
from backend.app.llm.fixture import FixtureLLM


class Scripted(interface.LLMClient):
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def raw(self, job, key, payload, case_id, retry_error=None):
        self.calls.append(retry_error)
        return self.replies.pop(0)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_invalid_then_retry_succeeds():
    c = Scripted([{"queries": []}, {"queries": ["a query"]}])
    out = run(interface.run(c, "GENERATE_QUERIES", "N1", {}))
    assert out.queries == ["a query"]
    assert c.calls[0] is None and "queries" in c.calls[1]          # the validation error is sent back once


def test_invalid_twice_fails_visibly():
    c = Scripted([{"bad": 1}, "not json at all"])
    with pytest.raises(JobFailure) as e:
        run(interface.run(c, "FRAME", "", {}))
    assert "Nothing was invented" in str(e.value)
    assert len(c.calls) == 2                                         # never more than one retry


def test_fixture_missing_is_a_visible_failure():
    with pytest.raises(JobFailure) as e:
        run(interface.run(FixtureLLM({}), "READ_SOURCE", "seed_x", {}))
    assert "fixture missing: READ_SOURCE:seed_x" in str(e.value)


def test_cross_check_cannot_be_proposed_by_the_model():
    c = Scripted([{"links": [{"idea": "H1", "role": "cross_check"}]}] * 2)
    with pytest.raises(JobFailure):
        run(interface.run(c, "LINK_EVIDENCE", "x", {}))


def test_summary_validation(client):
    from tests.e2e.script_runner import Runner
    from backend.app.db.session import session
    from backend.app.workflow.results import validate_summary
    r = Runner(client, "sample_01_card_launch")
    r.run_to_tests()
    v = {k: x[0] for k, x in r.verdicts().items()}
    eid = next(e["id"] for e in r.case()["evidence"] if e["seed_id"] == "db_forecast")
    with session() as s:
        assert validate_summary(s, r.cid, [{"text": "Growth is 13.8% a year.", "evidence_ids": [eid]}], v) == []
        errs = validate_summary(s, r.cid, [{"text": "Growth is 13.8% a year.", "evidence_ids": ["E999"]}], v)
        assert any("E999" in x for x in errs)                         # a summary citing a missing id
        errs = validate_summary(s, r.cid, [{"text": "Growth is 41.7% a year.", "evidence_ids": [eid]}], v)
        assert any("41.7" in x for x in errs)                         # a number not in the engine's data
        errs = validate_summary(s, r.cid, [{"text": "H1 holds comfortably.", "evidence_ids": [eid]}], v)
        assert any("H1" in x for x in errs)                           # contradicts the verdict
        errs = validate_summary(s, r.cid, [{"text": "We recommend a launch.", "evidence_ids": [eid]}], v)
        assert errs                                                   # the agent never writes the conclusion
