import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Hypothesis } from "../../api/types";
import { go } from "../../App";
import { EvidenceCard } from "../../components/EvidenceCard";
import { GateBox, Lock, Sim, Term, figText, withUnit } from "../../components/ui";
import { JobView, useCtx } from "../CaseView";

/* ================================================================ step 1 */
export function Step1() {
  const { b, cid, act, call, send, readOnly, goStep } = useCtx();
  const c = b.case;
  const locked = readOnly || b.progress.done["2"];
  const [f, setF] = useState({
    title: c.title || "", client_name: c.client_name, country: c.country, industry: c.industry, function: c.function,
    raw_ask: c.raw_ask, client_aliases: ((c.client_aliases || []) as string[]).join(", "), private_numbers: ((c.private_numbers || []) as string[]).join("\n"),
  });
  const [samples, setSamples] = useState<any[]>([]);
  useEffect(() => { api("GET", "/samples").then(setSamples).catch(() => {}); }, []);
  const save = (patch: Partial<typeof f>) => {
    const n = { ...f, ...patch };
    setF(n);
    return api("PUT", `/cases/${cid}`, {
      title: n.title || n.client_name, client_name: n.client_name, country: n.country, industry: n.industry, function: n.function,
      raw_ask: n.raw_ask, client_aliases: n.client_aliases.split(",").map((x) => x.trim()).filter(Boolean),
      private_numbers: n.private_numbers.split("\n").map((x) => x.trim()).filter(Boolean),
    }).catch(() => {});
  };
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="field">{label}{hint && <span className="hint">{hint}</span>}
      <input className="input" value={f[k]} disabled={locked} onChange={(e) => setF({ ...f, [k]: e.target.value })} onBlur={() => save({})} />
    </label>
  );
  const missing = (["client_name", "country", "industry", "function", "raw_ask"] as const).filter((k) => !String(f[k] || "").trim());
  const labels: Record<string, string> = { client_name: "client", country: "country", industry: "industry", function: "function", raw_ask: "the ask" };
  const job = b.jobs["frame"];
  const running = job && ["queued", "running"].includes(job.status);
  const initialFiles = b.files.filter((x) => x.kind === "initial");
  const reads = c.settings_json?.ai_reads_client_files !== false;
  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "initial");
      await send("/files", form);
    }
  };
  const readAsk = async () => { await save({}); await call("POST", "/read-ask"); };
  const loadSample = async (name: string) => { const r = await api("POST", `/samples/${name}/load`); go(`#/case/${r.id}/1`); };

  return (
    <div className="stack">
      <div className="grid2">
        <section className="card stack-s">
          <h2>Case details</h2>
          {field("client_name", "Client", "The name stays inside the firm: it is stripped from everything that goes out.")}
          <div className="grid2">{field("country", "Country")}{field("industry", "Industry")}</div>
          {field("function", "Function", "For example growth strategy, operations, pricing")}
          {field("client_aliases", "Other names for the client", "Comma separated: short names, brands, tickers")}
          <label className="field">Private numbers that must never leave<span className="hint">One per line, for example a budget or a customer count</span>
            <textarea className="input" style={{ minHeight: 76 }} value={f.private_numbers} disabled={locked}
              onChange={(e) => setF({ ...f, private_numbers: e.target.value })} onBlur={() => save({})} /></label>
        </section>
        <section className="card stack-s">
          <h2>The ask, in the client's words</h2>
          <label className="field">The ask<span className="hint">Stored exactly as typed. Nothing is tidied up.</span>
            <textarea className="input" style={{ minHeight: 150 }} value={f.raw_ask} disabled={locked}
              onChange={(e) => setF({ ...f, raw_ask: e.target.value })} onBlur={() => save({})} /></label>
          <div className="field">Client files already received
            <span className="hint">csv, xlsx or txt. They are read first, so we only ask the client for what is missing.</span></div>
          {initialFiles.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{initialFiles.map((x) => (
              <li key={x.id}><b>{x.filename}</b>{x.figures?.length ? <span className="muted small"> · {x.figures.length} figure{x.figures.length > 1 ? "s" : ""} read: {x.figures.map(figText).join(", ")}</span> : null}</li>))}
            </ul>
          )}
          {!locked && <input type="file" multiple accept=".csv,.xlsx,.txt" onChange={(e) => onFiles(e.target.files)} aria-label="Upload client files" />}
          <label className="check small"><input type="checkbox" checked={reads} disabled={locked}
            onChange={(e) => act(() => api("PUT", `/cases/${cid}`, { ai_reads_client_files: e.target.checked }))} />
            AI reads client files {reads ? "(on)" : "(off: you type the figures in yourself)"}</label>
          <p className="small muted">Client files are processed by the model provider under the account's terms.</p>
          {!reads && initialFiles.map((x) => <TypedFigures key={x.id} file={x} />)}
        </section>
      </div>
      <JobView job={job} label="Reading the ask" onRetry={readAsk} />
      {!locked && (
        <div className="row">
          <button className="btn navy lg" onClick={readAsk} disabled={missing.length > 0 || running}>{running ? "Reading…" : "Read the ask"}</button>
          {missing.length > 0 && <span className="gate-reason">Add the {missing.map((k) => labels[k]).join(", ")} first</span>}
          <span className="spacer" />
          {samples[0] && !c.sample && <button className="btn" onClick={() => loadSample(samples[0].name)}>Load a sample case</button>}
          {c.sample && <Sim />}
        </div>
      )}
      <GateBox signoff={false} title="The agent frames the question as soon as you click Read the ask."
        next={b.frame ? { n: 2, go: () => goStep(2) } : null} />
    </div>
  );
}

