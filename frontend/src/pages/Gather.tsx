import { useEffect, useState } from "react";
import { api, upload } from "../api/client";
import type { ActivityRow, Evidence, Need } from "../api/types";
import * as T from "../copy";
import { Footer, PageHead, useCtx } from "../state";
import { Details, Dialog, Empty, Icon, IdChip, Locked, Pill, Progress, Quality, Skeleton, Tip, downloadText, fmtDate, useElapsed } from "../components/ui";
import { EvidenceRow, SourceLine } from "../components/Evidence";

function useStepLog(step: number) {
  const { cid, b } = useCtx();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  useEffect(() => { api<ActivityRow[]>("GET", `/cases/${cid}/activity`).then((r) => setRows(r.filter((a) => a.step === step))).catch(() => setRows([])); },
    [cid, step, b.running_jobs.length]);
  return rows;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <>
      <button type="button" className="btn small" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1500); }
        catch { setErr(true); }
      }}>{done ? T.buttons.copied : T.buttons.copy}</button>
      {err ? <span className="small muted">{T.errors.copy}</span> : null}
    </>
  );
}

// ---------------------------------------------------------------- step 4: Plan the research

export function Step4() {
  const { b, cid, act, readOnly } = useCtx();
  const [tab, setTab] = useState<"answers" | "sources" | "requests">("answers");
  const [checked, setChecked] = useState(false);
  const job = b.jobs.route;
  const planning = !!job && (job.status === "running" || job.status === "queued");
  const elapsed = useElapsed(job?.started_at, planning);
  const locked = readOnly || !!b.progress.done["4"];
  if (planning || (!b.needs.length && job?.status !== "failed")) {
    return (<><PageHead n={4} /><div className="card"><Progress label={T.step4.status.planning} elapsed={elapsed} /><Skeleton rows={4} /></div>
      <Footer status={T.step4.status.planning} primary={T.steps[4].primary} disabled /></>);
  }
  const tabs: [typeof tab, string][] = [["answers", T.step4.tabAnswers], ["sources", T.step4.tabSources], ["requests", T.step4.tabRequests]];
  return (
    <>
      <PageHead n={4} />
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}{k === "requests" && !checked && !locked ? <span className="pill amber"><Icon name="warn" /></span> : null}
          </button>
        ))}
      </div>
      {tab === "answers" ? <Answers /> : tab === "sources" ? <Sources locked={locked} /> : (
        <Requests locked={locked} checked={checked} setChecked={setChecked} />
      )}
      <div className="section"><Searches locked={locked} /></div>
      <Footer primary={T.steps[4].primary} disabled={!checked} confirm={T.step4.confirmSent}
        status={checked ? T.step4.status.ready : T.step4.status.tick}
        onPrimary={() => act(() => api("POST", `/cases/${cid}/requests/mark-sent`, { reviewed: true }))} />
    </>
  );
}

function coverageTag(n: Need, files: { id: number; filename: string }[]) {
  const f = files.find((x) => x.id === n.covered_by_file_id);
  if (n.coverage === "answered_by_client_file")
    return <Pill tone="green" icon="tick">{T.step4.coverage.answered_by_client_file}{f ? ` (${f.filename}, ${n.covered_locator})` : ""}</Pill>;
  if (n.coverage === "partly") return <Pill tone="amber" icon="warn">{T.step4.coverage.partly}{f ? ` (${f.filename})` : ""}</Pill>;
  return <Pill tone="grey" icon="dot">{T.step4.coverage.not_covered}</Pill>;
}

