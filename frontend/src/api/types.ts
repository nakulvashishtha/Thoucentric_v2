// Shapes returned by GET /api/cases/{id}. Kept loose on purpose: the server is the source of truth.
export type Actor = "consultant" | "llm" | "rule_engine" | "client" | "expert" | "system";

export interface Figure {
  value?: number | null; low?: number | null; high?: number | null; unit: string; period?: string;
  quote_span?: string; locator?: string; kind?: string; verified?: boolean; verify_note?: string;
  typed_by_consultant?: boolean;
  derivation?: { op: string; input_figure_refs: number[]; years?: number | null; result_unit: string; rationale: string;
    formula: string; unit_ok: boolean; years_ok: boolean; note: string; formula_confirmed: boolean };
}
export interface Link { id: number; evidence_id: string; hypothesis_code: string; role: string; figure_index: number;
  proposed_by: string; confirmed: boolean }
export interface CheckTest { test: string; pass: boolean; threshold: string; actual: string }
export interface Evidence {
  id: string; seq: number; seed_id: string; need_ref: string; origin_type: string; found_in: string; source_name: string;
  title: string; url: string; domain: string; publisher: string; published_date: string; data_as_of: string;
  text: string; simulated: boolean; original_group_id: string; duplicate_of: string | null; duplicate_rule: string;
  credibility_json: any; checklist_json: CheckTest[]; figures_json: Figure[]; status: string; bucket: string;
  decided_by: string; decision_reason: string; seen_by_consultant: boolean; spot_check_selected: boolean;
  spot_check_result: string; trip_id: number | null; links: Link[]; status_label: string; tier: number | null;
  tier_label: string; date: string; claim: string; copies: string[]; file_id: number | null;
}
export interface Verdict { hypothesis_code: string; result: string; confidence: string; reason_codes: string[];
  evidence_ids: string[]; why: string; version: number; detail_json: any }
export interface Hypothesis {
  id: number; code: string; text: string; fact_type: string; measure_name: string; measure_unit: string;
  measure_definition: string; comparator: string; pass_line_value: number | null; pass_line_formula: string | null;
  assumptions_json: { name: string; label: string; value: number; unit: string; min?: number | null; max?: number | null }[];
  slider_min: number | null; slider_max: number | null; tolerance_pct: number; pass_line_source_type: string;
  pass_line_source_note: string; must_have: boolean; removed_reason: string | null; locked_at: string | null;
  links_reopened_for_trip: boolean; recency_category: string;
  line: number | null; line_text: string; verdict: Verdict | null; benchmarks: string[];
}
export interface Need { id: number; ref: string; hypothesis_code: string; text: string; route: string; coverage: string;
  covered_by_file_id: number | null; covered_locator: string; coverage_note: string; status: string;
  queries_json: { original: string; sanitised: string; removed: string[]; query: string; blocked: string[] }[] }
export interface Job { id: number; kind: string; status: string; error: string; progress: any; started_at: string;
  finished_at: string | null }
export interface StepState { n: number; title: string; phase: number; signoff: boolean; state: string;
  locked_reason: string; current: boolean }
export interface Trip { id: number; hypothesis_code: string; n: number; question: string; what_we_have: string;
  marked_sent_at: string | null; reply_file_id: number | null; override_reason: string | null; sample_mix_json: any;
  retested_at: string | null }
export interface SliderDef { kind: string; key: string; label: string; idea: string; value: number; unit: string;
  min: number; max: number; formula?: string }
export interface Bundle {
  case: any; mode: { case: string; app: string; notice: string }; frame: any; ruleset: any;
  hypotheses: Hypothesis[]; needs: Need[];
  files: { id: number; filename: string; kind: string; uploaded_at: string; figures: Figure[]; trip_id: number | null;
    preview: string }[];
  plan: any[]; evidence: Evidence[];
  duplicate_groups: { original: string; copies: string[]; original_title: string; rule: string }[];
  calcs: any[]; trips: Trip[]; overall: any; summary: any; conclusion: any;
  progress: { steps: StepState[]; current: number; done: Record<string, boolean>; reopened: string[] };
  review: any; counts: any; spend: Spend; sample_replies: Record<string, string>; jobs: Record<string, Job>; running_jobs: string[]; sliders: SliderDef[]; rules: any;
}
export interface ActivityRow { id: number; ts: string; actor: Actor; event_type: string; step: number; message: string; payload_json?: any }

export interface Spend { case_usd: number; today_usd: number; daily_cap_usd: number; calls: number; max_calls: number;
  search_credits: number; max_search_credits: number; reached: string[]; warn: string[] }
