import { useState } from "react";
import type { Evidence, Hypothesis } from "../api/types";
import { ORIGIN_LABEL, ROLE_LABEL } from "../copy";
import { StatusPill, TierBadge, figText, Sim } from "./ui";

export interface DecideFn {
  (eid: string, action: string, reason?: string, confirmFormula?: boolean): Promise<void>;
}

function highlight(text: string, quotes: string[]) {
  const qs = quotes.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!qs.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const marks: [number, number][] = [];
  for (const q of qs) {
    const i = lower.indexOf(q.toLowerCase());
    if (i >= 0 && !marks.some(([a, b]) => i < b && i + q.length > a)) marks.push([i, i + q.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: (string | JSX.Element)[] = [];
  let pos = 0;
  marks.forEach(([a, b], k) => {
    out.push(text.slice(pos, a));
    out.push(<mark key={k}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  out.push(text.slice(pos));
  return <>{out}</>;
}

function cleanText(t: string) {
  return t.replace(/## Sheet: ([^\n]+)/g, "Sheet $1:").replace(/\[(?:[^\]!]+!)?[A-Z]{1,3}\d+\] /g, "").replace(/\[line \d+\] /g, "").replace(/ \| /g, " · ");
}

export function EvidenceCard({ e, hyps, mode, onDecide, onLinks, onSeen, readOnly, defaultOpen, highlightNeeded }: {
  e: Evidence; hyps: Hypothesis[]; mode: "decide" | "view" | "auto"; onDecide?: DecideFn;
  onLinks?: (eid: string, rows: { hypothesis_code: string; role: string; figure_index: number }[]) => Promise<void>;
  onSeen?: (eid: string, send?: boolean) => Promise<void>; readOnly?: boolean; defaultOpen?: boolean; highlightNeeded?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [confirmF, setConfirmF] = useState(false);
  const [editLinks, setEditLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const failing = e.checklist_json.filter((t) => !t.pass).map((t) => t.test);
  const derived = e.figures_json.map((f, i) => ({ f, i })).filter((x) => x.f.kind === "calculated");
  const unconfirmed = derived.some((x) => !x.f.derivation?.formula_confirmed);
  const isClient = e.origin_type === "client_file";
  const keepable = new Set(["needs_decision"]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const decide = (action: string, r = "") => run(() => onDecide!(e.id, action, r, confirmF));
  const visibleLinks = e.links.filter((l) => l.role !== "sets_pass_line" || e.status === "pass_line_source");

  return (
    <div className="ev" id={`ev-${e.id}`} style={highlightNeeded ? { borderColor: "var(--warn)" } : undefined}>
      <button className="ev-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="echip" style={{ cursor: "inherit" }}>{e.id}</span>
        <span className="ev-claim">{e.claim}{e.figures_json.length > 1 ? ` (+${e.figures_json.length - 1})` : ""}
          <span className="muted" style={{ fontWeight: 400 }}> · {e.title}</span></span>
        <TierBadge tier={e.tier} />
        {e.date && <span className="mono small muted">{e.date}</span>}
        <StatusPill e={e} />
        <span className="muted small" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {!open && mode === "decide" && failing.length > 0 && e.status === "needs_decision" && (
        <div className="failing" style={{ padding: "0 12px 10px" }}>Failing: {failing.join(", ")}</div>
      )}
      {open && (
        <div className="ev-body">
          <div className="row small">
            <span className="muted">{ORIGIN_LABEL[e.origin_type] || e.origin_type}</span>
            <span>·</span>
            {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source_name} ↗</a> : <span>{e.source_name}</span>}
            {e.publisher && e.publisher !== e.source_name && <span className="muted">· {e.publisher}</span>}
            {e.simulated && <Sim />}
          </div>
          {e.text && <div className="quote">{highlight(cleanText(e.text), e.figures_json.map((f) => f.quote_span || ""))}</div>}
          {e.figures_json.length > 0 && (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>#</th><th>Figure</th><th>Period</th><th>Where</th><th>Check</th></tr></thead>
              <tbody>{e.figures_json.map((f, i) => (
                <tr key={i}>
                  <td className="mono">F{i}</td>
                  <td className="mono">{figText(f)}{f.kind === "calculated" && <span className="pill rule" style={{ marginLeft: 6 }}>calculated</span>}</td>
                  <td>{f.period || "—"}</td>
                  <td className="mono">{f.locator || (f.kind === "calculated" ? "computed" : "—")}</td>
                  <td>{f.verified ? <span className="icon-pass">✓ </span> : <span className="icon-fail">✕ could not verify · </span>}
                    <span className="muted">{f.verify_note}</span></td>
                </tr>))}
              </tbody></table></div>
          )}
          {derived.map(({ f, i }) => (
            <div className="derivation" key={i}>
              <div className="row"><b>Derived figure F{i}</b><span className="muted">proposed by the language model, computed by the rule engine</span></div>
              <div className="formula">{f.derivation!.formula}{f.unit && !f.derivation!.formula.trim().endsWith("%") ? ` ${f.unit}` : f.unit.replace(/^%\s*/, " ")}</div>
              <div>{f.derivation!.rationale}</div>
              {!f.derivation!.unit_ok && <div className="failing">! Unit check needs your confirmation</div>}
              {!f.derivation!.years_ok && <div className="failing">! {f.derivation!.note}</div>}
              <div>{f.derivation!.formula_confirmed ? <span className="icon-pass">✓ Formula confirmed by the consultant</span>
                : <span className="failing">Formula not yet confirmed. The derived figure does not count until it is.</span>}</div>
            </div>
          ))}
          {e.checklist_json.length > 0 && (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Checklist test</th><th>Threshold</th><th>Actual</th><th>Result</th></tr></thead>
              <tbody>{e.checklist_json.map((t) => (
                <tr key={t.test}><td>{t.test}</td><td className="muted">{t.threshold}</td><td>{t.actual}</td>
                  <td>{t.pass ? <span className="icon-pass">✓ pass</span> : <span className="icon-fail">✕ fail</span>}</td></tr>))}
              </tbody></table></div>
          )}
          {e.credibility_json?.tier_reason && <div className="small muted">Tier: {e.credibility_json.tier_reason}.</div>}
          {e.duplicate_of && <div className="small">Copy of <b>{e.duplicate_of}</b> ({e.duplicate_rule}). Counted once, through its original.</div>}
          {e.copies.length > 0 && <div className="small">This original is also quoted by: {e.copies.join(", ")}. They count once.</div>}
          <div className="row small">
            <b>Links:</b>
            {visibleLinks.length === 0 && <span className="muted">none</span>}
            {visibleLinks.map((l) => (
              <span key={l.id} className="pill grey">{l.hypothesis_code} · {ROLE_LABEL[l.role]} · F{l.figure_index}{l.proposed_by === "consultant" ? " · by you" : ""}</span>
            ))}
            {!readOnly && onLinks && mode !== "view" && <button className="linkbtn" onClick={() => setEditLinks(!editLinks)}>{editLinks ? "Close" : "Change link"}</button>}
          </div>
          {editLinks && onLinks && <LinkEditor e={e} hyps={hyps} onSave={async (rows) => { await onLinks(e.id, rows); setEditLinks(false); }} />}
          {e.decision_reason && <div className="small"><b>Reason:</b> {e.decision_reason}</div>}
          {!readOnly && mode === "auto" && onSeen && (
            <div className="actions">
              {e.url && <a className="btn sm" href={e.url} target="_blank" rel="noreferrer">Open source ↗</a>}
              <button className="btn sm pass" disabled={busy || e.seen_by_consultant} onClick={() => run(() => onSeen(e.id))}>{e.seen_by_consultant ? "Seen ✓" : "Seen"}</button>
              <button className="btn sm" disabled={busy} onClick={() => run(() => onSeen(e.id, true))}>Send to my review</button>
            </div>
          )}
          {!readOnly && mode === "decide" && keepable.has(e.status) && onDecide && (
            <div className="col">
              {derived.length > 0 && (
                <label className="check"><input type="checkbox" checked={confirmF} onChange={(x) => setConfirmF(x.target.checked)} />
                  I confirm the formula{derived.length > 1 ? "s" : ""} above</label>
              )}
              <div className="actions">
                <button className="btn sm pass" disabled={busy || (unconfirmed && !confirmF && derived.some((x) => e.links.some((l) => l.figure_index === x.i && l.role === "supports_test")))}
                  onClick={() => decide("approve")}>✓ Approve</button>
                {isClient && <button className="btn sm" disabled={busy} onClick={() => decide("keep_client_reported")}>Keep as client-reported</button>}
                {e.origin_type === "client_file" && <button className="btn sm" disabled={busy} onClick={() => decide("keep_belief")}>Keep as the claim being tested</button>}
                <button className="btn sm" disabled={busy} onClick={() => decide("keep_cross_check")}>Keep as cross-check</button>
                <button className="btn sm danger" disabled={busy} onClick={() => setRejecting(!rejecting)}>✕ Reject</button>
              </div>
              {rejecting && (
                <div className="row">
                  <input className="input sm" style={{ maxWidth: 380 }} placeholder="Reason (required), for example: no method shown"
                    value={reason} onChange={(x) => setReason(x.target.value)} aria-label="Reason for rejecting" />
                  <button className="btn sm danger" disabled={busy || !reason.trim()} onClick={() => decide("reject", reason)}>Reject with this reason</button>
                </div>
              )}
              {unconfirmed && <div className="small muted">An item with an unconfirmed formula cannot be approved.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LinkEditor({ e, hyps, onSave }: { e: Evidence; hyps: Hypothesis[]; onSave: (rows: { hypothesis_code: string; role: string; figure_index: number }[]) => Promise<void> }) {
  const kept = hyps.filter((h) => !h.removed_reason);
  const start = e.links.filter((l) => l.role !== "sets_pass_line").map((l) => ({ hypothesis_code: l.hypothesis_code, role: l.role, figure_index: l.figure_index }));
  const [rows, setRows] = useState(start.length ? start : [{ hypothesis_code: kept[0]?.code || "", role: "supports_test", figure_index: 0 }]);
  const set = (i: number, k: string, v: string | number) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="card tight col">
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <select className="input sm" style={{ width: 90 }} value={r.hypothesis_code} onChange={(x) => set(i, "hypothesis_code", x.target.value)} aria-label="Idea">
            {kept.map((h) => <option key={h.code} value={h.code}>{h.code}</option>)}
          </select>
          <select className="input sm" style={{ width: 190 }} value={r.role} onChange={(x) => set(i, "role", x.target.value)} aria-label="Role">
            <option value="supports_test">supports the test</option><option value="cross_check">cross-check</option><option value="context">context</option>
          </select>
          <select className="input sm" style={{ width: 80 }} value={r.figure_index} onChange={(x) => set(i, "figure_index", Number(x.target.value))} aria-label="Figure">
            {e.figures_json.map((_, k) => <option key={k} value={k}>F{k}</option>)}
          </select>
          <button className="btn sm ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove link">✕</button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setRows([...rows, { hypothesis_code: kept[0]?.code || "", role: "context", figure_index: 0 }])}>Add a link</button>
        <span className="spacer" />
        <button className="btn sm navy" onClick={() => onSave(rows)}>Save links</button>
      </div>
    </div>
  );
}
