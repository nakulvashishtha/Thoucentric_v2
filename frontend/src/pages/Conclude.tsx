import { useEffect, useMemo, useRef, useState } from "react";
import { api, upload } from "../api/client";
import type { Hypothesis, Trip } from "../api/types";
import * as T from "../copy";
import { Footer, PageHead, useCtx } from "../state";
import { Confidence, Details, Empty, Icon, IdChip, Origin, Pill, Progress, ResultPill, Skeleton, download, downloadText, fmtDate, fmtNum, useElapsed, withUnit } from "../components/ui";
import { EvidenceRow } from "../components/Evidence";
import { CardData, Reasoning, ResultCard, cardFromHypothesis } from "../components/Results";

const isRunning = (j?: { status: string }) => !!j && (j.status === "running" || j.status === "queued");

// ---------------------------------------------------------------- step 8: Results

export function Step8() {
  const { b, cid, act, go } = useCtx();
  const kept = b.hypotheses.filter((h) => !h.removed_reason && h.verdict);
  const gaps = kept.filter((h) => h.verdict!.result === "not_enough");
  const added = b.overall && !b.overall.stale;
  return (
    <>
      <PageHead n={8} />
      <div className="results">
        {kept.map((h) => { const c = cardFromHypothesis(h)!; return <ResultCard key={h.code} c={c}><Reasoning h={h} /></ResultCard>; })}
      </div>
      {added ? <Footer done onContinue={() => go(10)} /> : gaps.length ? (
        <Footer primary={T.buttons.fillGaps} status={T.results.status.gaps(gaps.length)} onPrimary={() => go(9)}
          extra={<button type="button" className="linkbtn small" onClick={() => act(async () => { await api("POST", `/cases/${cid}/addup/run`); go(10); })}>{T.buttons.skipForNow}</button>} />
      ) : (
        <Footer primary={T.buttons.addItUp} status={T.results.status.none} statusOk
          onPrimary={() => act(async () => { await api("POST", `/cases/${cid}/addup/run`); go(10); })} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- step 9: Fill the gaps

function latestTrip(trips: Trip[], code: string): Trip | undefined {
  return trips.filter((t) => t.hypothesis_code === code).sort((a, z) => z.n - a.n)[0];
}

export function Step9() {
  const { b, cid, act, go } = useCtx();
  const kept = b.hypotheses.filter((h) => !h.removed_reason && h.verdict);
  const [extra, setExtra] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [replies, setReplies] = useState<Record<number, { text: string; file?: File }>>({});
  const [third, setThird] = useState<Record<string, { tick: boolean; reason: string }>>({});
  const free = b.rules.thresholds.trips.free as number;
  const max = b.rules.thresholds.trips.max_with_override as number;

  const withTrips = new Set(b.trips.map((t) => t.hypothesis_code));
  const cards = kept.filter((h) => h.verdict!.result === "not_enough" || withTrips.has(h.code) || extra.includes(h.code));
  const optional = kept.filter((h) => !cards.includes(h) && (h.verdict!.result === "conflicting" || h.verdict!.confidence === "low"));

  // what each card needs next
  const needDraft = cards.filter((h) => {
    const t = latestTrip(b.trips, h.code);
    if (t && !t.retested_at) return false;                       // a request is already open
    const v = h.verdict!;
    const unsettled = v.result === "not_enough" || v.result === "conflicting" || v.confidence === "low";
    if (!unsettled) return false;
    const count = b.trips.filter((x) => x.hypothesis_code === h.code).length;
    if (count < free) return true;
    return count < max && !!third[h.code]?.tick && !!third[h.code]?.reason.trim();
  });
  const drafting = b.trips.filter((t) => isRunning(b.jobs[`trip_${t.id}`]));
  const unsent = b.trips.filter((t) => !t.marked_sent_at && t.question && !isRunning(b.jobs[`trip_${t.id}`]));
  const awaiting = b.trips.filter((t) => t.marked_sent_at && !t.reply_file_id);
  const reading = b.trips.filter((t) => isRunning(b.jobs[`trip_reply_${t.id}`]));
  const tripEvidence = b.evidence.filter((e) => e.trip_id && b.trips.some((t) => t.id === e.trip_id && !t.retested_at));
  const undecided = tripEvidence.filter((e) => e.status === "needs_decision");
  const mixMissing = b.trips.filter((t) => t.reply_file_id && !t.retested_at && !Object.keys(t.sample_mix_json || {}).length);
  const toRetest = b.progress.reopened;
  const withReply = awaiting.filter((t) => replies[t.id]?.text?.trim() || replies[t.id]?.file);

  const addUp = () => act(async () => { await api("POST", `/cases/${cid}/addup/run`); go(10); });
  let footer: Parameters<typeof Footer>[0];
  const skip = <button type="button" className="linkbtn small" onClick={addUp}>{T.buttons.skipForNow}</button>;
  if (drafting.length) footer = { status: T.step9.status.drafting, primary: T.buttons.markSent, disabled: true };
  else if (reading.length) footer = { status: T.step9.status.reading, primary: T.buttons.testAgain, disabled: true };
  else if (unsent.length) footer = { status: T.step9.status.send, primary: T.buttons.markSent, confirm: T.step9.confirmSent, extra: skip,
    onPrimary: () => act(async () => { for (const t of unsent) await api("POST", `/cases/${cid}/trips/${t.id}/mark-sent`); }) };
  else if (awaiting.length) footer = { status: T.step9.status.reply, primary: T.steps[9].primary, disabled: !withReply.length, extra: skip,
    onPrimary: () => act(async () => {
      for (const t of withReply) {
        const r = replies[t.id];
        const fd = new FormData();
        if (r.file) fd.append("file", r.file); else { fd.append("text", r.text); fd.append("filename", `reply-${t.hypothesis_code}.txt`); }
        await upload(`/cases/${cid}/trips/${t.id}/reply`, fd);
      }
      setReplies({});
    }) };
  else if (undecided.length) footer = { status: T.step9.status.decide(undecided.length), primary: T.buttons.testAgain, disabled: true };
  else if (mixMissing.length) footer = { status: T.step9.status.mix, primary: T.buttons.testAgain, disabled: true };
  else if (toRetest.length) footer = { status: T.step9.status.retest, statusOk: true, primary: T.buttons.testAgain,
    onPrimary: () => act(async () => { for (const code of toRetest) await api("POST", `/cases/${cid}/retest`, { hypothesis: code }); }) };
  else if (needDraft.length) footer = { status: T.step9.status.draft, primary: T.buttons.draftQuestion, extra: skip,
    onPrimary: () => act(async () => {
      for (const h of needDraft) {
        const o = third[h.code];
        await api("POST", `/cases/${cid}/trips`, { hypothesis: h.code, override: !!o?.tick, override_reason: o?.reason || "" });
      }
    }) };
  else footer = { status: T.step9.status.done, statusOk: true, primary: T.buttons.addItUp, onPrimary: addUp };

  return (
    <>
      <PageHead n={9} />
      {cards.length === 0 ? <div className="card"><Empty text={T.step9.noGaps} /></div> : null}
      <div className="stack">
        {cards.map((h) => (
          <GapCard key={h.code} h={h} free={free} max={max} reply={replies} setReply={setReplies} third={third} setThird={setThird} />
        ))}
      </div>
      {optional.length ? (
        <div className="section">
          {picking ? (
            <div className="row wrap">
              <span className="small muted">{T.step9.pickIdea}:</span>
              {optional.map((h) => <button key={h.code} type="button" className="btn small" onClick={() => { setExtra([...extra, h.code]); setPicking(false); }}>
                {h.code}: {h.text}</button>)}
            </div>
          ) : <button type="button" className="linkbtn" onClick={() => setPicking(true)}>{T.buttons.addAnotherIdea}</button>}
        </div>
      ) : null}
      <Footer {...footer} />
    </>
  );
}

function GapCard({ h, free, max, reply, setReply, third, setThird }: { h: Hypothesis; free: number; max: number;
  reply: Record<number, { text: string; file?: File }>; setReply: (r: Record<number, { text: string; file?: File }>) => void;
  third: Record<string, { tick: boolean; reason: string }>; setThird: (t: Record<string, { tick: boolean; reason: string }>) => void }) {
  const { b, cid, act } = useCtx();
  const t = latestTrip(b.trips, h.code);
  const count = b.trips.filter((x) => x.hypothesis_code === h.code).length;
  const [q, setQ] = useState(t?.question || "");
  useEffect(() => { setQ(t?.question || ""); }, [t?.id, t?.question]);
  const drafting = t && isRunning(b.jobs[`trip_${t.id}`]);
  const reading = t && isRunning(b.jobs[`trip_reply_${t.id}`]);
  const ev = t ? b.evidence.filter((e) => e.trip_id === t.id) : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const sampleFile = b.sample_replies?.[h.code];
  const r = t ? reply[t.id] || { text: "" } : { text: "" };
  const mix = t?.sample_mix_json || {};
  const settledAfter = t?.retested_at;
  const showThird = (!t || settledAfter) && count >= free && count < max && (h.verdict!.result !== "holds" || h.verdict!.confidence === "low");
  return (
    <div className="card">
      <div className="spread">
        <div className="result-idea"><span className="code">{h.code}</span>{h.text}</div>
        <div className="row"><ResultPill result={h.verdict!.result} /><Confidence level={h.verdict!.confidence} /></div>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>{T.step9.request(Math.max(1, count), free)}{t?.override_reason ? ` · ${t.override_reason}` : ""}</div>
      {count >= max && settledAfter ? <p className="small">{T.step9.limitReached}</p> : null}
      {showThird ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <label className="check small"><input type="checkbox" checked={!!third[h.code]?.tick}
            onChange={(e) => setThird({ ...third, [h.code]: { tick: e.target.checked, reason: third[h.code]?.reason || "" } })} />{T.step9.thirdTick}</label>
          {third[h.code]?.tick ? <input type="text" aria-label={T.step9.thirdReason} placeholder={T.step9.thirdReason} value={third[h.code]?.reason || ""}
            onChange={(e) => setThird({ ...third, [h.code]: { tick: true, reason: e.target.value } })} /> : null}
        </div>
      ) : null}
      {t && !settledAfter ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {drafting ? <Progress label={T.step9.drafting} /> : (
            <>
              <div>
                <div className="spread"><span className="field-label">{T.step9.question}</span>
                  <span className="row"><Origin who={q === t.question ? "llm" : "consultant"} />
                    <button type="button" className="btn small" onClick={() => navigator.clipboard.writeText(`${q}\n\n${T.step9.whatWeHave}: ${t.what_we_have}`)}>{T.buttons.copy}</button>
                    <button type="button" className="btn small" onClick={() => downloadText(`question-${h.code}.txt`, `${q}\n\n${T.step9.whatWeHave}: ${t.what_we_have}`)}>{T.buttons.download}</button>
                  </span></div>
                <textarea value={q} disabled={!!t.marked_sent_at} aria-label={T.step9.question} onChange={(e) => setQ(e.target.value)}
                  onBlur={() => { if (q !== t.question) void act(() => api("PUT", `/cases/${cid}/trips/${t.id}`, { question: q })); }} />
                <p className="small"><b>{T.step9.whatWeHave}:</b> {t.what_we_have}</p>
                {t.marked_sent_at ? <span className="pill grey"><Icon name="tick" />{T.step9.sentOn}</span> : null}
              </div>
              {t.marked_sent_at && !t.reply_file_id ? (
                <div>
                  <span className="field-label">{T.step9.reply}</span>
                  <span className="hint">{T.step9.replyHint}</span>
                  <textarea value={r.text} aria-label={T.step9.reply} onChange={(e) => setReply({ ...reply, [t.id]: { text: e.target.value } })} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>{T.buttons.addFile}</button>
                    {r.file ? <span className="small"><Icon name="file" /> {r.file.name}</span> : null}
                    <input ref={fileRef} type="file" hidden accept=".csv,.xlsx,.txt,.pdf" aria-label={T.buttons.addFile}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setReply({ ...reply, [t.id]: { text: "", file: f } }); }} />
                    {sampleFile ? <button type="button" className="linkbtn small" onClick={async () => {
                      const res = await fetch(`/api/samples/${b.case.sample}/replies/${sampleFile}`);
                      const blob = await res.blob();
                      setReply({ ...reply, [t.id]: { text: "", file: new File([blob], sampleFile) } });
                    }}>{T.buttons.useSampleReply}</button> : null}
                  </div>
                </div>
              ) : null}
              {reading ? <Progress label={T.step9.reading} /> : null}
              {ev.length ? (
                <div>
                  <p className="label">{T.step9.newEvidence}</p>
                  {ev.map((e) => <EvidenceRow key={e.id} e={e} decide linksEditable startOpen={e.status === "needs_decision"} />)}
                </div>
              ) : null}
              {t.reply_file_id && !reading ? <SampleMix t={t} mix={mix} /> : null}
            </>
          )}
        </div>
      ) : null}
      {settledAfter ? <p className="small" style={{ marginTop: 12 }}><Pill tone="grey" icon="tick">{T.step9.retested}</Pill></p> : null}
    </div>
  );
}

