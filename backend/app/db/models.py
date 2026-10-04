"""SQLite tables (section 7). Tables are created at startup; no migrations framework."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, SQLModel


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def J(default=list):
    return Field(default_factory=default, sa_column=Column(JSON))


class Case(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    title: str = ""
    client_name: str = ""
    client_aliases: list = J()
    private_numbers: list = J()
    country: str = ""
    industry: str = ""
    function: str = ""
    raw_ask: str = Field(default="", sa_column=Column(Text))
    mode: str = "fixtures"
    sample: str = ""                 # sample pack name, '' for a blank case
    status: str = "open"
    current_step: int = 1
    settings_json: dict = J(dict)    # timestamps of sign-offs, requests text, toggles


class Frame(SQLModel, table=True):
    case_id: int = Field(primary_key=True)
    client_belief: str = ""
    decision: str = ""
    case_measure_name: str = ""
    case_measure_definition: str = ""
    proposed: dict = J(dict)         # what the model proposed, for the edit log
    confirmed_at: Optional[str] = None


class Hypothesis(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    code: str
    text: str
    fact_type: str = "market"                     # market | client_operational
    measure_name: str = ""
    measure_unit: str = ""
    measure_definition: str = ""
    comparator: str = ">="
    pass_line_value: Optional[float] = None
    pass_line_formula: Optional[str] = None
    assumptions_json: list = J()                  # [{name,label,value,unit,min,max}]
    slider_min: Optional[float] = None
    slider_max: Optional[float] = None
    links_reopened_for_trip: bool = False
    tolerance_pct: float = 5
    recency_category: str = "size_growth_price"   # or structural_timing
    pass_line_source_type: str = "estimate"       # client_goal | benchmark | estimate
    pass_line_source_note: str = ""
    must_have: bool = False
    removed_reason: Optional[str] = None
    locked_at: Optional[str] = None
    order: int = 0


class RuleSet(SQLModel, table=True):
    case_id: int = Field(primary_key=True)
    adding_up_rule: str = ""
    thresholds_json: dict = J(dict)
    locked_at: Optional[str] = None


class EvidenceNeed(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    ref: str = ""                                  # stable id from the model or pack (N1..)
    hypothesis_code: str = ""
    text: str = ""
    route: str = "desk"                            # desk | client | expert
    coverage: str = "not_covered"                  # answered_by_client_file | partly | not_covered
    covered_by_file_id: Optional[int] = None
    covered_locator: str = ""
    coverage_note: str = ""                        # what is missing, or why the locator failed
    status: str = "open"                           # open | answered | pending
    queries_json: list = J()                       # [{original, sanitised, removed, query, blocked}]


class ClientFile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    filename: str
    kind: str = "initial"                          # initial | followup | expert_note | archive
    text_extract: str = Field(default="", sa_column=Column(Text))
    figures_json: list = J()                       # read at upload when "AI reads client files" is on
    describe_json: dict = J(dict)
    uploaded_at: str = Field(default_factory=now)
    trip_id: Optional[int] = None


class SourcePlanItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    source_name: str
    domain: str = ""
    origin_type: str = "open_web"
    tier: Optional[int] = None
    tier_reason: str = ""
    stated_by_consultant: bool = False
    included: bool = True
    removed_reason: Optional[str] = None


class EvidenceItem(SQLModel, table=True):
    pk: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    id: str = Field(index=True)                    # E1, E2 ... per case
    seq: int = 0
    seed_id: str = ""
    need_ref: str = ""
    origin_type: str = "open_web"
    found_in: str = ""                             # for benchmarks: where it was found
    source_name: str = ""
    title: str = ""
    url: str = ""
    domain: str = ""
    publisher: str = ""
    published_date: str = ""
    data_as_of: str = ""
    retrieved_at: str = Field(default_factory=now)
    text: str = Field(default="", sa_column=Column(Text))
    text_hash: str = ""
    simulated: bool = False
    original_group_id: str = ""
    duplicate_of: Optional[str] = None
    duplicate_rule: str = ""
    credibility_json: dict = J(dict)
    checklist_json: list = J()
    figures_json: list = J()
    status: str = "pending_clean"
    bucket: str = ""                               # auto | decision | reference | pending | duplicate | trip
    decided_by: str = ""
    decision_reason: str = ""
    seen_by_consultant: bool = False
    spot_check_selected: bool = False
    spot_check_result: str = ""
    trip_id: Optional[int] = None
    script_tag: str = ""
    file_id: Optional[int] = None


class EvidenceLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    evidence_id: str
    hypothesis_code: str
    role: str = "supports_test"                    # supports_test | cross_check | sets_pass_line | context
    figure_index: int = 0
    proposed_by: str = "rule_engine"               # llm | rule_engine | consultant
    confirmed: bool = False


class Calc(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    evidence_ids: list = J()
    formula_text: str = ""
    inputs_json: dict = J(dict)
    result_value: Optional[float] = None
    unit: str = ""
    run_at: str = Field(default_factory=now)
    kind: str = "derivation"                       # derivation | conversion


class Verdict(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    hypothesis_code: str
    result: str
    confidence: str
    reason_codes: list = J()
    evidence_ids: list = J()
    why: str = ""
    detail_json: dict = J(dict)
    version: int = 1
    computed_at: str = Field(default_factory=now)
    current: bool = True


class Trip(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    hypothesis_code: str
    n: int
    question: str = Field(default="", sa_column=Column(Text))
    what_we_have: str = Field(default="", sa_column=Column(Text))
    marked_sent_at: Optional[str] = None
    reply_file_id: Optional[int] = None
    override_reason: Optional[str] = None
    sample_mix_json: dict = J(dict)
    retested_at: Optional[str] = None


class Overall(SQLModel, table=True):
    case_id: int = Field(primary_key=True)
    result: str
    rule_applied: str = ""
    computed_at: str = Field(default_factory=now)
    stale: bool = False


class Summary(SQLModel, table=True):
    case_id: int = Field(primary_key=True)
    sentences: list = J()
    version: int = 1
    source: str = "llm"
    unknowns: list = J()


class Conclusion(SQLModel, table=True):
    case_id: int = Field(primary_key=True)
    text: str = Field(default="", sa_column=Column(Text))
    saved_at: Optional[str] = None


class Activity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    ts: str = Field(default_factory=now)
    actor: str = "system"            # consultant | llm | rule_engine | client | expert | system
    event_type: str = ""
    step: int = 0
    message: str = ""
    payload_json: dict = J(dict)


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: int = Field(index=True)
    kind: str
    status: str = "queued"           # queued | running | done | failed
    started_at: str = Field(default_factory=now)
    finished_at: Optional[str] = None
    error: str = ""
    progress_json: dict = J(dict)


class LlmCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    job: str = ""
    model: str = ""
    prompt_version: str = ""
    output_json: Any = Field(default=None, sa_column=Column(JSON))
    created_at: str = Field(default_factory=now)


class SearchCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    provider: str = ""
    response_json: Any = Field(default=None, sa_column=Column(JSON))
    created_at: str = Field(default_factory=now)


class CostLedger(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    case_id: Optional[int] = Field(default=None, index=True)
    ts: str = Field(default_factory=now)
    kind: str = "llm"
    job: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    search_credits: float = 0
    cost_usd: float = 0
