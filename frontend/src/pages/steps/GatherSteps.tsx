import { useState } from "react";
import type { Evidence } from "../../api/types";
import { EvidenceCard } from "../../components/EvidenceCard";
import { Collapse, EChip, Elapsed, GateBox, Progress, StatusPill, Term, TierBadge } from "../../components/ui";
import { ORIGIN_LABEL } from "../../copy";
import { JobView, useCtx } from "../CaseView";

const ROUTE_LABEL: Record<string, string> = { desk: "Desk research", client: "Client request", expert: "Expert questions" };

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((p, i) => (terms.some((t) => t.toLowerCase() === p.toLowerCase()) ? <span key={i} className="removed-term">{p}</span> : p))}</>;
}

/* ================================================================ step 4 */
export function Step4() {
  const { b, call, readOnly, goStep, confirm, toast } = useCtx();
  const done = b.progress.done["4"];
  const locked = readOnly || done;
  const [tick, setTick] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ns, setNs] = useState({ source_name: "", domain: "", origin_type: "open_web", stated_tier: 3, reason: "" });
  const routeJob = b.jobs["route"];
  const routing = routeJob && ["queued", "running"].includes(routeJob.status);
  const files = Object.fromEntries(b.files.map((f) => [f.id, f.filename]));
  const req = b.case.settings_json?.requests;
  const ready = !!b.case.settings_json?.route_done;
  if (!b.needs.length) return <div className="stack"><JobView job={routeJob} label="Planning the evidence" onRetry={() => call("POST", "/needs/retry")} />
    {!routeJob && <div className="empty">The evidence plan appears after you lock the plan at step 3.</div>}</div>;
  const tiers = [1, 2, 3, 4, null];
  const toggle = async (p: any) => {
    let reason = "";
    if (p.included) {
      reason = window.prompt(`Why remove "${p.source_name}" from the plan? Unticked sources are never searched.`) || "";
      if (!reason.trim()) return;
    }
    call("PUT", "/source-plan", [{ id: p.id, included: !p.included, removed_reason: reason }]);
  };
  const desk = b.needs.filter((n) => n.route === "desk");

  return (
    <div className="stack">
      <JobView job={routeJob} label="Planning the evidence" onRetry={() => call("POST", "/needs/retry")} />
      <section className="card">
        <div className="card-head"><h2>a. Where each answer lives</h2><span className="help">Client files already received are checked first. Only gaps are requested.</span></div>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Need</th><th>Idea</th><th style={{ width: "42%" }}>What we need</th><th>Route</th><th style={{ width: "34%" }}>Coverage by files already received</th></tr></thead>
          <tbody>{b.needs.map((n) => (
            <tr key={n.id}>
              <td className="mono">{n.ref}</td><td className="mono">{n.hypothesis_code}</td><td>{n.text}</td>
              <td><span className={`pill ${n.route === "client" ? "client" : n.route === "expert" ? "grey" : "rule"}`}>{ROUTE_LABEL[n.route]}</span></td>
              <td>{n.coverage === "answered_by_client_file" && <span className="pill pass">✓ Answered by client file ({files[n.covered_by_file_id!]}, {n.covered_locator})</span>}
                {n.coverage === "partly" && <><span className="pill warn">! Partly answered ({files[n.covered_by_file_id!]}, {n.covered_locator})</span><div className="small muted" style={{ marginTop: 4 }}>Missing: {n.coverage_note}</div></>}
                {n.coverage === "not_covered" && <><span className="pill grey">Not covered</span>{n.coverage_note && <div className="small muted">{n.coverage_note}</div>}</>}
              </td>
            </tr>))}
          </tbody></table></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>b. Source plan</h2><span className="help">Grouped by credibility <Term t="tier">tier</Term>. Unticked sources are never searched.</span>
          <span className="spacer" />{!locked && <button className="btn sm" onClick={() => setAdding(!adding)}>Add a source</button>}</div>
        {adding && (
          <div className="card tight row" style={{ marginBottom: 12 }}>
            <input className="input sm" style={{ width: 200 }} placeholder="Source name" value={ns.source_name} onChange={(e) => setNs({ ...ns, source_name: e.target.value })} aria-label="Source name" />
            <input className="input sm" style={{ width: 170 }} placeholder="Domain, e.g. example.org" value={ns.domain} onChange={(e) => setNs({ ...ns, domain: e.target.value })} aria-label="Domain" />
            <select className="input sm" style={{ width: 120 }} value={ns.stated_tier} onChange={(e) => setNs({ ...ns, stated_tier: Number(e.target.value) })} aria-label="Stated tier">
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}</select>
            <input className="input sm" style={{ width: 260 }} placeholder="Reason for this tier (required)" value={ns.reason} onChange={(e) => setNs({ ...ns, reason: e.target.value })} aria-label="Reason" />
            <button className="btn sm navy" disabled={!ns.source_name || !ns.reason.trim()} onClick={async () => { if (await call("PUT", "/source-plan", [{ ...ns, included: true }])) setAdding(false); }}>Add</button>
          </div>
        )}
        <div className="grid2">
          {tiers.map((t) => {
            const items = b.plan.filter((p) => p.tier === t);
            if (!items.length) return null;
            return (
              <div key={String(t)} className="card tight">
                <div className="row" style={{ marginBottom: 6 }}>{t ? <TierBadge tier={t} /> : <span className="tier t3">Graded per result</span>}<span className="countbadge">{items.length}</span></div>
                {items.map((p) => (
                  <label key={p.id} className="check" style={{ marginBottom: 6 }}>
                    <input type="checkbox" checked={p.included} disabled={locked} onChange={() => toggle(p)} />
                    <span><b>{p.source_name}</b>{p.domain && <span className="mono small muted"> {p.domain}</span>}
                      <span className="small muted"> · {ORIGIN_LABEL[p.origin_type]}</span>
                      {p.stated_by_consultant && <span className="small" style={{ color: "var(--c-consultant)" }}> · tier stated by the consultant</span>}
                      {!p.included && p.removed_reason && <div className="small" style={{ color: "var(--fail)" }}>Not searched: {p.removed_reason}</div>}
                      <div className="small muted">{p.tier_reason}</div></span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card stack-s">
        <div className="card-head"><h2>c. What leaves the firm</h2><span className="help">Each outbound query, original beside sanitised. Removed terms are struck through.</span></div>
        {desk.map((n) => n.queries_json.map((q, i) => (
          <div key={`${n.id}-${i}`} className="cmp">
            <div><div className="lab">{n.ref} · original need</div><Highlighted text={q.original} terms={q.removed} /></div>
            <div><div className="lab">Sanitised by the rule engine</div>{q.sanitised}</div>
            <div><div className="lab">Outbound search query</div><span className="mono">{q.query}</span>
              <div style={{ marginTop: 4 }}>{q.blocked.length ? <span className="pill fail">✕ Blocked: {q.blocked.join(", ")}</span> : <span className="pill pass">✓ Nothing private</span>}</div></div>
          </div>)))}
        {req && (
          <div className="grid2">
            <div className="card tight">
              <div className="row" style={{ marginBottom: 6 }}><b>Client request</b><span className="pill client">asks only for {req.client_gaps} gap{req.client_gaps === 1 ? "" : "s"}</span><span className="spacer" />
                <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(req.client); toast("Client request copied"); }}>Copy</button>
                <button className="btn sm" onClick={() => download("client_request.txt", req.client)}>Download</button></div>
              <pre className="prebox">{req.client}</pre>
            </div>
            <div className="card tight">
              <div className="row" style={{ marginBottom: 6 }}><b>Expert questions</b>
                {req.expert_blocked?.length ? <span className="pill fail">✕ Blocked</span> : <span className="pill pass">✓ No client name or private numbers</span>}<span className="spacer" />
                <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(req.expert); toast("Expert questions copied"); }}>Copy</button>
                <button className="btn sm" onClick={() => download("expert_questions.txt", req.expert)}>Download</button></div>
              <pre className="prebox">{req.expert}</pre>
              {req.expert_removed?.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Removed before sending: {req.expert_removed.join(", ")}</p>}
            </div>
          </div>
        )}
        <p className="small muted">The app sends nothing. Copy or download these and send them yourself.</p>
      </section>

      <GateBox signoff title="The app sends nothing. Marking as sent records your click, then desk research starts." readOnly={locked}
        button="Mark requests as sent" busy={routing}
        onClick={async () => {
          if (await confirm("Mark requests as sent?", "Collection will start. You can't edit these requests afterwards.", "Mark as sent"))
            await call("POST", "/requests/mark-sent", { reviewed: tick });
        }}
        disabledReason={!ready ? "Wait for the evidence plan to finish" : !tick ? "Tick the review box first" : undefined}
        done={done} doneText="Requests marked as sent. Collection has started." next={done ? { n: 5, go: () => goStep(5) } : null}>
        {!locked && <label className="check"><input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
          I have reviewed the coverage, the source plan and what leaves the firm</label>}
      </GateBox>
    </div>
  );
}

/* ================================================================ step 5 */
export function Step5() {
  const { b, call, send, goStep, readOnly } = useCtx();
  const job = b.jobs["collect"];
  const p = job?.progress || {};
  const groups = p.groups || {};
  const running = job && ["queued", "running"].includes(job.status);
  const pending = b.evidence.filter((e) => e.status === "pending");
  const bench = b.evidence.filter((e) => e.status === "pass_line_source");
  const [kind, setKind] = useState("expert_note");
  const [text, setText] = useState("");
  const collected = b.evidence.filter((e) => e.bucket !== "reference" && e.bucket !== "pending" && !e.trip_id);
  return (
    <div className="stack">
      <section className="card stack-s">
        <div className="row"><h2>Collecting from every source at once</h2><span className="spacer" />
          {job && <span className="muted small">Elapsed <Elapsed since={job.started_at} until={job.finished_at} /></span>}
          {running && <button className="btn danger" onClick={() => call("POST", "/collect/stop")}>Stop collecting</button>}</div>
        {!job && <div className="empty">No evidence yet. Collection starts after you mark the requests as sent at step 4.</div>}
        {Object.entries(groups).map(([k, g]: [string, any]) => (
          <div key={k} className="row" style={{ alignItems: "center" }}>
            <div style={{ width: 230 }}><b>{g.label}</b></div>
            <div style={{ flex: 1 }}><Progress label={g.state === "not in plan" ? "Not in the source plan" : g.state === "waiting" ? "Waiting" : g.state === "done" ? "Done:" : g.state === "stopped" ? "Stopped at" : "Collecting"} done={g.done} total={g.total || undefined} /></div>
            <span className="mono" style={{ width: 70, textAlign: "right" }}>{g.done}</span>
          </div>
        ))}
        {job?.status === "done" && <p className="small"><b>{collected.length}</b> items collected. {b.case.settings_json?.collect_stopped ? "Stopped by you; moving on with what arrived." : "Cleaning starts automatically."}</p>}
        {job?.status === "failed" && <JobView job={job} label="Collecting" onRetry={() => call("POST", "/collect/start")} />}
      </section>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>Pending</h2><span className="countbadge">{pending.length}</span><span className="help">Missing items stay visible.</span></div>
          {pending.length === 0 && <p className="muted small">{job?.status === "done" ? "Nothing pending." : "Anything that hasn't arrived will be listed here."}</p>}
          {pending.map((e) => <div key={e.id} className="row small" style={{ marginBottom: 6 }}><span className="pill dashed">⏳ Pending</span><span className="mono">{e.id}</span>{e.title}</div>)}
        </section>
        <section className="card">
          <div className="card-head"><h2>Pass-line benchmarks</h2><span className="help">Already fetched and locked at step 3.</span></div>
          {bench.map((e) => <div key={e.id} className="row small" style={{ marginBottom: 6 }}><EChip id={e.id} /><span>{e.claim}</span><TierBadge tier={e.tier} /><span className="mono muted">{e.date}</span></div>)}
        </section>
      </div>
      {!readOnly && !b.progress.done["5"] && job && (
        <section className="card stack-s">
          <h2>A reply came in? Upload or paste it</h2>
          <div className="row"><select className="input sm" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Reply from">
            <option value="expert_note">Expert note</option><option value="followup">Client reply</option></select>
            <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); send("/files", fd); }} aria-label="Upload a reply" /></div>
          <textarea className="input" placeholder="Or paste a note here" value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste a reply" />
          <div><button className="btn sm navy" disabled={!text.trim()} onClick={async () => { const fd = new FormData(); fd.append("text", text); fd.append("kind", kind); if (await send("/files", fd)) setText(""); }}>Add the pasted note</button></div>
        </section>
      )}
      <GateBox signoff={false} title="The agent moves on by itself when collection finishes, or when you stop it."
        next={b.progress.done["5"] ? { n: 6, go: () => goStep(6) } : null} />
    </div>
  );
}