function SampleMix({ t, mix }: { t: Trip; mix: any }) {
  const { cid, act } = useCtx();
  const [rows, setRows] = useState([{ dimension: "", sample: "", target: "" }]);
  if (mix.not_applicable) return <div><p className="label">{T.step9.sampleMix}</p><p className="small">{T.step9.sampleMixNa}</p></div>;
  if (mix.rows) {
    return (
      <div>
        <p className="label">{T.step9.sampleMix} <Origin who="rule_engine" /></p>
        <table className="t"><thead><tr><th>{T.step9.dimension}</th><th className="num">{T.step9.inSample}</th><th className="num">{T.step9.inTarget}</th></tr></thead>
          <tbody>{mix.rows.map((r: any) => <tr key={r.dimension}><td>{r.dimension}</td><td className="num">{fmtNum(r.sample)}%</td><td className="num">{fmtNum(r.target)}%</td></tr>)}</tbody></table>
        <p className="small">{mix.passes ? <Pill tone="green" icon="tick">{T.step9.sampleMixPass}</Pill> : <Pill tone="amber" icon="warn">{T.step9.sampleMixFail}</Pill>}</p>
        {mix.target_note ? <p className="small muted">{mix.target_note}</p> : null}
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <p className="label">{T.step9.sampleMix}</p>
      {rows.map((r, i) => (
        <div key={i} className="row">
          <input type="text" aria-label={T.step9.dimension} placeholder={T.step9.dimension} value={r.dimension} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dimension: e.target.value } : x)))} />
          <input type="number" aria-label={T.step9.inSample} placeholder={T.step9.inSample} value={r.sample} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sample: e.target.value } : x)))} />
          <input type="number" aria-label={T.step9.inTarget} placeholder={T.step9.inTarget} value={r.target} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn small" disabled={!rows.every((r) => r.dimension && r.sample !== "" && r.target !== "")}
          onClick={() => act(() => api("POST", `/cases/${cid}/trips/${t.id}/sample-mix`, {
            sample: Object.fromEntries(rows.map((r) => [r.dimension, Number(r.sample)])),
            target: Object.fromEntries(rows.map((r) => [r.dimension, Number(r.target)])) }))}>{T.buttons.saveChanges}</button>
        <button type="button" className="linkbtn small" onClick={() => act(() => api("POST", `/cases/${cid}/trips/${t.id}/sample-mix`, { not_applicable: true }))}>
          {T.buttons.markNotNeeded}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 10: The answer