function TypedFigures({ file }: { file: { id: number; filename: string; figures: any[] } }) {
  const { call } = useCtx();
  const [rows, setRows] = useState(file.figures?.length ? file.figures : [{ value: "", unit: "", locator: "" }]);
  const set = (i: number, k: string, v: string) => setRows(rows.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="card tight col">
      <b className="small">Figures in {file.filename}</b>
      {rows.map((r: any, i: number) => (
        <div className="row" key={i}>
          <input className="input sm" style={{ width: 100 }} placeholder="Value" value={r.value ?? ""} onChange={(e) => set(i, "value", e.target.value)} aria-label="Value" />
          <input className="input sm" style={{ width: 120 }} placeholder="Unit" value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} aria-label="Unit" />
          <input className="input sm" style={{ width: 140 }} placeholder="Where (cell or line)" value={r.locator} onChange={(e) => set(i, "locator", e.target.value)} aria-label="Locator" />
        </div>
      ))}
      <div className="row"><button className="btn sm" onClick={() => setRows([...rows, { value: "", unit: "", locator: "" }])}>Add a figure</button>
        <button className="btn sm navy" onClick={() => call("PUT", `/files/${file.id}/figures`, { figures: rows })}>Save figures</button></div>
    </div>
  );
}

/* ================================================================ step 2 */
export function Step2() {
  const { b, cid, call, readOnly, goStep } = useCtx();
  const fr = b.frame;
  const done = b.progress.done["2"];
  const locked = readOnly || done;
  const [v, setV] = useState({ client_belief: fr?.client_belief || "", decision: fr?.decision || "",
    case_measure_name: fr?.case_measure_name || "", case_measure_definition: fr?.case_measure_definition || "" });
  useEffect(() => { if (fr) setV({ client_belief: fr.client_belief, decision: fr.decision, case_measure_name: fr.case_measure_name, case_measure_definition: fr.case_measure_definition }); }, [fr?.confirmed_at, !!fr]);
  const save = () => api("PUT", `/cases/${cid}/frame`, v).catch(() => {});
  const planJob = b.jobs["plan"];
  if (!fr) return <div className="empty">The frame appears here after you click Read the ask at step 1.</div>;
  const edited = (k: string) => fr.proposed && fr.proposed[k] !== (v as any)[k];
  const card = (k: keyof typeof v, title: string, helper: string, rows = 2) => (
    <section className="card">
      <div className="card-head"><h2>{title}</h2>{edited(k) && <span className="pill orange">edited by you</span>}{locked && <Lock text="Confirmed at step 2" />}</div>
      <p className="small muted" style={{ marginBottom: 8 }}>{helper}</p>
      <textarea className="input" style={{ minHeight: rows * 34 }} value={v[k]} disabled={locked}
        onChange={(e) => setV({ ...v, [k]: e.target.value })} onBlur={save} aria-label={title} />
    </section>
  );
  const empty = Object.values(v).some((x) => !x.trim());
  return (
    <div className="stack">
      {card("client_belief", "What the client believes, to be tested", "Their assumption, held as a claim to test. It can never count as evidence for itself.")}
      {card("decision", "The decision they face", "The choice the research has to inform.")}
      <section className="card">
        <div className="card-head"><h2>One measure for comparing market-size numbers</h2>{(edited("case_measure_name") || edited("case_measure_definition")) && <span className="pill orange">edited by you</span>}{locked && <Lock text="Confirmed at step 2" />}</div>
        <p className="small muted" style={{ marginBottom: 8 }}>Every market-size figure is converted to this before it is compared. Ideas about time, cost or share define their own measure at step 3.</p>
        <div className="grid2">
          <label className="field">Name<input className="input" value={v.case_measure_name} disabled={locked} onChange={(e) => setV({ ...v, case_measure_name: e.target.value })} onBlur={save} /></label>
          <label className="field">Precise definition<input className="input" value={v.case_measure_definition} disabled={locked} onChange={(e) => setV({ ...v, case_measure_definition: e.target.value })} onBlur={save} /></label>
        </div>
      </section>
      {done && <JobView job={planJob} label="Drafting the ideas to test" onRetry={() => call("POST", "/plan/retry")} />}
      <GateBox signoff title="Confirm that the belief, the decision and the measure are right." button="Confirm the frame" readOnly={locked}
        onClick={async () => { await save(); await call("POST", "/frame/confirm"); }}
        disabledReason={empty ? "Fill in all three cards first" : undefined}
        done={done} doneText="The frame is confirmed. The client's belief is now a claim to test."
        next={done ? { n: 3, go: () => goStep(3) } : null} />
    </div>
  );
}

