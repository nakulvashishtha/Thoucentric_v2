import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Hypothesis, Trip } from "../../api/types";
import { EvidenceCard } from "../../components/EvidenceCard";
import { VerdictCard } from "../../components/VerdictCard";
import { EChip, GateBox, Meter, ResultPill, Sim, Term, withUnit } from "../../components/ui";
import { PRINCIPLE, RESULT_LABEL } from "../../copy";
import { JobView, useCtx } from "../CaseView";

function kept(hs: Hypothesis[]) { return hs.filter((h) => !h.removed_reason); }

/* ================================================================ step 8 */
export function Step8() {
  const { b, goStep, openEvidence } = useCtx();
  const hs = kept(b.hypotheses).filter((h) => h.verdict);
  if (!hs.length) return <div className="empty">Results appear here after you run the tests at step 7.</div>;
  const needTrip = hs.filter((h) => h.verdict!.result === "not_enough");
  const optional = hs.filter((h) => h.verdict!.result === "conflicting" || h.verdict!.confidence === "low");
  return (
    <div className="stack">
      <div className="vgrid">
        {hs.map((h) => <VerdictCard key={h.code} h={h} result={h.verdict!.result} confidence={h.verdict!.confidence}
          why={h.verdict!.why} evidenceIds={h.verdict!.evidence_ids} onOpen={openEvidence} />)}
      </div>
      <p className="small muted">Results and confidence come only from the rule engine, using the pass lines locked at step 3. The "why" lines are fixed templates, not model text. Run again on the same evidence and you get the same answer.</p>
      <GateBox signoff={false} title={needTrip.length ? `${needTrip.map((h) => h.code).join(", ")} ${needTrip.length > 1 ? "do" : "does"} not have enough evidence yet. Go back for it at step 9, or move on.` :
        optional.length ? `Optional: ${optional.map((h) => h.code).join(", ")} could go back for more evidence at step 9.` : "Every idea has a result. Move on to add it up."}
        next={{ n: needTrip.length || optional.length ? 9 : 10, go: () => goStep(needTrip.length || optional.length ? 9 : 10) }}>
        {(needTrip.length > 0 || optional.length > 0) && <div><button className="btn" onClick={() => goStep(10)}>Skip to step 10 →</button></div>}
      </GateBox>
    </div>
  );
}

/* ================================================================ step 9 */
export function Step9() {
  const { b, goStep } = useCtx();
  const hs = kept(b.hypotheses).filter((h) => h.verdict);
  const [picked, setPicked] = useState<string[]>([]);
  if (!hs.length) return <div className="empty">Return trips are offered after the tests have run.</div>;
  const offered = hs.filter((h) => h.verdict!.result === "not_enough" || b.trips.some((t) => t.hypothesis_code === h.code) || picked.includes(h.code));
  const optional = hs.filter((h) => !offered.includes(h) && (h.verdict!.result === "conflicting" || h.verdict!.confidence === "low"));
  const reopened = b.progress.reopened;
  return (
    <div className="stack">
      {offered.length === 0 && <div className="empty">No idea is short of evidence. You can still pick a conflicting or low-confidence idea below.</div>}
      {offered.map((h) => <TripCard key={h.code} h={h} trips={b.trips.filter((t) => t.hypothesis_code === h.code)} />)}
      {optional.length > 0 && (
        <section className="card">
          <h2>Optional: send another idea back</h2>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>Conflicting or low-confidence ideas you pick. Trips are bounded: two per idea, a third needs a written reason.</p>
          <div className="row">{optional.map((h) => (
            <button key={h.code} className="btn" onClick={() => setPicked([...picked, h.code])}>{h.code} · {RESULT_LABEL[h.verdict!.result]}, {h.verdict!.confidence}</button>))}</div>
        </section>
      )}
      <GateBox signoff={false} title={reopened.length ? `Finish ${reopened.join(", ")} first: decide its trip evidence and test it again.` : "When the gaps are filled, or you choose not to chase them, add it up."}
        next={reopened.length ? null : { n: 10, go: () => goStep(10) }} />
    </div>
  );
}