const ANSWER_TONE: Record<string, [string, string]> = { achievable: ["green", "tick"], not_achievable: ["red", "cross"], consultant_decides: ["amber", "warn"] };

export function Step10() {
  const { b, cid, act, go, openEvidence } = useCtx();
  const job = b.jobs.addup;
  const running = isRunning(job);
  const elapsed = useElapsed(job?.started_at, running);
  const ov = b.overall;
  const fresh = ov && !ov.stale && b.summary;
  const rejected = b.evidence.filter((e) => e.status === "rejected");
  if (running || !fresh) {
    return (
      <>
        <PageHead n={10} />
        <div className="card">{running ? <><Progress label={T.step10.adding} elapsed={elapsed} /><Skeleton rows={4} /></> : <Empty text={T.step10.adding} />}</div>
        <Footer status={running ? T.step10.status.running : ""} primary={running ? T.steps[10].primary : T.buttons.addItUp} disabled={running}
          onPrimary={() => act(() => api("POST", `/cases/${cid}/addup/run`))} />
      </>
    );
  }
  const [tone, icon] = ANSWER_TONE[ov.result] || ["amber", "warn"];
  return (
    <>
      <PageHead n={10} />
      <div className="card">
        <p className="label">{T.step10.answer}</p>
        <div className={`answer-label ${tone}`}><Icon name={icon} size={32} />{T.step10.labels[ov.result]}</div>
        <p className="row small" style={{ margin: 0 }}>{ov.rule_applied} <Origin who="rule_engine" /></p>
      </div>
      <div className="card">
        <div className="spread"><h2>{T.step10.says}</h2><Origin who={b.summary.source === "llm" ? "llm" : "rule_engine"} /></div>
        <ul className="sentences">
          {b.summary.sentences.map((s: { text: string; evidence_ids: string[] }, i: number) => (
            <li key={i}>{s.text} {s.evidence_ids.map((id) => <span key={id} style={{ marginLeft: 4 }}><IdChip id={id} onOpen={openEvidence} /></span>)}</li>
          ))}
        </ul>
      </div>
      <div className="section">
        <Details title={T.step10.rejectedTitle}>
          {rejected.length === 0 ? <Empty text={T.step10.noRejected} /> : rejected.map((e) => <EvidenceRow key={e.id} e={e} />)}
        </Details>
      </div>
      <Footer primary={T.steps[10].primary} statusOk status={T.step10.status.ready} onPrimary={() => go(11)} />
    </>
  );
}

