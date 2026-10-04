import { useEffect, useState } from "react";
import { api } from "../api/client";
import { errMsg, go } from "../App";
import { ErrorNote, Who, useConfirm } from "../components/ui";
import { PRINCIPLE, STEPS } from "../copy";

export function Home({ onHelp, mode }: { onHelp: () => void; mode?: string }) {
  const [cases, setCases] = useState<any[] | null>(null);
  const [samples, setSamples] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const load = () => {
    api("GET", "/cases").then(setCases).catch((e) => setErr(errMsg(e)));
    api("GET", "/samples").then(setSamples).catch(() => setSamples([]));
  };
  useEffect(load, []);
  const newCase = async () => {
    setBusy(true);
    try { const r = await api("POST", "/cases", {}); go(`#/case/${r.id}/1`); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const loadSample = async (name: string) => {
    setBusy(true);
    try { const r = await api("POST", `/samples/${name}/load`); go(`#/case/${r.id}/1`); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (c: any) => {
    if (!(await confirm("Delete this case?", `"${c.title}" and its activity record will be deleted for good. This can't be undone.`, "Delete case", true))) return;
    try { await api("DELETE", `/cases/${c.id}`); load(); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div className="home stack">
      <section className="hero">
        <div className="row"><span className={`modechip ${mode || "fixtures"}`} style={{ background: "rgba(255,255,255,.12)", color: "#fff", borderColor: "rgba(255,255,255,.4)" }}>{mode === "live" ? "● Live" : "● Fixture mode"}</span></div>
        <h1>Research Workbench</h1>
        <p className="principle">{PRINCIPLE}</p>
        <div className="actors">
          <Who k="consultant" /><Who k="model" /><Who k="rule" /><Who k="client" /><Who k="expert" />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary lg" onClick={newCase} disabled={busy}>New case</button>
          {samples[0] && <button className="btn lg" onClick={() => loadSample(samples[0].name)} disabled={busy}>Load a sample case</button>}
          <button className="linkbtn" style={{ color: "#fff", marginLeft: 8 }} onClick={onHelp}>How it works: the 12 steps</button>
        </div>
      </section>
      {err && <ErrorNote message={err} onRetry={() => { setErr(null); load(); }} />}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <section className="card">
          <div className="card-head"><h2>Your cases</h2>{cases && <span className="countbadge">{cases.length}</span>}</div>
          {!cases && <p className="muted">Loading…</p>}
          {cases && cases.length === 0 && <div className="empty">No cases yet. Start a new case, or load a sample case to see the full journey.</div>}
          {cases && cases.length > 0 && (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Case</th><th>Current step</th><th>Last updated</th><th></th></tr></thead>
              <tbody>{cases.map((c) => (
                <tr key={c.id}>
                  <td><a href={`#/case/${c.id}`} style={{ fontWeight: 600 }}>{c.title || "Untitled case"}</a>{c.sample && <div className="sim">Sample data (simulated)</div>}</td>
                  <td>{c.status === "concluded" ? "Concluded ✓" : `${c.current_step}. ${STEPS[c.current_step - 1]?.short}`}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{new Date(c.updated_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <a className="btn sm" href={`#/case/${c.id}`}>Open</a>
                    <button className="btn sm danger" onClick={() => del(c)} aria-label={`Delete ${c.title}`}>Delete</button></div></td>
                </tr>))}
              </tbody></table></div>
          )}
        </section>
        <section className="card stack-s">
          <div className="card-head"><h2>Sample cases</h2><span className="help">Stored, simulated data that runs all 12 steps without live keys.</span></div>
          {samples.map((s) => (
            <div className="samplecard" key={s.name}>
              <div className="row"><b>{s.title}</b><span className="spacer" /><span className="pill grey">{s.country} · {s.industry}</span></div>
              <p className="small muted">{s.description}</p>
              <div><button className="btn sm navy" onClick={() => loadSample(s.name)} disabled={busy}>Load this sample</button></div>
            </div>
          ))}
          <p className="small muted">The tool is general: nothing about a client, sector or country is built in. Everything that varies is case data.</p>
        </section>
      </div>
    </div>
  );
}
