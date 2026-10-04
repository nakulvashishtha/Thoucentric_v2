import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GLOSSARY, PRINCIPLE, STEPS } from "../copy";

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="help-t">
        <div className="drawer-head"><h2 id="help-t">How it works</h2><span className="spacer" /><button className="btn sm ghost" onClick={onClose} aria-label="Close help">✕</button></div>
        <div className="drawer-body stack">
          <p>{PRINCIPLE}</p>
          <div>
            <h3 style={{ marginBottom: 8 }}>The 12 steps</h3>
            <div className="tblwrap"><table className="tbl"><thead><tr><th>#</th><th>Step</th><th>Who signs off</th></tr></thead><tbody>
              {STEPS.map((s) => (
                <tr key={s.n}><td className="mono">{s.n}</td><td><b>{s.short}.</b> {s.what.split(". ")[0]}.</td>
                  <td>{s.signoff ? <span style={{ color: "var(--c-consultant)", fontWeight: 600 }}>✎ {s.signoff}</span> : <span className="muted">No sign-off</span>}</td></tr>
              ))}
            </tbody></table></div>
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Glossary</h3>
            <dl style={{ margin: 0 }}>
              {Object.entries(GLOSSARY).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 10 }}><dt style={{ fontWeight: 700, color: "var(--navy)" }}>{k[0].toUpperCase() + k.slice(1)}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
              ))}
            </dl>
          </div>
          <div className="small muted">
            <b>Who does what.</b> The language model reads, writes and sorts; it never decides a verdict, confidence, approval, tier or recommendation.
            The rule engine is plain code: maths, rules and verdicts. The consultant signs off at every step that matters and writes the conclusion.
          </div>
        </div>
      </aside>
    </>
  );
}

export function SettingsDrawer({ onClose, caseMode }: { onClose: () => void; caseMode?: string }) {
  const [s, setS] = useState<any>(null);
  const [tab, setTab] = useState<"rules" | "registry">("rules");
  useEffect(() => { api("GET", "/settings").then(setS).catch(() => setS({ error: true })); }, []);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="set-t">
        <div className="drawer-head"><h2 id="set-t">Settings</h2><span className="spacer" /><button className="btn sm ghost" onClick={onClose} aria-label="Close settings">✕</button></div>
        <div className="drawer-body stack">
          {!s && <p className="muted">Loading…</p>}
          {s?.error && <p className="muted">Settings could not be loaded.</p>}
          {s && !s.error && (
            <>
              <div className="card">
                <h3>Mode</h3>
                <p style={{ margin: "6px 0" }}>App mode: <span className={`modechip ${s.mode}`}>{s.mode === "live" ? "Live" : "Fixture mode"}</span>
                  {caseMode && <> · this case: <span className={`modechip ${caseMode}`}>{caseMode === "live" ? "Live" : "Fixture mode"}</span></>}</p>
                {s.notice && <p className="small" style={{ color: "var(--warn)", fontWeight: 600 }}>{s.notice}. The app opened in fixture mode with stored sample responses.</p>}
                <p className="small muted">Live AI and search, the self-check, spending caps and the cost ledger are added in the live layer.</p>
              </div>
              <div className="card">
                <h3>Fast-demo preset</h3>
                <p className="small muted" style={{ marginTop: 4 }}>On: at most 4 sources per need, 6 searches and 6 reads at once, 40-second timeout, one retry.</p>
              </div>
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h3>Rules and source registry</h3><span className="pill grey">read-only</span><span className="spacer" />
                  <button className={`btn sm ${tab === "rules" ? "navy" : ""}`} onClick={() => setTab("rules")}>rules.yaml</button>
                  <button className={`btn sm ${tab === "registry" ? "navy" : ""}`} onClick={() => setTab("registry")}>source_registry.yaml</button>
                </div>
                <pre className="prebox mono" style={{ maxHeight: 420, overflow: "auto", fontFamily: "var(--mono)" }}>{tab === "rules" ? s.rules_yaml : s.registry_yaml}</pre>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