// ---------------------------------------------------------------- step 11: What if...

interface WhatIfRow { code: string; text: string; must_have: boolean; unit: string; comparator: string; line: number; locked_line: number;
  result: string; confidence: string; why: string; evidence_ids: string[]; changed: boolean }

export function Step11() {
  const { b, cid, go, openEvidence } = useCtx();
  const sliders = b.sliders;
  const base = useMemo(() => Object.fromEntries(sliders.map((s) => [`${s.kind}:${s.key}`, s.value])), [sliders]);
  const [vals, setVals] = useState<Record<string, number>>(base);
  const [res, setRes] = useState<{ ideas: WhatIfRow[]; overall: string; overall_changed: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  const moved = Object.keys(vals).some((k) => vals[k] !== base[k]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const assumptions: Record<string, number> = {}, pass_lines: Record<string, number> = {};
      for (const s of sliders) {
        const v = vals[`${s.kind}:${s.key}`];
        if (v === s.value) continue;
        if (s.kind === "assumption") assumptions[s.key] = v; else pass_lines[s.key] = v;
      }
      try { setRes(await api("POST", `/cases/${cid}/whatif`, { assumptions, pass_lines })); } catch { /* keep the last result */ }
    }, 200);
  }, [vals, sliders, cid]);

  const hmap = Object.fromEntries(b.hypotheses.map((h) => [h.code, h]));
  const cards: CardData[] = (res?.ideas || []).map((r) => {
    const base = cardFromHypothesis(hmap[r.code]);
    return { ...(base as CardData), line: r.line, result: r.result, confidence: r.confidence, why: r.why, evidence_ids: r.evidence_ids,
      changed: r.changed, figures: (base?.figures || []).map((f) => ({ ...f, side: sideOf(f.low, f.high, r.line, r.comparator) })) };
  });
  const counted = Array.from(new Set(b.hypotheses.flatMap((h) => h.verdict?.evidence_ids || [])));
  const unknowns = b.summary?.unknowns || [];
  const [tone, icon] = ANSWER_TONE[res?.overall || b.overall?.result] || ["amber", "warn"];
  return (
    <>
      <PageHead n={11} />
      <div className="card">
        <div className="spread">
          <span className="row"><span className="label" style={{ margin: 0 }}>{T.step11.overallNow}</span>
            <span className={`answer-label ${tone}`} style={{ fontSize: "1.25rem", margin: 0 }}><Icon name={icon} size={20} />{T.step10.labels[res?.overall || b.overall?.result]}</span>
            {res?.overall_changed ? <Pill tone="amber" icon="warn">{T.step11.changed}</Pill> : null}</span>
          <span className="row"><span className="lock"><Icon name="lock" size={14} />{T.step11.lockedUnchanged}</span>
            <button type="button" className="btn small" disabled={!moved} onClick={() => setVals(base)}>{T.buttons.reset}</button></span>
        </div>
        {sliders.map((s) => {
          const k = `${s.kind}:${s.key}`;
          const v = vals[k];
          const d = v - s.value;
          const raw = (s.max - s.min) / 60;
          const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 50, 100].find((x) => x >= raw) || raw;
          return (
            <div key={k} className="slider">
              <div className="spread">
                <label htmlFor={k} className="field-label" style={{ margin: 0 }}>{s.kind === "pass_line" ? T.step11.targetOf(s.key) : s.label}
                  <span className="muted small"> · {s.kind === "pass_line" ? hmap[s.key]?.text : s.idea}</span></label>
                <span><span className="slider-val">{withUnit(v, s.unit)}</span>
                  {d !== 0 ? <span className="small muted"> · {T.step11.delta(`${d > 0 ? "+" : ""}${fmtNum(d)}`)}</span> : <span className="small muted"> · {T.step11.locked(withUnit(s.value, s.unit))}</span>}</span>
              </div>
              <input id={k} type="range" min={s.min} max={s.max} step={step} value={v} onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })} />
              <div className="spread small muted"><span>{fmtNum(s.min)}</span><span>{fmtNum(s.max)}</span></div>
            </div>
          );
        })}
      </div>
      <div className="results" style={{ marginTop: 16 }}>{cards.map((c) => <ResultCard key={c.code} c={c} />)}</div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>{T.step11.stillUnknown}</h2>
        {unknowns.length === 0 ? <Empty text={T.step11.noUnknowns} /> : (
          <ul className="sentences">{unknowns.map((u: { idea: string; text: string }, i: number) => (
            <li key={i}><span className="mono muted">{u.idea}</span> {u.text} <Origin who="llm" /></li>))}</ul>
        )}
      </div>
      <div className="section">
        <Details title={T.step11.restsOn}>
          <div className="row wrap">
            {counted.map((id) => {
              const e = b.evidence.find((x) => x.id === id);
              return <span key={id} className="row small" style={{ marginRight: 12 }}><IdChip id={id} onOpen={openEvidence} />
                {e?.decided_by === "consultant" ? T.step11.checkedByYou : T.step11.passedCheck}</span>;
            })}
          </div>
        </Details>
      </div>
      <Footer primary={T.steps[11].primary} status={T.step11.status} onPrimary={() => go(12)} />
    </>
  );
}

