import { useState } from "react";
import { api } from "../api/client";
import type { Evidence, Figure } from "../api/types";
import * as T from "../copy";
import { evidenceById, useCtx } from "../state";
import { Details, Drawer, Icon, IdChip, Menu, Origin, Quality, StatusPill, fmtNum, withUnit } from "./ui";

export function figureText(f: Figure): string {
  if (f.value != null) return withUnit(f.value, f.unit);
  return `${fmtNum(f.low)} to ${withUnit(f.high, f.unit)}`;
}

export function readable(text: string): string {
  return (text || "").replace(/^##\s*Sheet:.*$/gm, "").replace(/\[[^\]\n]*![A-Z]+\d+\]\s*/g, "").replace(/\s*\|\s*/g, " · ").replace(/[ \t]+/g, " ").trim();
}

function Quote({ e }: { e: Evidence }) {
  const f = (e.figures_json || []).find((x) => x.kind !== "calculated" && x.quote_span);
  const text = readable(e.text);
  if (!f || !f.quote_span) return text ? <div className="quote">{text.slice(0, 320)}</div> : <p className="muted small">{T.step7.noQuote}</p>;
  const i = text.indexOf(f.quote_span);
  if (i < 0) return <div className="quote">{f.quote_span}</div>;
  const dot = text.lastIndexOf(". ", i);
  const start = Math.max(0, dot >= 0 && i - dot < 220 ? dot + 2 : i - 120);
  const endDot = text.indexOf(". ", i + f.quote_span.length);
  const end = Math.min(text.length, endDot >= 0 && endDot - i < 220 ? endDot + 1 : i + f.quote_span.length + 120);
  return (
    <div className="quote">
      {start > 0 ? "… " : ""}{text.slice(start, i).trimStart()}<mark>{f.quote_span}</mark>{text.slice(i + f.quote_span.length, end)}
      {end < text.length ? " …" : ""}
    </div>
  );
}

function Figures({ e }: { e: Evidence }) {
  const figs = e.figures_json || [];
  if (!figs.length) return null;
  return (
    <div className="row wrap small" style={{ marginTop: 10 }}>
      {figs.map((f, i) => (
        <span key={i} className="row" style={{ gap: 4 }}>
          <b className="mono">{figureText(f)}</b>{f.period ? <span className="muted">({f.period})</span> : null}
          {f.kind === "calculated" ? <Origin who="rule_engine" /> : null}
          {f.verified === false ? <span className="pill amber"><Icon name="warn" />{T.step7.notVerified}</span> : null}
          {i < figs.length - 1 ? <span className="muted">·</span> : null}
        </span>
      ))}
    </div>
  );
}

// The app works the figure out; accepting the item checks the formula. No separate confirm step.
function Calculation({ e }: { e: Evidence }) {
  const calc = (e.figures_json || []).filter((f) => f.kind === "calculated" && f.derivation);
  if (!calc.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <p className="label">{T.step7.formula}</p>
      {calc.map((f, i) => {
        const d = f.derivation!;
        const inputs = d.input_figure_refs.map((r) => e.figures_json[r]).filter(Boolean);
        const done = d.formula_confirmed;
        return (
          <div key={i} className="stack-sm">
            <div className="formula">{d.formula}</div>
            <div className="small muted">{T.step7.formulaInputs}: {inputs.map((x) => `${figureText(x)}${x.locator ? ` (${x.locator})` : ""}`).join(" · ")}</div>
            {!d.unit_ok || d.years_ok === false ? <div className="pill amber"><Icon name="warn" />{T.step7.formulaUnitCheck}</div> : null}
            {done ? <span className="pill green"><Icon name="tick" />{T.step7.formulaConfirmed}</span>
              : e.formula_needs_you ? <div className="pill amber"><Icon name="warn" />{T.step7.formulaNeedsYou}</div>
                : <div className="small muted">{T.step7.formulaAuto}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Checks({ e }: { e: Evidence }) {
  if (!e.checklist_json?.length) return null;
  return (
    <table className="t">
      <thead><tr><th>{T.step7.checkTest}</th><th>{T.step7.checkNeeds}</th><th>{T.step7.checkFound}</th></tr></thead>
      <tbody>
        {e.checklist_json.map((c) => (
          <tr key={c.test}>
            <td><span className="row" style={{ gap: 6 }}>
              <span style={{ color: c.pass ? "var(--pass)" : "var(--fail)", display: "inline-flex" }}>
                <Icon name={c.pass ? "tick" : "cross"} title={c.pass ? T.step7.pass : T.step7.fail} /></span>{c.test}</span></td>
            <td className="muted">{c.threshold}</td>
            <td>{c.actual}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinksEditor({ e, editable }: { e: Evidence; editable: boolean }) {
  const { b, cid, act } = useCtx();
  const ideas = b.hypotheses.filter((h) => !h.removed_reason);
  const editableLinks = e.links.filter((l) => l.role !== "sets_pass_line");
  const [rows, setRows] = useState(editableLinks.map((l) => ({ hypothesis_code: l.hypothesis_code, role: l.role, figure_index: l.figure_index })));
  const roles = ["supports_test", "cross_check", "context"];
  if (!editableLinks.length && !editable) return null;
  return (
    <div className="stack-sm">
      {rows.map((r, i) => (
        <div key={i} className="row">
          <select aria-label={T.step7.links} value={r.hypothesis_code} disabled={!editable}
            onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, hypothesis_code: ev.target.value } : x)))}>
            {ideas.map((h) => <option key={h.code} value={h.code}>{h.code}: {h.text}</option>)}
          </select>
          <select aria-label={T.step7.role} value={r.role} disabled={!editable} style={{ maxWidth: 220 }}
            onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, role: ev.target.value } : x)))}>
            {roles.map((ro) => <option key={ro} value={ro}>{T.step7.roles[ro]}</option>)}
          </select>
        </div>
      ))}
      {editable ? (
        <button type="button" className="btn small" onClick={() => act(() => api("PUT", `/cases/${cid}/evidence/${e.id}/links`, rows))}>
          {T.buttons.saveLinks}
        </button>
      ) : null}
    </div>
  );
}

export function SourceLine({ e }: { e: Evidence }) {
  const name = e.publisher || e.source_name || e.domain;
  return e.url ? (
    <a href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>{name} <Icon name="ext" size={12} /></a>
  ) : <span>{name}</span>;
}

// One evidence row everywhere: id, claim, source, quality, status. Expands for the quote, checks and decisions.
export function EvidenceRow({ e, decide = false, linksEditable = false, startOpen = false }:
  { e: Evidence; decide?: boolean; linksEditable?: boolean; startOpen?: boolean }) {
  const { cid, act, openEvidence, readOnly, b } = useCtx();
  const [open, setOpen] = useState(startOpen);
  const [rejecting, setRejecting] = useState(false);
  const [other, setOther] = useState(false);
  const [reason, setReason] = useState("");
  const confirm = !!e.formula_needs_you;
  const failing = (e.checklist_json || []).filter((c) => !c.pass).map((c) => c.test);
  const canDecide = decide && !readOnly && e.status === "needs_decision";
  const send = (action: string, why = "") => act(() => api("POST", `/cases/${cid}/evidence/${e.id}/decision`,
    { action, reason: why, confirm_formula: confirm && (action === "approve" || action === "keep_client_reported") }));
  const accept = [
    { label: confirm ? T.buttons.acceptConfirmFormula : T.buttons.accept, onClick: () => send("approve") },
    { label: confirm ? T.step7.acceptClientFormula : T.buttons.acceptClient, onClick: () => send("keep_client_reported") },
    { label: T.buttons.useClaim, onClick: () => send("keep_belief") },
    { label: T.buttons.useSenseCheck, onClick: () => send("keep_cross_check") },
  ];
  const ideaCodes = Array.from(new Set(e.links.map((l) => l.hypothesis_code)));
  return (
    <div className="ev">
      <div className="ev-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)}
        onKeyDown={(k) => { if (k.key === "Enter") setOpen(!open); }}>
        <IdChip id={e.id} onOpen={openEvidence} />
        <div className="ev-claim">
          <div className="t1">{e.claim || e.title}</div>
          <div className="t2"><SourceLine e={e} />{ideaCodes.length ? <span> · {ideaCodes.join(", ")}</span> : null}
            {canDecide && failing.length ? <span> · {failing[0]}</span> : null}
            {e.status === "rejected" && e.decision_reason ? <span> · {e.decision_reason}</span> : null}</div>
        </div>
        <Quality tier={e.tier} />
        <StatusPill status={e.status} duplicateOf={e.duplicate_of} />
        <Icon name="chevron" size={14} />
      </div>
      {open ? (
        <div className="ev-body">
          <Quote e={e} />
          <Figures e={e} />
          {e.decision_reason ? <p className="small">{T.evidence.decidedReason(e.decision_reason)}</p> : null}
          {e.copies?.length ? <p className="small muted">{T.step7.copiesOf(e.copies.join(", "))}</p> : null}
          <Calculation e={e} />
          {canDecide ? (
            <div className="decide-bar">
              <Menu label={T.buttons.acceptMenu} items={accept} />
              <button type="button" className={`btn small${rejecting ? " active" : ""}`} aria-expanded={rejecting}
                onClick={() => { setRejecting(!rejecting); setOther(false); }}>{T.buttons.reject}</button>
            </div>
          ) : null}
          {canDecide && rejecting ? (
            <div className="reject-reasons">
              <p className="label">{T.step7.rejectReason}</p>
              <div className="row wrap">
                {T.step7.rejectReasons.map((r) => (
                  <button key={r} type="button" className="btn small" onClick={() => { setRejecting(false); void send("reject", r); }}>{r}</button>
                ))}
                <button type="button" className={`btn small${other ? " active" : ""}`} onClick={() => setOther(true)}>{T.step7.rejectOther}</button>
              </div>
              {other ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <input type="text" value={reason} autoFocus placeholder={T.step7.rejectHint} aria-label={T.step7.rejectHint}
                    onChange={(ev) => setReason(ev.target.value)} />
                  <button type="button" className="btn small" onClick={() => {
                    setRejecting(false); void send("reject", reason.trim() ? `${T.step7.rejectOther}: ${reason.trim()}` : T.step7.rejectOther);
                  }}>{T.buttons.reject}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          <Details inline title={T.app.details}>
            <div className="stack">
              {e.checklist_json?.length ? <div><p className="label">{canDecide ? T.step7.why : T.step7.checks}</p><Checks e={e} /></div> : null}
              {e.links.length || linksEditable ? <div><p className="label">{T.step7.links}</p>
                <LinksEditor e={e} editable={linksEditable && !readOnly && !b.progress.done["7"]} /></div> : null}
              <p className="small muted">{T.evidence.origins[e.origin_type] || e.origin_type}
                {e.date ? ` · ${e.date}` : ` · ${T.evidence.undated}`}{e.simulated ? ` · ${T.app.sampleTag}` : ""}</p>
            </div>
          </Details>
        </div>
      ) : null}
    </div>
  );
}

export function EvidencePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { b } = useCtx();
  const e = evidenceById(b, id);
  if (!e) return null;
  return (
    <Drawer title={`${e.id} · ${e.title}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row wrap"><Quality tier={e.tier} /><StatusPill status={e.status} duplicateOf={e.duplicate_of} />
          <span className="small muted">{T.evidence.origins[e.origin_type]}{e.date ? ` · ${e.date}` : ""}</span></div>
        <div><SourceLine e={e} /></div>
        <Quote e={e} />
        <Figures e={e} />
        {e.decision_reason ? <p className="small">{T.evidence.decidedReason(e.decision_reason)}</p> : null}
        {e.checklist_json?.length ? <div><p className="label">{T.step7.checks}</p><Checks e={e} /></div> : null}
        {e.text ? <div><p className="label">{T.step7.quote}</p><div className="quote" style={{ whiteSpace: "pre-wrap" }}>{readable(e.text)}</div></div> : null}
        {e.simulated ? <p className="small muted">{T.app.sampleTag}</p> : null}
      </div>
    </Drawer>
  );
}