/* ================================================================ step 3 */
export function Step3() {
  const { b, call, readOnly, goStep, confirm } = useCtx();
  const done = b.progress.done["3"];
  const locked = readOnly || done;
  const [tick, setTick] = useState(false);
  const planJob = b.jobs["plan"];
  const planning = planJob && ["queued", "running"].includes(planJob.status);
  const hyps = b.hypotheses;
  const kept = hyps.filter((h) => !h.removed_reason);
  const routeJob = b.jobs["route"];
  const save = (code: string, patch: Partial<Hypothesis>) => call("PUT", "/hypotheses", [{ code, ...patch }]);
  if (!hyps.length) return <div className="stack"><JobView job={planJob} label="Drafting the ideas to test" onRetry={() => call("POST", "/plan/retry")} />
    {!planJob && <div className="empty">The ideas appear here after you confirm the frame at step 2.</div>}</div>;
  const problems: string[] = [];
  if (!kept.some((h) => h.must_have)) problems.push("Mark at least one idea as a must-have");
  kept.forEach((h) => { if (h.pass_line_source_type === "benchmark" && !h.benchmarks.length) problems.push(`${h.code} has no benchmark source yet`); });
  const t = b.rules.thresholds;

  return (
    <div className="stack">
      <JobView job={planJob} label="Drafting ideas and fetching benchmarks" onRetry={() => call("POST", "/plan/retry")} />
      <div className="stack">
        <section className="stack-s">
          <div className="row"><h2>Ideas to test</h2><span className="countbadge">{kept.length}</span>
            <span className="muted small">Each has its own measure and a <Term t="pass line">pass line</Term>. Click a row for details.</span></div>
          {hyps.map((h) => <IdeaRow key={h.code} h={h} locked={locked} save={save} />)}
        </section>
        <aside className="card">
          <div className="card-head"><h2>Fixed when you lock</h2><span className="pill grey">read-only</span></div>
          <div className="grid2">
          <div className="stack-s">
          <div><b className="small">Adding-up rule</b><p className="small" style={{ marginTop: 4 }}>{b.rules.adding_up_rule}</p></div>
          <p className="small">Market facts need {t.minimum_sources.market} <Term t="independent source">independent sources</Term>; client facts need {t.minimum_sources.client_operational} and are capped at Medium.
            Default <Term t="tolerance">tolerance</Term>: {t.tolerance_pct_default}%. Spot check: {Math.round(t.spot_check.fraction * 100)}% of auto-approved items, at least {t.spot_check.minimum}.</p>
          </div>
          <div>
          <b className="small">Auto-approval checklist (all nine must pass)</b>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Not client, expert, open web or the client's belief</li>
            <li><Term t="tier">Tier</Term> 1 or 2 (Tier 3 only if traced and corroborated)</li>
            <li>Dated within {t.recency_months.size_growth_price} months (size, growth, price) or {t.recency_months.structural_timing} (timing)</li>
            <li>Names its original source or method</li>
            <li>Convertible to the idea's measure</li>
            <li>Quote verified</li>
            <li>Not a copy of a counted original</li>
            <li>No private client data</li>
            <li>Not load-bearing: does not support a <Term t="must-have">must-have</Term> or set a pass line</li>
          </ol>
          </div>
          </div>
        </aside>
      </div>
      {done && <JobView job={routeJob} label="Planning the evidence" onRetry={() => call("POST", "/needs/retry")} />}
      <GateBox signoff title="Locking freezes the pass lines, must-haves, measures, tolerances, the adding-up rule and the checklist." readOnly={locked}
        button="Lock the plan" busy={planning}
        onClick={async () => {
          if (await confirm("Lock the plan?", "Pass lines, must-haves, measures, tolerances, the adding-up rule and the checklist can't be changed after this. Nobody can move the goalposts once evidence comes in.", "Lock the plan"))
            await call("POST", "/plan/lock", { ticked: tick });
        }}
        disabledReason={planning ? "Wait for the benchmarks to arrive" : problems[0] || (!tick ? "Tick the box first" : undefined)}
        done={done} doneText={`Plan locked: ${kept.length} ideas. Nobody can move the goalposts now.`}
        next={done ? { n: 4, go: () => goStep(4) } : null}>
        {!locked && <label className="check"><input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
          I have checked every idea, its pass line, measure and source, and the must-haves. Lock the plan.</label>}
      </GateBox>
    </div>
  );
}