/* ================================================================ step 6 */
export function Step6() {
  const { b, call, goStep, openEvidence } = useCtx();
  const job = b.jobs["clean"];
  const k = b.counts;
  const items = b.evidence.filter((e) => e.bucket !== "reference" && e.bucket !== "pending" && !e.trip_id);
  const unique = items.filter((e) => !e.duplicate_of);
  return (
    <div className="stack">
      <JobView job={job} label="Cleaning" onRetry={() => call("POST", "/clean/run")} />
      <div className="checklist-live">
        <div><span className="muted">Collected</span><b>{k.collected}</b></div>
        <div><span className="muted">Unique after cleaning</span><b>{k.unique}</b></div>
        <div><span className="muted">Copies traced to an original</span><b>{k.duplicates}</b></div>
        <div><span className="muted">Calculations in code</span><b>{b.calcs.length}</b></div>
      </div>
      <Collapse title="Copies traced to their originals" count={b.duplicate_groups.length}>
        {b.duplicate_groups.length === 0 && <p className="muted small">No copies found.</p>}
        <div className="stack-s">
          {b.duplicate_groups.map((g) => {
            const orig = b.evidence.find((e) => e.id === g.original);
            return (
              <div key={g.original} className="card tight">
                <div className="row"><EChip id={g.original} onOpen={openEvidence} /><b>{orig?.title}</b>{orig && <TierBadge tier={orig.tier} />}
                  <span className="pill pass">counted once</span></div>
                <p className="small" style={{ marginTop: 6 }}>{g.copies.length} cop{g.copies.length === 1 ? "y" : "ies"} quoting it, shown as one source:</p>
                <div className="row small" style={{ marginTop: 4 }}>{g.copies.map((c) => {
                  const e = b.evidence.find((x) => x.id === c)!;
                  return <span key={c} className="row" style={{ gap: 4 }}><EChip id={c} onOpen={openEvidence} /><span className="muted">{e.publisher || e.source_name}</span></span>;
                })}</div>
                <p className="small muted" style={{ marginTop: 4 }}>How it was spotted: {b.evidence.filter((x) => g.copies.includes(x.id)).map((x) => x.duplicate_rule).filter((v, i, a) => a.indexOf(v) === i).join("; ")}.</p>
              </div>
            );
          })}
        </div>
      </Collapse>
      <Collapse title="Calculations (done in code, formula and inputs shown)" count={b.calcs.length}>
        {b.calcs.length === 0 && <p className="muted small">No calculations.</p>}
        {b.calcs.map((c) => (
          <div key={c.id} className="derivation" style={{ marginBottom: 8 }}>
            <div className="row"><EChip id={c.evidence_ids[0]} onOpen={openEvidence} /><span className="formula">{c.formula_text} {c.unit}</span></div>
            <div className="small muted">Inputs: {c.inputs_json.a} {c.inputs_json.a_unit} and {c.inputs_json.b} {c.inputs_json.b_unit}{c.inputs_json.years ? `, over ${c.inputs_json.years} years` : ""} · operation: {c.inputs_json.op}</div>
          </div>
        ))}
      </Collapse>
      <Collapse title="Credibility grade of every source" count={unique.length}>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>ID</th><th>Source</th><th>Type</th><th>Tier</th><th>Date</th><th>Recent</th><th>Traced</th><th>Status</th></tr></thead>
          <tbody>{unique.map((e) => (
            <tr key={e.id}>
              <td><EChip id={e.id} onOpen={openEvidence} /></td>
              <td>{e.source_name}<div className="small muted">{e.claim}</div></td>
              <td>{ORIGIN_LABEL[e.origin_type]}</td>
              <td><TierBadge tier={e.tier} /></td>
              <td className="mono">{e.date || "—"}</td>
              <td>{e.credibility_json?.recency_ok ? <span className="icon-pass">✓</span> : <span className="icon-fail">✕</span>} <span className="small muted">{e.credibility_json?.recency_actual}</span></td>
              <td>{e.credibility_json?.traced ? <span className="icon-pass">✓ yes</span> : <span className="icon-fail">✕ no</span>}</td>
              <td><StatusPill e={e} /></td>
            </tr>))}
          </tbody></table></div>
      </Collapse>
      <GateBox signoff={false} title="The agent moves on by itself when cleaning finishes." next={b.progress.done["6"] ? { n: 7, go: () => goStep(7) } : null} />
    </div>
  );
}

