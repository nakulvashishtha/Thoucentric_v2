import { useEffect, useRef, useState } from "react";
import { api, upload } from "../api/client";
import type { ActivityRow, Hypothesis } from "../api/types";
import * as T from "../copy";
import { Footer, PageHead, useCtx } from "../state";
import { Details, Dialog, Empty, Icon, Locked, Origin, Progress, Quality, Skeleton, Tip, Toggle, useElapsed, withUnit } from "../components/ui";
import { SourceLine, figureText } from "../components/Evidence";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- step 1: Describe the ask

export function Step1() {
  const { b, cid, act, readOnly, refresh } = useCtx();
  const c = b.case;
  const [f, setF] = useState({
    client_name: c.client_name || "", country: c.country || "", industry: c.industry || "", function: c.function || "",
    raw_ask: c.raw_ask || "", private_numbers: (c.private_numbers || []).join("\n"), client_aliases: (c.client_aliases || []).join("\n"),
  });
  const [over, setOver] = useState(false);
  const [upErr, setUpErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const job = b.jobs.frame;
  const reading = !!job && (job.status === "running" || job.status === "queued");
  const elapsed = useElapsed(job?.started_at, reading);
  const aiReads = (c.settings_json || {}).ai_reads_client_files !== false;
  const files = b.files.filter((x) => x.kind === "initial");
  const locked = readOnly || reading || !!b.progress.done["2"];

  const names: Record<string, string> = { client_name: T.step1.client, country: T.step1.country, industry: T.step1.industry,
    function: T.step1.fn, raw_ask: T.step1.ask };
  const missing = Object.keys(names).filter((k) => !(f as any)[k].trim()).map((k) => (k === "raw_ask" ? T.step1.askShort : names[k].toLowerCase()));

  const save = () => api("PUT", `/cases/${cid}`, {
    client_name: f.client_name, country: f.country, industry: f.industry, function: f.function, raw_ask: f.raw_ask,
    private_numbers: lines(f.private_numbers), client_aliases: lines(f.client_aliases),
    title: c.title === T.home.newCaseTitle || !c.title ? `${f.client_name} · ${f.function}` : c.title,
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setUpErr("");
    for (const file of Array.from(list)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "initial");
      try { await upload(`/cases/${cid}/files`, fd); } catch (e: any) { setUpErr(e?.message || T.errors.upload); }
    }
    await refresh();
  };

  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint ? <span className="hint">{hint}</span> : null}
      <input type="text" value={f[k]} disabled={locked} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  return (
    <>
      <PageHead n={1} />
      <div className="card">
        <div className="grid2">
          {field("client_name", T.step1.client, T.step1.clientHint)}
          {field("country", T.step1.country)}
        </div>
        <div className="grid2" style={{ marginTop: 16 }}>
          {field("industry", T.step1.industry)}
          {field("function", T.step1.fn, T.step1.fnHint)}
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          <span className="field-label">{T.step1.ask}</span>
          <span className="hint">{T.step1.askHint}</span>
          <textarea className="big" value={f.raw_ask} disabled={locked} onChange={(e) => setF({ ...f, raw_ask: e.target.value })} />
        </label>
      </div>
      <div className="card">
        <div className="grid2 top">
          <div>
            <span className="field-label">{T.step1.files}</span>
            <span className="hint">{T.step1.filesDisclosure}</span>
            {!locked ? (
              <div className={`dropzone${over ? " over" : ""}`} role="button" tabIndex={0}
                onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter") input.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
                <Icon name="upload" size={20} /><div className="small">{T.step1.filesHint}</div>
                <input ref={input} type="file" multiple hidden accept=".csv,.xlsx,.txt,.pdf" aria-label={T.step1.files}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>
            ) : null}
            {upErr ? <p className="small" style={{ color: "var(--fail)" }}>{upErr}</p> : null}
            <ul className="filelist">
              {files.map((x) => <li key={x.id}><Icon name="file" />{x.filename}</li>)}
            </ul>
          </div>
          <label className="field">
            <span className="field-label">{T.step1.neverSend}</span>
            <span className="hint">{T.step1.neverSendHint}</span>
            <textarea value={f.private_numbers} disabled={locked} onChange={(e) => setF({ ...f, private_numbers: e.target.value })} />
          </label>
        </div>
      </div>
      <Details>
        <div className="grid2 top">
          <label className="field">
            <span className="field-label">{T.step1.aliases}</span>
            <span className="hint">{T.step1.aliasesHint}</span>
            <textarea value={f.client_aliases} disabled={locked} onChange={(e) => setF({ ...f, client_aliases: e.target.value })} />
          </label>
          <div>
            <span className="field-label">{T.step1.aiReads}</span>
            <span className="hint">{T.step1.aiReadsHint}</span>
            <Toggle label={T.step1.aiReads} value={aiReads} disabled={locked}
              onChange={(v) => act(() => api("PUT", `/cases/${cid}`, { ai_reads_client_files: v }))} />
            {!aiReads ? <TypedFigures /> : null}
          </div>
        </div>
      </Details>
      <Footer
        primary={T.steps[1].primary}
        disabled={missing.length > 0 || reading}
        status={reading ? <span className="grow" style={{ maxWidth: 360 }}><Progress label={T.step1.status.reading} elapsed={elapsed} /></span>
          : missing.length ? T.step1.status.missing(missing) : T.step1.status.ready}
        onPrimary={() => act(async () => { await save(); await api("POST", `/cases/${cid}/read-ask`); })}
      />
    </>
  );
}