function TripCard({ h, trips }: { h: Hypothesis; trips: Trip[] }) {
  const { b, call, send, toast } = useCtx();
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [paste, setPaste] = useState("");
  const last = trips[trips.length - 1];
  const [q, setQ] = useState(last?.question || "");
  useEffect(() => { setQ(last?.question || ""); }, [last?.id, last?.question]);
  const job = last ? b.jobs[`trip_${last.id}`] : undefined;
  const replyJob = last ? b.jobs[`trip_reply_${last.id}`] : undefined;
  const items = b.evidence.filter((e) => last && e.trip_id === last.id);
  const undecided = items.filter((e) => e.status === "needs_decision");
  const free = b.rules.thresholds.trips.free;
  const nextN = trips.length + 1;
  const canStart = !last || (last.retested_at);
  const decide = async (eid: string, action: string, r = "", cf = false) => { await call("POST", `/evidence/${eid}/decision`, { action, reason: r, confirm_formula: cf }); };
  const links = async (eid: string, rows: any[]) => { await call("PUT", `/evidence/${eid}/links`, rows); };
  const mix = last?.sample_mix_json;
  return (
    <section className="card stack-s">
      <div className="row"><span className="vcode">{h.code}</span><h2 style={{ flex: 1 }}>{h.text}</h2>
        <ResultPill result={h.verdict!.result} /><Meter level={h.verdict!.confidence} /></div>
      <div className="row small"><span className="pill grey">Trip {Math.max(1, trips.length)} of {free}</span>
        {trips.length > free && <span className="pill orange">over the limit: {last?.override_reason}</span>}
        <span className="muted">{h.verdict!.why}</span></div>

      {canStart && (
        <div className="card tight col" style={{ background: "var(--soft)" }}>
          {last?.retested_at && <p className="small"><b>Trip {last.n} is complete</b> and {h.code} was tested again.</p>}
          {nextN > free && nextN <= b.rules.thresholds.trips.max_with_override && <>
            <label className="check"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Override: trip {nextN} goes over the limit of {free}</label>
            {override && <input className="input sm" placeholder="Reason (required, logged and shown)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Override reason" />}</>}
          {nextN > b.rules.thresholds.trips.max_with_override ? <p className="small" style={{ color: "var(--fail)", fontWeight: 600 }}>✕ No more trips: at most {b.rules.thresholds.trips.max_with_override} per idea.</p> :
            <div><button className="btn navy" disabled={nextN > free && (!override || !reason.trim())}
              onClick={() => call("POST", "/trips", { hypothesis: h.code, override, override_reason: reason })}>Draft a narrower question (trip {nextN})</button></div>}
        </div>
      )}

      {last && !last.retested_at && (
        <>
          <JobView job={job} label="Drafting a narrower question" />
          {last.question && (
            <div className="grid2">
              <div className="col">
                <label className="field">The narrower question<span className="hint">Written by the language model, checked for private numbers by the rule engine. Edit before sending.</span>
                  <textarea className="input" value={q} disabled={!!last.marked_sent_at} onChange={(e) => setQ(e.target.value)}
                    onBlur={() => q !== last.question && call("PUT", `/trips/${last.id}`, { question: q })} /></label>
                <div className="row">
                  <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(`${q}\n\n${last.what_we_have}`); toast("Question copied"); }}>Copy</button>
                </div>
              </div>
              <div className="col"><b className="small">What we already have</b><p className="prebox">{last.what_we_have}</p></div>
            </div>
          )}
          {last.question && !last.marked_sent_at && (
            <div className="gatebox yes" style={{ marginTop: 0 }}>
              <h4>Consultant sign-off</h4>
              <div className="row"><button className="btn primary" onClick={() => call("POST", `/trips/${last.id}/sent`)}>Mark as sent</button>
                <span className="small muted">The app sends nothing; this records that you sent it.</span></div>
            </div>
          )}
          {last.marked_sent_at && !last.reply_file_id && (
            <div className="card tight col">
              <b>The reply: upload a file or paste it</b>
              <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("file", f); send(`/trips/${last.id}/reply`, fd); }} aria-label="Upload the reply" />
              <textarea className="input" placeholder="Or paste the reply here" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Paste the reply" />
              <div className="row"><button className="btn sm navy" disabled={!paste.trim()} onClick={() => { const fd = new FormData(); fd.append("text", paste); send(`/trips/${last.id}/reply`, fd); }}>Add the pasted reply</button>
                {b.case.sample && <SampleReply tripId={last.id} idea={h.code} />}</div>
            </div>
          )}
          <JobView job={replyJob} label="Reading the reply" />
          {mix && Object.keys(mix).length > 0 && (
            <div className={`card tight ${mix.not_applicable ? "" : ""}`}>
              <div className="row"><b>Sample-mix check</b>
                {mix.not_applicable ? <span className="pill grey">Marked not applicable</span> : mix.passes ? <span className="pill pass">✓ The reply's sample matches the target mix</span> : <span className="pill warn">! The mix differs by more than {mix.threshold} points</span>}</div>
              {!mix.not_applicable && <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>Dimension</th><th className="num">Sample</th><th className="num">Target</th><th className="num">Difference</th></tr></thead>
                <tbody>{mix.rows.map((r: any) => <tr key={r.dimension}><td>{r.dimension}</td><td className="num">{r.sample}%</td><td className="num">{r.target}%</td><td className="num">{r.difference} pts {r.flag ? "!" : "✓"}</td></tr>)}</tbody></table></div>}
              {mix.target_note && <p className="small muted" style={{ marginTop: 4 }}>Target: {mix.target_note}</p>}
            </div>
          )}
          {last.reply_file_id && (!mix || !Object.keys(mix).length) && replyJob?.status === "done" && <SampleMixForm tripId={last.id} />}
          {items.length > 0 && (
            <div>
              <b>Evidence from this trip (always decided by you; only {h.code}'s links are open)</b>
              <div style={{ marginTop: 6 }}>{items.map((e) => <EvidenceCard key={e.id} e={e} hyps={b.hypotheses} mode={e.status === "needs_decision" ? "decide" : "view"} onDecide={decide} onLinks={links} defaultOpen={e.status === "needs_decision"} />)}</div>
            </div>
          )}
          {items.length > 0 && (
            <div className="row"><button className="btn primary" disabled={undecided.length > 0 || !mix || !Object.keys(mix).length}
              onClick={() => call("POST", "/test/run", { hypothesis: h.code })}>Test {h.code} again</button>
              {undecided.length > 0 && <span className="gate-reason">Decide the trip evidence first</span>}
              {!undecided.length && (!mix || !Object.keys(mix).length) && <span className="gate-reason">Record the sample-mix check first</span>}</div>
          )}
        </>
      )}
    </section>
  );
}