function sideOf(low: number, high: number, L: number, cmp: string): string {
  const d = cmp === ">=" ? 1 : -1;
  if (low !== high && low <= L && L <= high) return ((low + high) / 2 - L) * d >= 0 ? "pass" : "fail";
  const nearest = Math.abs(low - L) <= Math.abs(high - L) ? low : high;
  return (nearest - L) * d >= 0 ? "pass" : "fail";
}

// ---------------------------------------------------------------- step 12: Your conclusion

export function Step12() {
  const { b, cid, act } = useCtx();
  const saved = b.conclusion?.saved_at;
  const [text, setText] = useState<string>(b.conclusion?.text || "");
  const c = b.case;
  const kept = b.hypotheses.filter((h) => !h.removed_reason);
  const k = b.counts;
  const unknowns = b.summary?.unknowns || [];
  const ov = b.overall;
  const dirty = text !== (b.conclusion?.text || "");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <>
      <PageHead n={12} />
      <div className="doc">
        <h1>{T.step12.summaryTitle}: {c.title}</h1>
        <div className="meta">{[c.client_name, c.country, c.industry, c.function].filter(Boolean).join(" · ")} · {T.step12.preparedOn(today)}</div>
        <p className="principle">{T.app.principle}</p>
        <h3>{T.step12.ask}</h3>
        <p style={{ margin: 0 }}>{c.raw_ask}</p>
        <h3>{T.step12.results}</h3>
        <table className="t">
          <thead><tr><th>{T.step12.colIdea}</th><th>{T.step12.colTarget}</th><th>{T.step12.colResult}</th><th>{T.step12.colConfidence}</th></tr></thead>
          <tbody>{kept.map((h) => (
            <tr key={h.code}>
              <td><span className="mono muted">{h.code}</span> {h.text}{h.must_have ? <span className="small muted"> · {T.results.critical}</span> : null}</td>
              <td className="nowrap">{h.comparator === ">=" ? T.step3.atLeast : T.step3.atMost} {h.line_text}</td>
              <td>{h.verdict ? <ResultPill result={h.verdict.result} /> : null}</td>
              <td>{h.verdict && h.verdict.confidence !== "none" ? T.results.confidence[h.verdict.confidence] : ""}</td>
            </tr>))}</tbody>
        </table>
        <h3>{T.step12.answer}</h3>
        {ov ? <p style={{ margin: 0 }}><b>{T.step10.labels[ov.result]}.</b> {ov.rule_applied}</p> : null}
        <h3>{T.step12.gaps}</h3>
        {unknowns.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{unknowns.map((u: { idea: string; text: string }, i: number) => <li key={i}><span className="mono">{u.idea}</span> {u.text}</li>)}</ul>
          : <p className="muted" style={{ margin: 0 }}>{T.step12.noGaps}</p>}
        <h3>{T.step12.evidenceCounts}</h3>
        <p style={{ margin: 0 }}>{T.step12.counts(k)}</p>
        <h3>{T.step12.conclusion}</h3>
        <span className="hint no-print">{T.step12.conclusionHint}</span>
        <textarea className="conclusion-box" aria-label={T.step12.conclusion} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="print-conclusion">{text}</div>
        {saved ? <p className="small muted no-print">{T.step12.saved(fmtDate(saved))}</p> : null}
        {c.sample ? <p className="small muted">{T.app.sampleTag}</p> : null}
      </div>
      <div className="section no-print">
        <Details title={T.step12.audit}>
          <table className="t"><tbody>
            {Object.entries(T.step12.auditRows).map(([key, label]) => <tr key={key}><td>{label}</td><td className="num">{k[key]}</td></tr>)}
          </tbody></table>
          <p className="small"><a href={`/api/cases/${cid}/activity?format=csv`}>{T.buttons.exportCsv}</a></p>
        </Details>
      </div>
      <Footer primary={T.steps[12].primary} disabled={!text.trim() || (!!saved && !dirty)} statusOk={!!saved && !dirty}
        status={saved && !dirty ? <><Icon name="tick" />{T.step12.status.saved}</> : text.trim() ? T.step12.status.ready : T.step12.status.empty}
        onPrimary={() => act(() => api("PUT", `/cases/${cid}/conclusion`, { text }))}
        extra={<span className="row no-print">
          <button type="button" className="linkbtn small" onClick={() => window.print()}>{T.buttons.printPdf}</button>
          <button type="button" className="linkbtn small" onClick={() => download(`/api/cases/${cid}/export?format=md`)}>{T.buttons.downloadMarkdown}</button>
          <button type="button" className="linkbtn small" onClick={() => download(`/api/cases/${cid}/export?format=json`)}>{T.buttons.downloadJson}</button>
        </span>} />
    </>
  );
}