function Answers() {
  const { b } = useCtx();
  return (
    <div className="card" style={{ padding: "8px 8px 4px" }}>
      <table className="t">
        <thead><tr><th>{T.step3.colIdea}</th><th>{T.step4.need}</th><th>{T.step4.where}</th><th>{T.step4.have}</th></tr></thead>
        <tbody>
          {b.needs.map((n) => (
            <tr key={n.id}>
              <td className="mono">{n.hypothesis_code}</td>
              <td>{n.text}{n.coverage === "partly" && n.coverage_note ? <div className="small muted">{T.step4.missing}: {n.coverage_note}</div> : null}</td>
              <td className="nowrap">{T.step4.routes[n.route]}</td>
              <td>{coverageTag(n, b.files)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sources({ locked }: { locked: boolean }) {
  const { b, cid, act } = useCtx();
  const [untick, setUntick] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ source_name: "", domain: "", stated_tier: 2, reason: "" });
  const put = (rows: unknown[]) => act(() => api("PUT", `/cases/${cid}/source-plan`, rows));
  const order = (p: any) => (p.tier == null ? 0 : p.tier);
  const plan = [...b.plan].sort((x, y) => order(x) - order(y));
  return (
    <div className="card" style={{ padding: "8px 8px 12px" }}>
      <table className="t">
        <thead><tr><th>{T.step4.sourceUse}</th><th>{T.step4.sourceName}</th><th>{T.step3.colType}</th>
          <th>{T.step4.sourceQuality} <Tip text={T.tips.quality} /></th></tr></thead>
        <tbody>
          {plan.map((p) => (
            <tr key={p.id} className={p.included ? "" : "muted"}>
              <td><input type="checkbox" checked={p.included} disabled={locked} aria-label={`${T.step4.sourceUse} ${p.source_name}`}
                onChange={(e) => (e.target.checked ? put([{ id: p.id, included: true }]) : (setUntick(p), setReason("")))} /></td>
              <td>{p.source_name}{p.domain ? <span className="muted small"> · {p.domain}</span> : null}
                {!p.included && p.removed_reason ? <div className="small">{T.step4.notUsed(p.removed_reason)}</div> : null}</td>
              <td className="nowrap">{T.step4.sourceKinds[p.origin_type] || p.origin_type}</td>
              <td className="nowrap">{p.tier == null && p.origin_type === "open_web" ? <span className="small muted">{T.step4.eachRated}</span> : <Quality tier={p.tier} />}
                {p.stated_by_consultant ? <> <span className="tag">{T.origin.consultant}</span></> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked ? (adding ? (
        <div className="card tight" style={{ margin: "12px 8px 0" }}>
          <p className="label">{T.step4.newSource}</p>
          <div className="grid2">
            <label className="field"><span className="field-label">{T.step4.newSourceName}</span>
              <input type="text" value={n.source_name} onChange={(e) => setN({ ...n, source_name: e.target.value })} /></label>
            <label className="field"><span className="field-label">{T.step4.newSourceDomain}</span>
              <input type="text" value={n.domain} onChange={(e) => setN({ ...n, domain: e.target.value })} /></label>
            <label className="field"><span className="field-label">{T.step4.newSourceQuality}</span>
              <select value={n.stated_tier} onChange={(e) => setN({ ...n, stated_tier: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{T.evidence.quality[t]}</option>)}
              </select></label>
            <label className="field"><span className="field-label">{T.step4.newSourceReason}</span>
              <input type="text" value={n.reason} onChange={(e) => setN({ ...n, reason: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn small" onClick={() => setAdding(false)}>{T.buttons.cancel}</button>
            <button type="button" className="btn small" disabled={!n.source_name || !n.reason.trim()}
              onClick={async () => { await put([{ ...n, origin_type: "open_web", included: true }]); setAdding(false); }}>{T.buttons.saveSource}</button>
          </div>
        </div>
      ) : <div style={{ padding: "12px 8px 0" }}><button type="button" className="btn small" onClick={() => setAdding(true)}>{T.buttons.addSource}</button></div>) : null}
      {untick ? (
        <Dialog text={T.step4.untickReason} confirmLabel={T.buttons.saveChanges} onCancel={() => setUntick(null)}
          onConfirm={() => { if (!reason.trim()) return; const p = untick; setUntick(null); void put([{ id: p.id, included: false, removed_reason: reason.trim() }]); }}>
          <input type="text" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} aria-label={T.step4.untickReason} style={{ marginBottom: 16 }} />
        </Dialog>
      ) : null}
    </div>
  );
}

function Requests({ locked, checked, setChecked }: { locked: boolean; checked: boolean; setChecked: (v: boolean) => void }) {
  const { b } = useCtx();
  const req = (b.case.settings_json || {}).requests || {};
  return (
    <>
      <div className="card">
        <div className="spread"><h2>{T.step4.clientRequest}</h2>
          <div className="row"><CopyButton text={req.client || ""} />
            <button type="button" className="btn small" onClick={() => downloadText("client-request.txt", req.client || "")}>{T.buttons.download}</button></div></div>
        <p className="small muted" style={{ marginTop: 0 }}>{T.step4.clientRequestNote(req.client_gaps || 0, req.client_have || 0)}</p>
        <pre className="reqtext">{req.client}</pre>
      </div>
      <div className="card">
        <div className="spread"><h2>{T.step4.expertQuestions}</h2>
          <div className="row"><CopyButton text={req.expert || ""} />
            <button type="button" className="btn small" onClick={() => downloadText("expert-questions.txt", req.expert || "")}>{T.buttons.download}</button></div></div>
        <pre className="reqtext">{req.expert}</pre>
      </div>
      {!locked ? (
        <label className="tickbox check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{T.step4.checkedOut}</label>
      ) : <p className="section"><Locked /></p>}
    </>
  );
}

function highlight(original: string, removed: string[]) {
  if (!removed?.length) return <>{original}</>;
  const esc = removed.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = original.split(new RegExp(`(${esc})`, "gi"));
  return <>{parts.map((p, i) => (removed.some((r) => r.toLowerCase() === p.toLowerCase()) ? <del key={i} className="removed">{p}</del> : <span key={i}>{p}</span>))}</>;
}

function Searches({ locked }: { locked: boolean }) {
  const { b, cid, act } = useCtx();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const desk = b.needs.filter((n) => n.route === "desk" && n.queries_json?.length);
  return (
    <Details>
      <p className="label">{T.step4.searchesTitle}</p>
      <div className="stack">
        {desk.map((n) => {
          const q = n.queries_json[0];
          return (
            <div key={n.id}>
              <div className="small muted mono">{n.ref} · {n.hypothesis_code}</div>
              <div className="side">
                <div><div className="label">{T.step4.original}</div>{highlight(q.original, q.removed)}</div>
                <div><div className="label">{T.step4.cleaned}</div><span className="mono">{q.query}</span></div>
              </div>
              {q.removed?.length ? <div className="small muted">{T.step4.removedTerms}: {q.removed.join(", ")}</div> : null}
              {q.blocked?.length ? (
                <div className="stack-sm" style={{ marginTop: 8 }}>
                  <Pill tone="red" icon="cross">{T.step4.blocked(q.blocked.join(", "))}</Pill>
                  {!locked ? (
                    <div className="row">
                      <input type="text" aria-label={T.buttons.editSearch} value={edit[n.ref] ?? q.query} onChange={(e) => setEdit({ ...edit, [n.ref]: e.target.value })} />
                      <button type="button" className="btn small" onClick={() => act(() => api("PUT", `/cases/${cid}/needs/${n.ref}/query`, { query: edit[n.ref] ?? q.query }))}>
                        {T.buttons.saveSearch}</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Details>
  );
}

// ---------------------------------------------------------------- step 5: Gathering evidence

export function Step5() {
  const { b, cid, act, go } = useCtx();
  const job = b.jobs.collect;
  const running = !!job && (job.status === "running" || job.status === "queued");
  const done = !!b.progress.done["5"];
  const elapsed = useElapsed(job?.started_at, running);
  const groups = (job?.progress?.groups || {}) as Record<string, { done: number; total: number; state: string }>;
  const pending = b.evidence.filter((e) => e.status === "pending");
  const log = useStepLog(5);
  const finishedSecs = job?.finished_at && job?.started_at ? Math.round((Date.parse(job.finished_at + "Z") - Date.parse(job.started_at + "Z")) / 1000) : elapsed;
  return (
    <>
      <PageHead n={5} />
      <div className="card">
        {Object.keys(T.step5.groups).map((k) => {
          const g = groups[k] || { done: 0, total: 0, state: done ? "done" : "waiting" };
          return (
            <div key={k} className="grouprow">
              <b>{T.step5.groups[k]}</b>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${g.total ? Math.round((g.done / g.total) * 100) : g.state === "done" ? 100 : 0}%` }} /></div>
              <span className="small mono muted">{g.total ? T.step5.items(g.done, g.total) : ""}</span>
              <span className="small">{T.step5.states[g.state] || g.state}</span>
            </div>
          );
        })}
        <div className="spread small muted" style={{ marginTop: 12 }}>
          <span>{T.step5.benchmarksNote(b.counts.benchmarks)}</span>
          <span className="mono">{T.step5.elapsed(running ? elapsed : finishedSecs)}</span>
        </div>
      </div>
      <div className="card">
        <h2>{T.step5.stillWaiting}</h2>
        {pending.length === 0 ? <Empty text={T.step5.nothingWaiting} /> : (
          <ul className="filelist">{pending.map((e) => <li key={e.id}><Icon name="clock" /><IdChip id={e.id} /> {e.title}</li>)}</ul>
        )}
      </div>
      <div className="section">
        <Details>
          {running ? <ReplyBox /> : null}
          <p className="label">{T.step5.log}</p>
          <ul className="hist">{log.map((a) => <li key={a.id}><span className="muted small">{fmtDate(a.ts)}</span> {a.message}</li>)}</ul>
        </Details>
      </div>
      <Footer done={done} primary={T.steps[5].primary} disabled={!running}
        status={running ? <span style={{ width: 320 }}><Progress label={T.step5.status.running} elapsed={elapsed} /></span> : ""}
        onPrimary={() => act(() => api("POST", `/cases/${cid}/collect/stop`))} onContinue={() => go(6)} />
    </>
  );
}

function ReplyBox() {
  const { cid, act } = useCtx();
  const [kind, setKind] = useState("followup");
  const [text, setText] = useState("");
  return (
    <div className="stack-sm" style={{ marginBottom: 16 }}>
      <p className="label">{T.step5.addReplyTitle}</p>
      <select aria-label={T.step5.replyKind} value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 220 }}>
        <option value="followup">{T.step5.replyClient}</option><option value="expert_note">{T.step5.replyExpert}</option>
      </select>
      <textarea aria-label={T.step5.pasteHint} placeholder={T.step5.pasteHint} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn small" disabled={!text.trim()} onClick={() => act(async () => {
        const fd = new FormData(); fd.append("kind", kind); fd.append("text", text); await upload(`/cases/${cid}/files`, fd); setText("");
      })}>{T.buttons.addReply}</button>
    </div>
  );
}

// ---------------------------------------------------------------- step 6: Checking the evidence

export function Step6() {
  const { b, go, openEvidence } = useCtx();
  const job = b.jobs.clean;
  const running = !!job && (job.status === "running" || job.status === "queued");
  const elapsed = useElapsed(job?.started_at, running);
  const p = job?.progress || {};
  const k = b.counts;
  const items = b.evidence.filter((e) => !e.trip_id && e.bucket !== "reference" && e.status !== "pending");
  const unique = items.filter((e) => !e.duplicate_of);
  const rated = unique.filter((e) => e.credibility_json?.tier !== undefined).length;
  const figs = unique.flatMap((e) => (e.figures_json || []).filter((f) => f.kind !== "calculated"));
  const notFound = figs.filter((f) => f.verified === false).length;
  const conversions = unique.flatMap((e) => (e.checklist_json || []).filter((c) => c.test === "Uses the idea's measure" && c.pass && c.actual !== "same unit")
    .map((c) => ({ id: e.id, text: c.actual })));
  const done = !!b.progress.done["6"];
  return (
    <>
      <PageHead n={6} />
      {running ? <div className="card" style={{ marginBottom: 16 }}><Progress label={T.step6.progress[p.stage] || T.step6.status.running}
        done={p.total ? p.done : undefined} total={p.total || undefined} elapsed={elapsed} /></div> : null}
      <div className="bignums">
        <div className="bignum"><div className="n">{k.collected}</div><div className="l">{T.step6.collected}</div></div>
        <div className="bignum"><div className="n">{done ? k.unique : "–"}</div><div className="l">{T.step6.separate} <Tip text={T.tips.separate} /></div></div>
        <div className="bignum"><div className="n">{done ? rated : "–"}</div><div className="l">{T.step6.rated}</div></div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>{T.step6.merged}</h2>
        {!done ? <Skeleton /> : b.duplicate_groups.length === 0 ? <Empty text={T.step6.noMerged} /> : (
          <table className="t"><tbody>
            {b.duplicate_groups.map((g) => (
              <tr key={g.original}>
                <td className="nowrap small muted">{T.step6.copies(g.copies.length)}</td>
                <td><IdChip id={g.original} onOpen={openEvidence} /> {g.original_title}</td>
                <td className="right">{g.copies.map((c) => <span key={c} style={{ marginLeft: 4 }}><IdChip id={c} onOpen={openEvidence} /></span>)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {done ? (
        <div className="section">
          <Details>
            <div className="stack">
              <div><p className="label">{T.step6.calcs}</p>
                {b.calcs.length === 0 ? <p className="small muted">{T.step6.noCalcs}</p> : b.calcs.map((c) => (
                  <div key={c.id} className="row small" style={{ marginBottom: 6 }}>{(c.evidence_ids || []).map((id: string) => <IdChip key={id} id={id} onOpen={openEvidence} />)}
                    <span className="formula">{c.formula_text}</span><span className="tag">{T.origin.rule_engine}</span></div>
                ))}</div>
              <div><p className="label">{T.step6.ratings}</p>
                <table className="t"><tbody>
                  {unique.map((e) => (
                    <tr key={e.id}><td><IdChip id={e.id} onOpen={openEvidence} /></td><td className="ellipsis"><SourceLine e={e} /></td>
                      <td><Quality tier={e.tier} /></td><td className="small muted">{e.credibility_json?.tier_reason}</td><td className="small">{e.date}</td></tr>
                  ))}
                </tbody></table></div>
              <div><p className="label">{T.step6.conversions}</p>
                {conversions.length === 0 ? <p className="small muted">{T.step6.noConversions}</p> :
                  conversions.map((c) => <div key={c.id} className="small"><span className="mono">{c.id}</span> {c.text}</div>)}</div>
              <p className="small">{T.step6.notFoundCount(notFound, figs.length)}</p>
            </div>
          </Details>
        </div>
      ) : null}
      <Footer primary={T.steps[6].primary} disabled={!done} status={running ? T.step6.status.running : done ? T.step6.status.done : ""}
        statusOk={done} onPrimary={() => go(7)} />
    </>
  );
}

// ---------------------------------------------------------------- step 7: Review the evidence

export function Step7() {
  const { b, cid, act, readOnly, openEvidence } = useCtx();
  const rv = b.review || { auto_total: 0, auto_seen: 0, decision_total: 0, decided: 0, spot_total: 0, spot_done: 0, sources_box: false };
  const main = b.evidence.filter((e) => !e.trip_id);
  const decision = main.filter((e) => e.bucket === "decision").sort((x, y) => Number(x.status !== "needs_decision") - Number(y.status !== "needs_decision"));
  const auto = main.filter((e) => e.bucket === "auto");
  const picks = auto.filter((e) => e.spot_check_selected);
  const reference = main.filter((e) => e.bucket === "reference");
  const rejected = main.filter((e) => e.status === "rejected");
  const waiting = main.filter((e) => e.status === "pending");
  const [openRow, setOpenRow] = useState("");
  const locked = readOnly || !!b.progress.done["7"];
  const showSpot = rv.double_check !== false && picks.length > 0;   // optional: never holds up the tests
  const status = rv.decided < rv.decision_total ? T.step7.status.decide(rv.decision_total - rv.decided)
    : rv.auto_seen < rv.auto_total ? T.step7.status.seen(rv.auto_total - rv.auto_seen)
      : !rv.sources_box ? T.step7.status.box : T.step7.status.ready;
  const ready = status === T.step7.status.ready;
  const chip = (ok: boolean, text: string) => <span className={`progress-chip${ok ? " ok" : ""}`}><Icon name={ok ? "tick" : "clock"} />{text}</span>;
  return (
    <>
      <PageHead n={7} />
      <div className="chips">
        {chip(rv.decided >= rv.decision_total, T.step7.chipDecide(rv.decided, rv.decision_total))}
        {chip(rv.auto_seen >= rv.auto_total, T.step7.chipSeen(rv.auto_seen, rv.auto_total))}
      </div>
      <div className="card" style={{ padding: "16px 16px 8px" }}>
        <h2 style={{ paddingLeft: 4 }}>{T.step7.needsCall(decision.length)}</h2>
        {decision.length === 0 ? <Empty text={T.step7.needsNone} /> : decision.map((e) => <EvidenceRow key={e.id} e={e} decide linksEditable />)}
      </div>
      <div className="card" style={{ padding: "16px 16px 8px" }}>
        <h2 style={{ paddingLeft: 4 }}>{T.step7.passed(auto.length)}</h2>
        {auto.length === 0 ? <Empty text={T.step7.passedNone} /> : (
          <table className="t">
            <thead><tr><th>{T.step7.colClaim}</th><th>{T.step7.colSource}</th><th>{T.step7.colQuality}</th><th>{T.step7.colDate}</th>
              <th>{T.step7.colSeen}</th><th /></tr></thead>
            <tbody>
              {auto.map((e) => (
                <AutoRow key={e.id} e={e} open={openRow === e.id} onToggle={() => setOpenRow(openRow === e.id ? "" : e.id)} locked={locked} />
              ))}
            </tbody>
          </table>
        )}
        <div className="section" style={{ padding: "0 4px 8px" }}>
          <label className="tickbox check">
            <input type="checkbox" checked={!!rv.sources_box} disabled={locked}
              onChange={(e) => act(() => api("POST", `/cases/${cid}/review/confirm-sources`, { ticked: e.target.checked }))} />{T.step7.checkedSources}
          </label>
        </div>
      </div>
      {showSpot ? (
        <div className="card" style={{ padding: "16px 20px" }}>
          <div className="row"><h2 style={{ margin: 0 }}>{T.step7.spotTitle}</h2><Pill tone="grey">{T.step7.spotOptional}</Pill><Tip text={T.tips.spot} /></div>
          <p className="small muted">{T.step7.spotHint}</p>
          {picks.map((e) => (
            <div key={e.id} className="spread" style={{ padding: "6px 0" }}>
              <span className="row"><IdChip id={e.id} onOpen={openEvidence} /><span className="ellipsis">{e.claim}</span></span>
              <span className="row">
                <button type="button" className="btn small" onClick={() => openEvidence(e.id)}>{T.buttons.openSource}</button>
                {e.spot_check_result === "matches" ? <Pill tone="green" icon="tick">{T.buttons.matches}</Pill>
                  : e.spot_check_result === "skipped" ? <Pill tone="grey">{T.step7.spotSkippedByYou}</Pill>
                    : e.spot_check_result ? <Pill tone="amber" icon="warn">{T.step7.movedToCall}</Pill> : (
                      <>
                        <button type="button" className="btn small" disabled={locked} onClick={() => act(() => api("POST", `/cases/${cid}/review/spot-check/${e.id}`, { matches: true }))}>{T.buttons.matches}</button>
                        <button type="button" className="btn small" disabled={locked} onClick={() => act(() => api("POST", `/cases/${cid}/review/spot-check/${e.id}`, { matches: false }))}>{T.buttons.doesntMatch}</button>
                        <button type="button" className="linkbtn small" disabled={locked} onClick={() => act(() => api("POST", `/cases/${cid}/review/spot-check/${e.id}`, { skip: true }))}>{T.buttons.skipCheck}</button>
                      </>
                    )}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="section">
        <Details title={T.step7.closedSection(reference.length, rejected.length, waiting.length)}>
          {reference.length ? <><p className="label">{T.step7.targetSources}</p>{reference.map((e) => <EvidenceRow key={e.id} e={e} />)}</> : null}
          {rejected.length ? <><p className="label" style={{ marginTop: 16 }}>{T.step7.rejected}</p>{rejected.map((e) => <EvidenceRow key={e.id} e={e} />)}</> : null}
          {waiting.length ? <><p className="label" style={{ marginTop: 16 }}>{T.step7.waiting}</p>{waiting.map((e) => <EvidenceRow key={e.id} e={e} />)}</> : null}
        </Details>
      </div>
      <Footer primary={T.steps[7].primary} disabled={!ready} statusOk={ready} status={status} confirm={T.step7.confirmRun}
        onPrimary={() => act(() => api("POST", `/cases/${cid}/test/run`))} />
    </>
  );
}

function AutoRow({ e, open, onToggle, locked }: { e: Evidence; open: boolean; onToggle: () => void; locked: boolean }) {
  const { cid, act, openEvidence } = useCtx();
  return (
    <>
      <tr className={`clickable${open ? " expanded" : ""}`} onClick={onToggle}>
        <td><span className="row"><IdChip id={e.id} onOpen={openEvidence} /><span className="ellipsis" style={{ maxWidth: 260 }}>{e.claim}</span></span></td>
        <td className="ellipsis" style={{ maxWidth: 220 }}><SourceLine e={e} /></td>
        <td><Quality tier={e.tier} /></td>
        <td className="nowrap small">{e.date || T.evidence.undated}</td>
        <td onClick={(ev) => ev.stopPropagation()}>
          <input type="checkbox" checked={e.seen_by_consultant} disabled={locked || e.seen_by_consultant} aria-label={`${T.step7.colSeen} ${e.id}`}
            onChange={() => act(() => api("POST", `/cases/${cid}/review/seen/${e.id}`))} />
        </td>
        <td className="right" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className="btn small" onClick={() => openEvidence(e.id)}>{T.buttons.openSource}</button>
        </td>
      </tr>
      {open ? (
        <tr className="sub"><td colSpan={6}>
          <EvidenceRow e={e} startOpen />
          {!locked ? <button type="button" className="linkbtn small" onClick={() => act(() => api("POST", `/cases/${cid}/review/seen/${e.id}`, { send_to_review: true }))}>
            {T.buttons.sendToReview}</button> : null}
        </td></tr>
      ) : null}
    </>
  );
}