/* ================================================================ step 7 */
export function Step7() {
  const { b, call, readOnly, goStep, confirm, openEvidence } = useCtx();
  const done = b.progress.done["7"];
  const locked = readOnly || done;
  const rv = b.review;
  if (!rv) return <div className="empty">Review opens when cleaning has finished.</div>;
  const ev = b.evidence.filter((e) => !e.trip_id);
  const auto = ev.filter((e) => e.bucket === "auto");
  const decision = ev.filter((e) => e.bucket === "decision");
  const undecided = decision.filter((e) => e.status === "needs_decision");
  const decided = decision.filter((e) => e.status !== "needs_decision");
  const picks = auto.filter((e) => e.spot_check_selected);
  const reference = ev.filter((e) => e.status === "pass_line_source");
  const rejected = ev.filter((e) => e.status === "rejected");
  const pending = ev.filter((e) => e.status === "pending" || e.status === "unreadable");
  const hcodes = (e: Evidence) => [...new Set(e.links.map((l) => l.hypothesis_code))].join(", ");
  const decide = async (eid: string, action: string, reason = "", confirmFormula = false) => {
    await call("POST", `/evidence/${eid}/decision`, { action, reason, confirm_formula: confirmFormula });
  };
  const links = async (eid: string, rows: any[]) => { await call("PUT", `/evidence/${eid}/links`, rows); };
  const seen = async (eid: string, sendToReview?: boolean) => { await call("POST", `/review/seen/${eid}`, { send_to_review: !!sendToReview }); };

  return (
    <div className="stack">
      {!locked && (
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Before you can run the tests</h2>
          <div className="checklist-live">
            <div className={rv.auto_seen === rv.auto_total ? "ok" : ""}>{rv.auto_seen === rv.auto_total ? "✓" : "○"} Sources seen<b>{rv.auto_seen} of {rv.auto_total}</b></div>
            <div className={rv.decided === rv.decision_total ? "ok" : ""}>{rv.decided === rv.decision_total ? "✓" : "○"} Decisions<b>{rv.decided} of {rv.decision_total}</b></div>
            <div className={rv.spot_done === rv.spot_total ? "ok" : ""}>{rv.spot_done === rv.spot_total ? "✓" : "○"} <Term t="spot check">Spot check</Term><b>{rv.spot_done === rv.spot_total ? "done" : `${rv.spot_done} of ${rv.spot_total}`}</b></div>
            <div className={rv.sources_box ? "ok" : ""}>{rv.sources_box ? "✓" : "○"} Review box<b>{rv.sources_box ? "ticked" : "not ticked"}</b></div>
          </div>
        </section>
      )}

      <Collapse title="A. Auto-approved by the checklist: sources shown" count={auto.length}>
        <div className="banner info" style={{ borderRadius: 8, marginBottom: 10, border: "1px solid #b4cbf2" }}>The checklist approved {auto.length} items. Check their sources before running the tests.</div>
        {auto.length === 0 ? <p className="muted small">Nothing was auto-approved.</p> : (
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>ID</th><th>Claim</th><th>Source</th><th>Tier and date</th><th>Tests · idea</th><th>Actions</th></tr></thead>
            <tbody>{auto.map((e) => (
              <tr key={e.id}>
                <td><EChip id={e.id} onOpen={openEvidence} /></td>
                <td style={{ minWidth: 170 }}><b>{e.claim}</b><div className="small muted">{e.title}</div></td>
                <td className="small">{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.publisher || e.source_name} ↗</a> : e.source_name}</td>
                <td><TierBadge tier={e.tier} /><div className="mono small muted" style={{ marginTop: 4 }}>{e.date}</div></td>
                <td title={e.checklist_json.map((t) => `${t.test}: ${t.actual} (needs ${t.threshold})`).join("\n")}>
                  <span className="icon-pass">{e.checklist_json.filter((t) => t.pass).length}/{e.checklist_json.length} ✓</span>
                  <div className="mono small">{hcodes(e)}</div></td>
                <td><div className="col" style={{ gap: 6, alignItems: "stretch" }}>
                  <button className="btn sm" onClick={() => openEvidence(e.id)}>Open source</button>
                  {!locked && <button className="btn sm pass" disabled={e.seen_by_consultant} onClick={() => seen(e.id)}>{e.seen_by_consultant ? "Seen ✓" : "Seen"}</button>}
                  {locked && e.seen_by_consultant && <span className="icon-pass small">Seen ✓</span>}
                  {!locked && <button className="btn sm" onClick={() => seen(e.id, true)} title="Move it to your own decision list">Send to my review</button>}
                </div></td>
              </tr>))}
            </tbody></table></div>
        )}
        {picks.length > 0 && (
          <div className="card tight" style={{ marginTop: 12, background: "var(--soft)" }}>
            <div className="row" style={{ marginBottom: 6 }}><b><Term t="spot check">Spot check</Term></b><span className="small muted">The rule engine picked {picks.length} of {auto.length} at random (seed {b.case.settings_json?.spot_seed}). Open each one and compare it with its source.</span></div>
            {picks.map((e) => (
              <div key={e.id} className="row" style={{ marginBottom: 6 }}>
                <EChip id={e.id} onOpen={openEvidence} /><span className="small">{e.claim} · {e.title}</span><span className="spacer" />
                {e.spot_check_result ? <span className={`pill ${e.spot_check_result === "matches" ? "pass" : "fail"}`}>{e.spot_check_result === "matches" ? "✓ Matches" : "✕ Does not match"}</span> : !locked && <>
                  <button className="btn sm pass" onClick={() => call("POST", `/review/spot-check/${e.id}`, { matches: true })}>Matches</button>
                  <button className="btn sm danger" onClick={() => call("POST", `/review/spot-check/${e.id}`, { matches: false })}>Does not match</button></>}
              </div>
            ))}
          </div>
        )}
        <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={!!rv.sources_box} disabled={locked}
          onChange={(e) => call("POST", "/review/confirm-sources", { ticked: e.target.checked })} />I have reviewed these sources</label>
      </Collapse>

      <Collapse title="B. For your decision" count={decision.length}
        extra={<span className="small muted">{undecided.length} left · client claims, expert notes, weak or open-web items, and everything a must-have rests on</span>}>
        {undecided.length === 0 && <p className="small" style={{ color: "var(--pass)", fontWeight: 600, marginBottom: 8 }}>✓ Every item is decided.</p>}
        {undecided.map((e) => <EvidenceCard key={e.id} e={e} hyps={b.hypotheses} mode="decide" onDecide={decide} onLinks={links} readOnly={locked} highlightNeeded />)}
        {decided.length > 0 && <div style={{ marginTop: 12 }}><b className="small muted">Decided ({decided.length})</b>
          <div style={{ marginTop: 6 }}>{decided.map((e) => <EvidenceCard key={e.id} e={e} hyps={b.hypotheses} mode="view" onLinks={links} readOnly={locked} />)}</div></div>}
      </Collapse>

      <Collapse title="C. Pass-line sources · Rejected · Pending" count={reference.length + rejected.length + pending.length} open={false}>
        <p className="small muted" style={{ marginBottom: 8 }}>Pass-line sources were shown with tier and date at step 3 and approved by your lock. Rejected and pending items stay visible.</p>
        {[...reference, ...rejected, ...pending].map((e) => <EvidenceCard key={e.id} e={e} hyps={b.hypotheses} mode="view" readOnly />)}
      </Collapse>

      <GateBox signoff title="The server checks every Seen, every decision, the spot check and the tick before the tests run." readOnly={locked}
        button="Run the tests"
        onClick={async () => { if (await confirm("Run the tests?", "Evidence links will lock. Only evidence from a return trip at step 9 can be linked after this.", "Run the tests")) await call("POST", "/test/run"); }}
        disabledReason={rv.missing?.[0]}
        done={done} doneText="Tests have run and evidence links are locked." next={done ? { n: 8, go: () => goStep(8) } : null} />
      {undecided.length > 0 && !locked && <p className="small muted">Tip: an item's link and role can be changed above (for example to make it a <Term t="cross-check">cross-check</Term>).</p>}
    </div>
  );
}