function SampleReply({ tripId, idea }: { tripId: number; idea: string }) {
  const { b, send } = useCtx();
  const reply = b.sample_replies?.[idea] || null;
  if (!reply) return null;
  return <button className="btn sm" title="Sample data (simulated)" onClick={async () => {
    const r = await fetch(`/api/samples/${b.case.sample}/replies/${reply}`);
    if (!r.ok) return;
    const fd = new FormData(); fd.append("file", new File([await r.blob()], reply)); send(`/trips/${tripId}/reply`, fd);
  }}>Use the sample's reply ({reply})</button>;
}

function SampleMixForm({ tripId }: { tripId: number }) {
  const { call } = useCtx();
  const [rows, setRows] = useState([{ dim: "", sample: "", target: "" }]);
  const set = (i: number, k: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const valid = rows.filter((r) => r.dim && r.sample !== "" && r.target !== "");
  return (
    <div className="card tight col">
      <b>Sample-mix check</b><span className="small muted">If the reply rests on a sample, pilot or subset, compare its makeup with the target population on the dimensions you name.</span>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input className="input sm" style={{ width: 200 }} placeholder="Dimension" value={r.dim} onChange={(e) => set(i, "dim", e.target.value)} aria-label="Dimension" />
          <input className="input sm" style={{ width: 110 }} placeholder="Sample %" value={r.sample} onChange={(e) => set(i, "sample", e.target.value)} aria-label="Sample percent" />
          <input className="input sm" style={{ width: 110 }} placeholder="Target %" value={r.target} onChange={(e) => set(i, "target", e.target.value)} aria-label="Target percent" />
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setRows([...rows, { dim: "", sample: "", target: "" }])}>Add a dimension</button>
        <button className="btn sm navy" disabled={!valid.length} onClick={() => call("POST", `/trips/${tripId}/sample-mix`, {
          sample: Object.fromEntries(valid.map((r) => [r.dim, Number(r.sample)])), target: Object.fromEntries(valid.map((r) => [r.dim, Number(r.target)])) })}>Check the mix</button>
        <button className="btn sm" onClick={() => call("POST", `/trips/${tripId}/sample-mix`, { not_applicable: true })}>Not applicable</button>
      </div>
    </div>
  );
}