function TypedFigures() {
  const { b, cid, act } = useCtx();
  const files = b.files.filter((x) => x.kind === "initial");
  const [rows, setRows] = useState<Record<number, { value: string; unit: string; locator: string }>>({});
  return (
    <div className="stack-sm" style={{ marginTop: 12 }}>
      <p className="label">{T.step1.typedFigures}</p>
      {files.map((x) => {
        const r = rows[x.id] || { value: "", unit: "", locator: "" };
        const set = (k: string, v: string) => setRows({ ...rows, [x.id]: { ...r, [k]: v } });
        return (
          <div key={x.id} className="stack-sm">
            <div className="small"><b>{x.filename}</b>{(x.figures || []).length ? ` · ${x.figures.map(figureText).join(", ")}` : ""}</div>
            <div className="row">
              <input type="number" aria-label={T.step1.figValue} placeholder={T.step1.figValue} value={r.value} onChange={(e) => set("value", e.target.value)} />
              <input type="text" aria-label={T.step1.figUnit} placeholder={T.step1.figUnit} value={r.unit} onChange={(e) => set("unit", e.target.value)} />
              <input type="text" aria-label={T.step1.figWhere} placeholder={T.step1.figWhere} value={r.locator} onChange={(e) => set("locator", e.target.value)} />
              <button type="button" className="btn small" disabled={!r.value || !r.unit} onClick={() => act(() =>
                api("PUT", `/cases/${cid}/files/${x.id}/figures`, { figures: [...(x.figures || []), { value: Number(r.value), unit: r.unit, locator: r.locator }] }))}>
                {T.buttons.saveChanges}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- step 2: Confirm the question

export function Step2() {
  const { b, cid, act, readOnly } = useCtx();
  const fr = b.frame;
  const job = b.jobs.frame;
  const drafting = !fr && !!job && job.status !== "failed";
  const [v, setV] = useState(() => ({
    client_belief: fr?.client_belief || "", decision: fr?.decision || "",
    case_measure_name: fr?.case_measure_name || "", case_measure_definition: fr?.case_measure_definition || "",
  }));
  useEffect(() => {
    if (fr) setV({ client_belief: fr.client_belief, decision: fr.decision, case_measure_name: fr.case_measure_name,
      case_measure_definition: fr.case_measure_definition });
  }, [fr?.client_belief, fr?.decision, fr?.case_measure_name, fr?.case_measure_definition]);  // eslint-disable-line
  if (!fr) {
    return (<><PageHead n={2} /><div className="card">{drafting ? <><Progress label={T.step2.status.drafting} /><Skeleton /></> : <Empty text={T.app.futureStep(T.steps[1].title)} />}</div>
      <Footer status={drafting ? T.step2.status.drafting : ""} primary={T.steps[2].primary} disabled /></>);
  }
  const proposed = fr.proposed || {};
  const tag = (k: string) => <Origin who={(v as any)[k] === proposed[k] ? "llm" : "consultant"} />;
  const save = (k: string) => {
    if ((v as any)[k] !== fr[k]) void act(() => api("PUT", `/cases/${cid}/frame`, { [k]: (v as any)[k] }));
  };
  const empty = !v.client_belief.trim() || !v.decision.trim() || !v.case_measure_name.trim() || !v.case_measure_definition.trim();
  const files = b.files.filter((x) => x.kind === "initial");
  const box = (k: keyof typeof v, big = false) => (
    big ? <textarea rows={4} value={v[k]} disabled={readOnly} onBlur={() => save(k)} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      : <input type="text" value={v[k]} disabled={readOnly} onBlur={() => save(k)} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  return (
    <>
      <PageHead n={2} />
      <div className="grid3">
        <div className="card">
          <div className="spread"><h2>{T.step2.belief}</h2>{tag("client_belief")}</div>
          <span className="hint">{T.step2.beliefHint}</span>
          {box("client_belief", true)}
        </div>
        <div className="card">
          <div className="spread"><h2>{T.step2.decision}</h2>{tag("decision")}</div>
          {box("decision", true)}
        </div>
        <div className="card">
          <div className="spread"><h2>{T.step2.measure}</h2>{tag("case_measure_name")}</div>
          <span className="hint">{T.step2.measureHint}</span>
          <label className="field"><span className="sr-only">{T.step2.measureName}</span>{box("case_measure_name")}</label>
          <label className="field" style={{ marginTop: 8 }}><span className="sr-only">{T.step2.measureDef}</span>{box("case_measure_definition", true)}</label>
        </div>
      </div>
      <div className="section">
        <Details title={T.step2.fromFiles}>
          {files.length === 0 ? <Empty text={T.step2.noFiles} /> : (
            <table className="t">
              <tbody>
                {files.map((x) => (
                  <tr key={x.id}>
                    <td className="nowrap"><Icon name="file" /> {x.filename}</td>
                    <td>{(x.figures || []).map((g, i) => (
                      <span key={i} className="row" style={{ display: "inline-flex", marginRight: 12 }}>
                        <b className="mono">{figureText(g)}</b><span className="muted small">{g.locator}</span>
                        {g.verified === false ? <span className="pill amber"><Icon name="warn" />{T.step2.notFound}</span> : null}
                      </span>))}</td>
                    <td className="small muted nowrap">{T.step2.figuresFound((x.figures || []).length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Details>
      </div>
      <Footer primary={T.steps[2].primary} disabled={empty} status={empty ? T.step2.status.edit : T.step2.status.ready}
        onPrimary={() => act(async () => {
          const changed = Object.keys(v).filter((k) => (v as any)[k] !== fr[k]);
          if (changed.length) await api("PUT", `/cases/${cid}/frame`, Object.fromEntries(changed.map((k) => [k, (v as any)[k]])));
          await api("POST", `/cases/${cid}/frame/confirm`);
        })} />
    </>
  );
}

// ---------------------------------------------------------------- step 3: Set the targets

function dirWord(cmp: string) { return cmp === ">=" ? T.step3.atLeast : T.step3.atMost; }

export function Step3() {
  const { b, cid, act, readOnly } = useCtx();
  const job = b.jobs.plan;
  const drafting = !!job && (job.status === "running" || job.status === "queued");
  const elapsed = useElapsed(job?.started_at, drafting);
  const [openRow, setOpenRow] = useState<string>("");
  const [ticked, setTicked] = useState(false);
  const [removing, setRemoving] = useState<Hypothesis | null>(null);
  const [reason, setReason] = useState("");
  const hs = b.hypotheses;
  const kept = hs.filter((h) => !h.removed_reason);
  const removed = hs.filter((h) => h.removed_reason);
  const locked = readOnly || !!b.progress.done["3"];
  const put = (rows: Record<string, unknown>[]) => act(() => api("PUT", `/cases/${cid}/hypotheses`, rows));

  if (drafting || (!hs.length && job?.status !== "failed")) {
    return (<><PageHead n={3} /><div className="card"><Progress label={T.step3.status.drafting} elapsed={elapsed} /><Skeleton rows={4} /></div>
      <Footer status={T.step3.status.drafting} primary={T.steps[3].primary} disabled /></>);
  }
  return (
    <>
      <PageHead n={3} />
      <div className="card" style={{ padding: "8px 8px 4px" }}>
        <table className="t">
          <thead><tr>
            <th>{T.step3.colIdea}</th><th>{T.step3.colType}</th><th>{T.step3.colMeasure}</th>
            <th>{T.step3.colTarget} <Tip text={T.tips.target} /></th>
            <th>{T.step3.colCritical} <Tip text={T.tips.critical} /></th><th>{T.step3.colSource}</th>
          </tr></thead>
          <tbody>
            {kept.map((h) => (
              <IdeaRow key={h.code} h={h} open={openRow === h.code} locked={locked} onToggle={() => setOpenRow(openRow === h.code ? "" : h.code)}
                put={put} onRemove={() => { setRemoving(h); setReason(""); }} />
            ))}
            {removed.map((h) => (
              <tr key={h.code} className="muted">
                <td colSpan={5}><span className="mono">{h.code}</span> <s>{h.text}</s> · {T.step3.removed(h.removed_reason || "")}</td>
                <td className="right">{!locked ? <button type="button" className="btn small" onClick={() => put([{ code: h.code, removed_reason: null }])}>
                  {T.buttons.restoreIdea}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section"><PlanDetails /></div>
      {!locked ? (
        <label className="tickbox check">
          <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />{T.step3.tick}
        </label>
      ) : <p className="section"><Locked /></p>}
      <Footer primary={T.steps[3].primary} disabled={!ticked} confirm={T.step3.confirmLock}
        status={ticked ? "" : T.step3.status.tick}
        onPrimary={() => act(() => api("POST", `/cases/${cid}/plan/lock`, { ticked: true }))} />
      {removing ? (
        <Dialog text={T.step3.removeReason} confirmLabel={T.buttons.removeIdea} onCancel={() => setRemoving(null)}
          onConfirm={() => { if (!reason.trim()) return; const h = removing; setRemoving(null); void put([{ code: h.code, removed_reason: reason.trim() }]); }}>
          <label className="field" style={{ marginBottom: 16 }}>
            <span className="hint">{T.step3.removeReasonHint}</span>
            <input type="text" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} aria-label={T.step3.removeReason} />
          </label>
        </Dialog>
      ) : null}
    </>
  );
}

function IdeaRow({ h, open, locked, onToggle, put, onRemove }: { h: Hypothesis; open: boolean; locked: boolean; onToggle: () => void;
  put: (rows: Record<string, unknown>[]) => Promise<unknown>; onRemove: () => void }) {
  const { b } = useCtx();
  const [d, setD] = useState({ text: h.text, measure_name: h.measure_name, measure_unit: h.measure_unit,
    pass_line_value: h.pass_line_value == null ? "" : String(h.pass_line_value), pass_line_source_note: h.pass_line_source_note });
  const bench = b.evidence.filter((e) => h.benchmarks.includes(e.id));
  const blur = (k: keyof typeof d) => {
    const val = k === "pass_line_value" ? (d[k] === "" ? null : Number(d[k])) : d[k];
    if (val !== (h as any)[k]) void put([{ code: h.code, [k]: val }]);
  };
  const inp = (k: keyof typeof d, label: string, type = "text") => (
    <label className="field"><span className="field-label">{label}</span>
      <input type={type} value={d[k]} disabled={locked} onChange={(e) => setD({ ...d, [k]: e.target.value })} onBlur={() => blur(k)} /></label>
  );
  return (
    <>
      <tr className={`clickable${open ? " expanded" : ""}`} onClick={onToggle}>
        <td><span className="mono muted">{h.code}</span> {h.text}</td>
        <td className="nowrap">{h.fact_type === "market" ? T.step3.typeMarket : T.step3.typeClient}</td>
        <td>{h.measure_name} <span className="muted">({h.measure_unit})</span></td>
        <td className="nowrap"><b>{dirWord(h.comparator)} {h.line_text}</b></td>
        <td onClick={(e) => e.stopPropagation()}>
          <label className="check"><input type="checkbox" checked={h.must_have} disabled={locked} aria-label={T.step3.colCritical}
            onChange={(e) => put([{ code: h.code, must_have: e.target.checked }])} /></label>
        </td>
        <td className="nowrap"><span className="pill grey">{T.step3.sources[h.pass_line_source_type]}</span> {locked ? null : <Origin who="llm" />}</td>
      </tr>
      {open ? (
        <tr className="sub"><td colSpan={6}>
          <div className="grid2 top">
            <div className="stack-sm">
              {inp("text", T.step3.ideaText)}
              <div className="grid2">{inp("measure_name", T.step3.measureName)}{inp("measure_unit", T.step3.unit)}</div>
              <div className="grid2">
                <label className="field"><span className="field-label">{T.step3.direction}</span>
                  <select value={h.comparator} disabled={locked} onChange={(e) => put([{ code: h.code, comparator: e.target.value }])}>
                    <option value=">=">{T.step3.atLeast}</option><option value="<=">{T.step3.atMost}</option>
                  </select></label>
                {h.pass_line_formula ? (
                  <div className="field"><span className="field-label">{T.step3.target}</span>
                    <div className="formula">{withUnit(h.line, h.measure_unit)}</div></div>
                ) : inp("pass_line_value", T.step3.target, "number")}
              </div>
              <label className="field"><span className="field-label">{T.step3.sourceType}</span>
                <select value={h.pass_line_source_type} disabled={locked} onChange={(e) => put([{ code: h.code, pass_line_source_type: e.target.value }])}>
                  {Object.entries(T.step3.sources).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              {inp("pass_line_source_note", T.step3.sourceNote)}
            </div>
            <div className="stack-sm">
              <span className="field-label">{T.step3.benchmarkSource}</span>
              {bench.length === 0 ? <p className="small muted">{h.pass_line_source_type === "benchmark" ? T.step3.noBenchmark : h.pass_line_source_note}</p> :
                bench.map((e) => (
                  <div key={e.id} className="card tight">
                    <div className="row wrap"><b>{e.claim}</b></div>
                    <div className="small"><SourceLine e={e} /></div>
                    <div className="row small"><span className="muted">{T.step3.quality}:</span><Quality tier={e.tier} />
                      <span className="muted">· {T.step3.date}:</span> {e.date || T.evidence.undated}</div>
                  </div>
                ))}
              {!locked ? <div><button type="button" className="btn small danger" onClick={onRemove}>{T.buttons.removeIdea}</button></div> : null}
            </div>
          </div>
        </td></tr>
      ) : null}
    </>
  );
}

function PlanDetails() {
  const { b, cid, act } = useCtx();
  const locked = !!b.progress.done["3"];
  const [acts, setActs] = useState<ActivityRow[]>([]);
  useEffect(() => { api<ActivityRow[]>("GET", `/cases/${cid}/activity`).then(setActs).catch(() => setActs([])); }, [cid, b.jobs.plan?.status]);
  const r = b.rules.thresholds;
  const searches = acts.filter((a) => a.step === 3 && (a.event_type === "query_checked" || a.event_type === "query_blocked"));
  const kept = b.hypotheses.filter((h) => !h.removed_reason);
  const put = (rows: Record<string, unknown>[]) => act(() => api("PUT", `/cases/${cid}/hypotheses`, rows));
  return (
    <Details>
      <div className="stack">
        <div>
          <p className="label">{T.step3.formula} · {T.step3.assumptions}</p>
          {kept.filter((h) => h.pass_line_formula).map((h) => (
            <div key={h.code} className="stack-sm">
              <div className="row"><span className="mono">{h.code}</span><span className="formula">{h.pass_line_formula} = {withUnit(h.line, h.measure_unit)}</span></div>
              {h.assumptions_json.map((a, i) => (
                <div key={a.name} className="row small">
                  <span className="grow">{a.label} <span className="muted mono">({a.name})</span></span>
                  <input type="number" style={{ maxWidth: 120 }} value={a.value} disabled={locked} aria-label={a.label}
                    onChange={(e) => put([{ code: h.code, assumptions_json: h.assumptions_json.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) }])} />
                  <span className="muted">{a.unit}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div>
          <p className="label">{T.step3.margin} <Tip text={T.tips.closeCall} /></p>
          <div className="row wrap">
            {kept.map((h) => (
              <label key={h.code} className="row small"><span className="mono">{h.code}</span>
                <input type="number" style={{ width: 80 }} value={h.tolerance_pct} disabled={locked} aria-label={`${T.step3.margin} ${h.code}`}
                  onChange={(e) => put([{ code: h.code, tolerance_pct: Number(e.target.value) }])} />%</label>
            ))}
          </div>
        </div>
        <div>
          <p className="label">{T.step3.howDecided}</p>
          <p className="small" style={{ margin: 0 }}>{b.rules.adding_up_rule}</p>
        </div>
        <div>
          <p className="label">{T.step3.qualityCheck}</p>
          <p className="small muted" style={{ marginTop: 0 }}>{T.step3.qualityCheckHint}</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{T.step3.rules.minSources(r.minimum_sources.market, r.minimum_sources.client_operational)}</li>
            <li>{T.step3.rules.recency(r.recency_months.size_growth_price, r.recency_months.structural_timing)}</li>
            <li>{T.step3.rules.spot(Math.round(r.spot_check.fraction * 100), r.spot_check.minimum)}</li>
            <li>{T.step3.rules.trips(r.trips.free, r.trips.max_with_override)}</li>
          </ul>
        </div>
        <div>
          <p className="label">{T.step3.searches}</p>
          {searches.length === 0 ? <p className="small muted">{T.step3.noBenchmark}</p> : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {searches.map((a) => <li key={a.id}>{(a as any).payload_json?.query ? <span className="mono">{(a as any).payload_json.query}</span> : a.message}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Details>
  );
}