const SRC_LABEL: Record<string, string> = { client_goal: "Client goal", benchmark: "Benchmark", estimate: "Estimate" };

function IdeaRow({ h, locked, save }: { h: Hypothesis; locked: boolean; save: (code: string, p: Partial<Hypothesis>) => Promise<boolean> }) {
  const { b } = useCtx();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<Partial<Hypothesis>>({});
  const val = <K extends keyof Hypothesis>(k: K) => (k in draft ? (draft as any)[k] : h[k]);
  const commit = () => { if (Object.keys(draft).length) { save(h.code, draft); setDraft({}); } };
  const removed = !!h.removed_reason;
  const benches = b.evidence.filter((e) => h.benchmarks.includes(e.id));
  return (
    <div className="ev" style={removed ? { opacity: 0.7 } : undefined}>
      <button className="ev-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="vcode">{h.code}</span>
        <span className="ev-claim" style={removed ? { textDecoration: "line-through" } : undefined}>{h.text}</span>
        {!removed && <span className="mono small" style={{ fontWeight: 600 }}>{h.comparator === ">=" ? "≥" : "≤"} {h.line_text}</span>}
        {!removed && <span className={`pill ${h.pass_line_source_type === "benchmark" ? "rule" : h.pass_line_source_type === "client_goal" ? "client" : "grey"}`}>{SRC_LABEL[h.pass_line_source_type]}</span>}
        {!removed && h.must_have && <span className="pill lock">must-have</span>}
        {removed && <span className="pill fail">✕ Removed</span>}
        {locked && <span aria-hidden>🔒</span>}
        <span className="muted small" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {removed && <div className="small" style={{ padding: "0 12px 10px" }}><b>Removed by the consultant:</b> {h.removed_reason}</div>}
      {open && !removed && (
        <div className="ev-body">
          {locked && <Lock />}
          <label className="field">Idea<input className="input" value={val("text")} disabled={locked} onChange={(e) => setDraft({ ...draft, text: e.target.value })} onBlur={commit} /></label>
          <div className="grid3">
            <label className="field">Fact type<span className="hint">The language model proposes; you confirm</span>
              <select className="input" value={val("fact_type")} disabled={locked} onChange={(e) => save(h.code, { fact_type: e.target.value })}>
                <option value="market">Market fact (needs 2 independent sources)</option><option value="client_operational">Client operational fact (1 source, capped at Medium)</option></select></label>
            <label className="field">Measure<input className="input" value={val("measure_name")} disabled={locked} onChange={(e) => setDraft({ ...draft, measure_name: e.target.value })} onBlur={commit} /></label>
            <label className="field">Unit<input className="input" value={val("measure_unit")} disabled={locked} onChange={(e) => setDraft({ ...draft, measure_unit: e.target.value })} onBlur={commit} /></label>
          </div>
          <label className="field">Measure definition<input className="input" value={val("measure_definition")} disabled={locked} onChange={(e) => setDraft({ ...draft, measure_definition: e.target.value })} onBlur={commit} /></label>
          <div className="grid3">
            <label className="field">Pass line<span className="hint">{h.pass_line_formula ? `Formula: ${h.pass_line_formula}` : "A fixed value"}</span>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <select className="input" style={{ width: 80 }} value={val("comparator")} disabled={locked} onChange={(e) => save(h.code, { comparator: e.target.value })} aria-label="Comparator">
                  <option value=">=">≥</option><option value="<=">≤</option></select>
                {h.pass_line_formula
                  ? <input className="input" value={val("pass_line_formula") || ""} disabled={locked} onChange={(e) => setDraft({ ...draft, pass_line_formula: e.target.value })} onBlur={commit} aria-label="Pass-line formula" />
                  : <input className="input" type="number" value={val("pass_line_value") ?? ""} disabled={locked} onChange={(e) => setDraft({ ...draft, pass_line_value: e.target.value === "" ? null : Number(e.target.value) })} onBlur={commit} aria-label="Pass-line value" />}
              </div></label>
            <label className="field"><span><Term t="tolerance">Tolerance</Term> (%)</span>
              <input className="input" type="number" value={val("tolerance_pct")} disabled={locked} onChange={(e) => setDraft({ ...draft, tolerance_pct: Number(e.target.value) })} onBlur={commit} /></label>
            <div className="field"><Term t="must-have">Must-have</Term>
              <label className="check" style={{ fontWeight: 400 }}><input type="checkbox" checked={h.must_have} disabled={locked} onChange={(e) => save(h.code, { must_have: e.target.checked })} />
                The answer cannot do without this idea</label></div>
          </div>
          {h.assumptions_json.length > 0 && (
            <div className="tblwrap"><table className="tbl"><thead><tr><th>Named assumption</th><th>Name in formula</th><th className="num">Value</th><th>Unit</th><th className="num">Range</th></tr></thead>
              <tbody>{h.assumptions_json.map((a, i) => (
                <tr key={a.name}><td>{a.label}</td><td className="mono">{a.name}</td>
                  <td className="num">{locked ? a.value : <input className="input sm" type="number" style={{ width: 90 }} defaultValue={a.value}
                    onBlur={(e) => save(h.code, { assumptions_json: h.assumptions_json.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })} aria-label={a.label} />}</td>
                  <td>{a.unit}</td><td className="num">{a.min ?? "—"} to {a.max ?? "—"}</td></tr>))}</tbody></table></div>
          )}
          <div className="card tight" style={{ background: "var(--soft)" }}>
            <div className="row"><b className="small">Where the pass line comes from:</b><span className="pill grey">{SRC_LABEL[h.pass_line_source_type]}</span>
              <span className="mono small">= {withUnit(h.line, h.measure_unit)}</span></div>
            <p className="small" style={{ marginTop: 4 }}>{h.pass_line_source_note}</p>
          </div>
          {benches.length > 0 && <div><b className="small">Benchmark source fetched now, before any client evidence is read</b>
            <div style={{ marginTop: 6 }}>{benches.map((e) => <EvidenceCard key={e.id} e={e} hyps={b.hypotheses} mode="view" readOnly />)}</div></div>}
          {!locked && (
            <div className="row">
              {!removing && <button className="btn sm danger" onClick={() => setRemoving(true)}>Remove this idea</button>}
              {removing && <>
                <input className="input sm" style={{ maxWidth: 420 }} placeholder="Reason (required), for example: would not change the decision" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for removing" />
                <button className="btn sm danger" disabled={!reason.trim()} onClick={() => save(h.code, { removed_reason: reason })}>Remove with this reason</button>
                <button className="btn sm ghost" onClick={() => setRemoving(false)}>Cancel</button></>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
