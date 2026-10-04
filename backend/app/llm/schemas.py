"""Pydantic schemas for every LLM job. Every reply is validated; nothing is invented silently."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class FrameOut(BaseModel):
    client_belief: str
    decision: str
    case_measure_name: str
    case_measure_definition: str


class Assumption(BaseModel):
    name: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")
    label: str
    value: float
    unit: str = ""
    min: Optional[float] = None
    max: Optional[float] = None


class IdeaOut(BaseModel):
    code: str = Field(pattern=r"^H\d{1,2}$")
    text: str
    fact_type: Literal["market", "client_operational"]
    measure_name: str
    measure_unit: str
    measure_definition: str = ""
    comparator: Literal[">=", "<="]
    pass_line_value: Optional[float] = None
    pass_line_formula: Optional[str] = None
    assumptions: list[Assumption] = []
    source_type: Literal["client_goal", "benchmark", "estimate"]
    source_note: str
    must_have: bool = False
    tolerance_pct: float = 5
    recency_category: Literal["size_growth_price", "structural_timing"] = "size_growth_price"
    benchmark_need: Optional[str] = None       # what to search for when the pass line comes from a benchmark

    @model_validator(mode="after")
    def _line(self):
        if self.pass_line_value is None and not self.pass_line_formula:
            raise ValueError("each idea needs a pass line value or formula")
        return self


class PlanOut(BaseModel):
    ideas: list[IdeaOut] = Field(min_length=1, max_length=8)


class NeedOut(BaseModel):
    ref: str
    idea: str
    text: str
    route: Literal["desk", "client", "expert"]
    coverage: Literal["answered_by_client_file", "partly", "not_covered"] = "not_covered"
    file: Optional[str] = None
    locator: str = ""
    missing: str = ""


class RouteOut(BaseModel):
    needs: list[NeedOut] = Field(min_length=1)


class QueriesOut(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=3)


class FigureOut(BaseModel):
    value: Optional[float] = None
    low: Optional[float] = None
    high: Optional[float] = None
    unit: str
    period: str = ""
    quote_span: str
    locator: str = ""

    @model_validator(mode="after")
    def _num(self):
        if self.value is None and (self.low is None or self.high is None):
            raise ValueError("a figure needs a value or a low and high")
        return self


class DescribeOut(BaseModel):
    author_type: str = ""
    method_cited: bool = False
    original_source_named: bool = False
    original_source_name: str = ""
    published_date: str = ""
    data_as_of: str = ""


class ReadOut(BaseModel):
    figures: list[FigureOut] = []
    describe: DescribeOut = DescribeOut()


class LinkOut(BaseModel):
    idea: str
    role: Literal["supports_test", "context"]       # cross_check is assigned by the consultant only
    figure_index: int = 0


class DerivationOut(BaseModel):
    op: Literal["ratio", "difference", "cagr"]
    a_ref: int
    b_ref: int
    years: Optional[float] = None
    result_unit: str
    rationale: str = ""
    idea: str = ""


class LinkEvidenceOut(BaseModel):
    links: list[LinkOut] = []
    derivations: list[DerivationOut] = []


class FollowupOut(BaseModel):
    question: str
    what_we_have: str


class Sentence(BaseModel):
    text: str
    evidence_ids: list[str] = Field(min_length=1)


class SummaryOut(BaseModel):
    sentences: list[Sentence] = Field(min_length=1)


class Unknown(BaseModel):
    idea: str
    text: str


class UnknownsOut(BaseModel):
    unknowns: list[Unknown] = []


SCHEMAS = {
    "FRAME": FrameOut, "PLAN_HYPOTHESES": PlanOut, "ROUTE_NEEDS": RouteOut, "GENERATE_QUERIES": QueriesOut,
    "READ_SOURCE": ReadOut, "LINK_EVIDENCE": LinkEvidenceOut, "DRAFT_FOLLOWUP": FollowupOut,
    "SUMMARISE": SummaryOut, "UNKNOWNS": UnknownsOut,
}
SMART_JOBS = {"FRAME", "PLAN_HYPOTHESES", "DRAFT_FOLLOWUP", "SUMMARISE"}