/* ================================================================ step 10 */
export function Step10() {
  const { b, call, goStep, openEvidence } = useCtx();
  const job = b.jobs["addup"];
  const ov = b.overall;
  const ran = useRef(false);
  const fresh = ov && !ov.stale && b.summary;
  useEffect(() => {
    if (!fresh && !ran.current && (!job || job.status === "done") && b.progress.done["8"] && !b.progress.reopened.length) {
      ran.current = true;
      call("POST", "/addup/run");
    }
  }, [fresh]);
  const rejected = b.evidence.filter((e) => e.status === "rejected");
  return (
    <div className="stack">
      <JobView job={job} label="Adding it up" onRetry={() => call("POST", "/addup/run")} />
      {ov && (
        <div className={`overall ${ov.result}`}>
          <span className={`pill xl ${ov.result === "not_achievable" ? "fail" : ov.result === "achievable" ? "pass" : "warn"}`}>
            {ov.result === "not_achievable" ? "✕" : ov.result === "achievable" ? "✓" : "!"} {ov.label}</span>
          <div style={{ flex: 1 }}><div className="small muted">The locked adding-up rule says:</div><div>{ov.rule_applied}</div></div>
          {ov.stale && <button className="btn primary" onClick={() => call("POST", "/addup/run")}>Add it up again</button>}
        </div>
      )}
      {b.summary && (
        <section className="card">
          <div className="card-head"><h2>Summary</h2>
            {b.summary.source === "llm" ? <span className="pill model">Written by the language model · every line checked by the rule engine</span> : <span className="pill rule">Template summary built in code</span>}</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {b.summary.sentences.map((s: any, i: number) => (
              <li key={i} style={{ marginBottom: 8 }}>{s.text} <span className="row" style={{ display: "inline-flex", gap: 4 }}>{s.evidence_ids.map((id: string) => <EChip key={id} id={id} onOpen={openEvidence} />)}</span></li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 8 }}>Checked: every cited id exists, every number is in the engine's data, and no sentence contradicts a verdict.</p>
        </section>
      )}
      <section className="card">
        <div className="card-head"><h2>Rejected evidence</h2><span className="countbadge">{rejected.length}</span><span className="help">Kept on show with the reason.</span></div>
        {rejected.length === 0 && <p className="muted small">Nothing was rejected.</p>}
        {rejected.map((e) => <div key={e.id} className="row small" style={{ marginBottom: 6 }}><EChip id={e.id} onOpen={openEvidence} /><span>{e.claim} · {e.title}</span><span className="pill fail">✕ {e.decision_reason}</span></div>)}
      </section>
      <GateBox signoff={false} title="The rule engine applies the rule locked at step 3. Nothing to sign here." next={fresh ? { n: 11, go: () => goStep(11) } : null} />
    </div>
  );
}

/* ================================================================ step 11 */
export function Step11() {
  const { b, cid, goStep, openEvidence } = useCtx();
  const base = useMemo(() => Object.fromEntries(b.sliders.map((s) => [`${s.kind}:${s.key}`, s.value])), [b.sliders]);
  const [vals, setVals] = useState<Record<string, number>>(base);
  const [touchedLines, setTouchedLines] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => { setVals(base); setTouchedLines(new Set()); }, [base]);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const assumptions: Record<string, number> = {};
      const pass_lines: Record<string, number> = {};
      b.sliders.forEach((s) => {
        const v = vals[`${s.kind}:${s.key}`];
        if (s.kind === "assumption") assumptions[s.key] = v;
        else if (touchedLines.has(s.key)) pass_lines[s.key] = v;
      });
      try { setRes(await api("POST", `/cases/${cid}/whatif`, { assumptions, pass_lines })); setErr(null); }
      catch (e) { setErr((e as Error).message); }
    }, 150);
  }, [vals, touchedLines]);
  if (!b.sliders.length) return <div className="empty">The stress-test opens after the tests have run.</div>;
  const hs = kept(b.hypotheses);
  const counted = new Set(hs.flatMap((h) => h.verdict?.evidence_ids || []));
  const evs = b.evidence.filter((e) => counted.has(e.id));
  const checked = new Set(evs.filter((e) => e.decided_by === "consultant" || e.seen_by_consultant).map((e) => e.id));
  const changed = res && JSON.stringify(vals) !== JSON.stringify(base);
  // a formula-based pass line follows its assumptions unless you move it directly
  const shownLine = (code: string) => res?.ideas.find((x: any) => x.code === code)?.line;
  return (
    <div className="stack">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.85fr) minmax(0,1.6fr)", gap: 16, alignItems: "start" }}>
        <section className="card stack-s">
          <h2>What the answer rests on</h2>
          <p className="small muted">The counted evidence behind each result. ✓ = checked by you.</p>
          {hs.map((h) => (
            <div key={h.code} className="row small"><span className="vcode">{h.code}</span>
              {(h.verdict?.evidence_ids || []).length ? h.verdict!.evidence_ids.map((id) => <EChip key={id} id={id} onOpen={openEvidence} checked={checked.has(id)} />) : <span className="muted">no counted evidence</span>}</div>
          ))}
          <div className="divider" />
          <h2>Still unknown</h2>
          {(b.summary?.unknowns || []).length === 0 && <p className="muted small">Nothing listed.</p>}
          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{(b.summary?.unknowns || []).map((u: any, i: number) => <li key={i} style={{ marginBottom: 4 }}><b className="mono">{u.idea}</b> {u.text}</li>)}</ul>
        </section>
        <section className="stack-s">
          <div className="row"><h2>Move the inputs</h2><span className="pill lock">🔒 Locked plan unchanged</span><span className="spacer" />
            <button className="btn" onClick={() => { setVals(base); setTouchedLines(new Set()); }} disabled={!changed}>Reset</button></div>
          {err && <p className="small" style={{ color: "var(--fail)" }}>{err}</p>}
          <div className="grid2">
            {b.sliders.map((s) => {
              const k = `${s.kind}:${s.key}`;
              const v = s.kind === "pass_line" && !touchedLines.has(s.key) && shownLine(s.key) !== undefined ? shownLine(s.key) : vals[k];
              const range = s.max - s.min;
              const step = range >= 5 ? 1 : range >= 0.5 ? 0.1 : 0.01;
              const delta = v - s.value;
              return (
                <div key={k} className="slider">
                  <div className="slider-top"><b className="small">{s.label}</b><span className="val">{withUnit(v, s.unit)}</span></div>
                  <input type="range" min={s.min} max={s.max} step={step} value={v} aria-label={s.label}
                    onChange={(e) => { setVals({ ...vals, [k]: Number(e.target.value) }); if (s.kind === "pass_line") setTouchedLines(new Set([...touchedLines, s.key])); }} />
                  <div className="slider-scale"><span>{withUnit(s.min, s.unit)}</span><span>{withUnit(s.max, s.unit)}</span></div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="delta">{Math.abs(delta) > 1e-9 ? `${delta > 0 ? "+" : ""}${Number(delta.toFixed(2))} from the locked value` : <span className="muted">at the locked value</span>}</span>
                    {s.formula && <span className="small muted mono">{s.formula}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {res && (
            <>
              <div className={`overall ${res.overall}`}>
                <span className={`pill ${res.overall === "not_achievable" ? "fail" : res.overall === "achievable" ? "pass" : "warn"}`}>{res.overall_label}</span>
                <span className="small" style={{ flex: 1 }}>{res.rule_applied}</span>
                {res.overall_changed && <span className="pill orange">would change</span>}
              </div>
              <div className="vgrid">
                {res.ideas.map((x: any) => {
                  const h = hs.find((y) => y.code === x.code)!;
                  return <VerdictCard key={x.code} h={h} result={x.result} confidence={x.confidence} why={x.why} evidenceIds={x.evidence_ids} line={x.line} changed={x.changed} onOpen={openEvidence} checkedIds={checked} />;
                })}
              </div>
            </>
          )}
        </section>
      </div>
      <GateBox signoff={false} title="These are options for you to weigh. Nothing here is saved, and the locked plan does not change." next={{ n: 12, go: () => goStep(12) }} />
    </div>
  );
}

/* ================================================================ step 12 */
export function Step12() {
  const { b, cid, call, readOnly, toast } = useCtx();
  const saved = b.conclusion?.text || "";
  const [text, setText] = useState(saved);
  useEffect(() => { setText(b.conclusion?.text || ""); }, [b.conclusion?.saved_at]);
  const c = b.case;
  const hs = kept(b.hypotheses);
  const k = b.counts;
  const gaps = b.summary?.unknowns || [];
  const ov = b.overall;
  return (
    <div className="stack">
      <article className="brief" aria-label="Readiness brief">
        <div className="row"><h1 style={{ flex: 1 }}>Readiness brief: {c.title}</h1><span className="mono small muted">{new Date().toLocaleDateString()}</span></div>
        <p className="small muted" style={{ marginTop: 4 }}>{c.client_name} · {c.country} · {c.industry} · {c.function}</p>
        <p style={{ marginTop: 10, fontStyle: "italic" }}>{PRINCIPLE}</p>
        <section><h2>The ask</h2><p>{c.raw_ask}</p></section>
        <section><h2>Results by idea</h2>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Idea</th><th>Pass line</th><th>Result</th><th>Confidence</th><th>Evidence</th></tr></thead>
            <tbody>{hs.map((h) => (
              <tr key={h.code}><td><b className="mono">{h.code}</b> {h.text}{h.must_have && <> <span className="pill lock">must-have</span></>}</td>
                <td className="mono">{h.comparator === ">=" ? "≥" : "≤"} {h.line_text}</td>
                <td>{h.verdict ? <ResultPill result={h.verdict.result} /> : "—"}</td>
                <td>{h.verdict ? <Meter level={h.verdict.confidence} /> : "—"}</td>
                <td className="mono small">{h.verdict?.evidence_ids.join(", ") || "—"}</td></tr>))}
            </tbody></table></div>
          {ov && <p style={{ marginTop: 10 }}><b>Overall: {ov.label}.</b> {ov.rule_applied}</p>}
        </section>
        <section><h2>Open gaps</h2>
          {gaps.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{gaps.map((g: any, i: number) => <li key={i}><b className="mono">{g.idea}</b> {g.text}</li>)}</ul> : <p className="muted">None listed.</p>}
        </section>
        <section><h2>Evidence</h2>
          <p>Collected <b>{k.collected}</b> · unique <b>{k.unique}</b> · auto-approved with sources reviewed <b>{k.auto_approved}</b> · decided by a person <b>{k.decided_by_person}</b> · rejected <b>{k.rejected}</b> (kept on show) · pending <b>{k.pending}</b></p>
          {c.sample && <p style={{ marginTop: 4 }}><Sim /></p>}
        </section>
        <section><h2>Your conclusion</h2>
          <textarea className="input" style={{ minHeight: 160 }} value={text} disabled={readOnly} onChange={(e) => setText(e.target.value)}
            placeholder="Write the conclusion in your own words. The agent never fills this in." aria-label="Your conclusion" />
          <div className="row" style={{ marginTop: 4 }}><span className="counter">{text.length} characters · {text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
            {b.conclusion?.saved_at && <span className="small muted">Saved {new Date(b.conclusion.saved_at).toLocaleString()}</span>}</div>
        </section>
      </article>
      <GateBox signoff title="The conclusion is yours. It stays with you: nothing is sent, and there is no named approver." button="Save conclusion"
        onClick={() => call("PUT", "/conclusion", { text }).then((ok) => ok && toast("Conclusion saved"))}
        disabledReason={!b.progress.done["10"] ? "Add it up at step 10 first" : !text.trim() ? "Write your conclusion first" : text === saved ? "No unsaved changes" : undefined}>
        <div className="row">
          <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
          <a className="btn" href={`/api/cases/${cid}/export?format=md`}>Download Markdown</a>
          <a className="btn" href={`/api/cases/${cid}/export?format=json`}>Download JSON</a>
          <a className="btn ghost" href={`/api/cases/${cid}/export?format=html`} target="_blank" rel="noreferrer">Open print view ↗</a>
        </div>
      </GateBox>
      <p className="small muted"><Term t="fixture mode">Fixture mode</Term> cases are labelled as simulated in every export.</p>
    </div>
  );
}
