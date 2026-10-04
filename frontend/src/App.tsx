import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, upload } from "./api/client";
import type { ActivityRow, Bundle } from "./api/types";
import * as T from "./copy";
import { Ctx, CaseCtx, useCase } from "./state";
import { Details, Dialog, Drawer, Empty, ErrorBoundary, Icon, Origin, Skeleton, Toggle, fmtDate } from "./components/ui";
import { EvidencePanel } from "./components/Evidence";
import { STEP_VIEWS } from "./pages/steps";

// ---------------------------------------------------------------- routing: #/  ·  #/case/12  ·  #/case/12/step/4

function useRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const f = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return [hash, (h: string) => { window.location.hash = h; }];
}

function useNarrow(): boolean {
  const [n, setN] = useState(window.innerWidth < 900);
  useEffect(() => {
    const f = () => setN(window.innerWidth < 900);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return n;
}

interface AppSettings { mode: string; notice: string; keys: Record<string, boolean>; app: { mode: string; fast_demo: boolean; larger_text: boolean };
  rules_yaml: string; registry_yaml: string }

function useSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const load = useCallback(async () => {
    try {
      const v = await api<AppSettings>("GET", "/settings");
      setS(v);
      document.documentElement.classList.toggle("larger", !!v.app?.larger_text);
    } catch { /* the banner row shows load errors elsewhere */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (changes: Record<string, unknown>) => {
    const v = await api<AppSettings>("PUT", "/settings", changes);
    setS(v);
    document.documentElement.classList.toggle("larger", !!v.app?.larger_text);
  };
  return { s, save };
}

export default function App() {
  const [hash, nav] = useRoute();
  const settings = useSettings();
  const m = hash.match(/^#\/case\/(\d+)(?:\/step\/(\d+))?/);
  if (m) return <CaseView key={m[1]} cid={Number(m[1])} step={m[2] ? Number(m[2]) : null} nav={nav} settings={settings} />;
  return <Home nav={nav} settings={settings} />;
}

// ---------------------------------------------------------------- top bar

function TopBar({ caseName, onHome, onHistory, onHelp, onSettings }:
  { caseName?: string; onHome: () => void; onHistory?: () => void; onHelp: () => void; onSettings: () => void }) {
  return (
    <div className="spread">
      <div className="row">
        <button type="button" className="brand" onClick={onHome}>{T.app.name}</button>
        {caseName ? <span className="brand-case">· {caseName}</span> : null}
      </div>
      <nav className="topnav">
        {onHistory ? <button type="button" onClick={onHistory}>{T.app.history}</button> : null}
        <button type="button" onClick={onHelp}>{T.app.help}</button>
        <button type="button" onClick={onSettings}>{T.app.settings}</button>
      </nav>
    </div>
  );
}

function Banners({ mode, notice, extra }: { mode?: string; notice?: string; extra?: React.ReactNode }) {
  return (
    <>
      {mode === "fixtures" ? (
        <div className="banner demo" role="status"><div className="banner-inner"><Icon name="info" />
          <span>{T.banners.demo}{notice ? ` ${T.banners.noKeys}` : ""}</span></div></div>
      ) : null}
      {extra}
    </>
  );
}

// ---------------------------------------------------------------- home

interface CaseRow { id: number; title: string; current_step: number; updated_at: string; sample: string }

function Home({ nav, settings }: { nav: (h: string) => void; settings: ReturnType<typeof useSettings> }) {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [samples, setSamples] = useState<{ name: string; title: string }[]>([]);
  const [pick, setPick] = useState(false);
  const [del, setDel] = useState<CaseRow | null>(null);
  const [err, setErr] = useState("");
  const [panel, setPanel] = useState<"" | "help" | "settings">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      setCases(await api<CaseRow[]>("GET", "/cases"));
      setSamples(await api("GET", "/samples"));
    } catch (e) { setErr(e instanceof ApiError ? e.message : T.errors.generic); setCases([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    try { const r = await api<{ id: number }>("POST", "/cases", { title: T.home.newCaseTitle }); nav(`#/case/${r.id}/step/1`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : T.errors.generic); }
  };
  const loadSample = async (name: string) => {
    try { const r = await api<{ id: number }>("POST", `/samples/${name}/load`); nav(`#/case/${r.id}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : T.errors.generic); }
  };
  const trySample = () => (samples.length === 1 ? loadSample(samples[0].name) : setPick(!pick));
  const importCase = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    try { const r = await upload<{ id: number }>("/cases/import", fd); nav(`#/case/${r.id}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : T.errors.upload); }
  };

  return (
    <>
      <header className="topbar"><div className="topbar-inner">
        <TopBar onHome={() => nav("#/")} onHelp={() => setPanel("help")} onSettings={() => setPanel("settings")} />
      </div></header>
      <Banners mode={settings.s?.mode} notice={settings.s?.notice}
        extra={err ? <div className="banner error"><div className="banner-inner"><Icon name="warn" />{err}</div></div> : null} />
      <main>
        <div className="home">
          <h1>{T.app.name}</h1>
          <p className="principle">{T.app.principle}</p>
          <div className="row" style={{ justifyContent: "center", gap: 12 }}>
            <button type="button" className="btn primary" onClick={start}>{T.buttons.startCase}</button>
            <button type="button" className="btn" onClick={trySample}>{T.buttons.trySample}</button>
          </div>
          {pick ? (
            <div className="card tight" style={{ maxWidth: 480, margin: "16px auto 0", textAlign: "left" }}>
              <p className="label">{T.home.chooseSample}</p>
              {samples.map((s) => (
                <div key={s.name} className="spread" style={{ padding: "6px 0" }}>
                  <span>{s.title}</span>
                  <button type="button" className="btn small" onClick={() => loadSample(s.name)}>{T.buttons.open}</button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="home-icons">
            {T.home.icons.map((i) => <div key={i.key}><Icon name={i.key} size={36} />{i.label}</div>)}
          </div>
          <div className="home-cases">
            <div className="spread"><p className="label">{T.home.recent}</p>
              <button type="button" className="linkbtn small" onClick={() => fileRef.current?.click()}>{T.buttons.importCase}</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label={T.home.importHint}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importCase(f); e.target.value = ""; }} />
            </div>
            <div className="card tight">
              {cases === null ? <Skeleton /> : cases.length === 0 ? <Empty text={T.home.noCases} /> : (
                <table className="t">
                  <thead><tr><th>{T.home.colCase}</th><th>{T.home.colStep}</th><th>{T.home.colUpdated}</th><th /></tr></thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`#/case/${c.id}`)}>
                        <td><b>{c.title}</b>{c.sample ? <span className="muted small"> · {T.app.sampleTag}</span> : null}</td>
                        <td className="nowrap">{c.current_step}. {T.steps[c.current_step].title}</td>
                        <td className="nowrap muted">{fmtDate(c.updated_at)}</td>
                        <td className="right nowrap">
                          <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); nav(`#/case/${c.id}`); }}>{T.buttons.open}</button>{" "}
                          <button type="button" className="btn small danger" onClick={(e) => { e.stopPropagation(); setDel(c); }}>{T.buttons.delete}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>
      {del ? (
        <Dialog text={T.home.confirmDelete} confirmLabel={T.buttons.deleteCase} onCancel={() => setDel(null)}
          onConfirm={async () => { await api("DELETE", `/cases/${del.id}`); setDel(null); load(); }} />
      ) : null}
      {panel === "help" ? <HelpDrawer onClose={() => setPanel("")} /> : null}
      {panel === "settings" ? <SettingsDrawer settings={settings} onClose={() => setPanel("")} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- case view

function CaseView({ cid, step, nav, settings }: { cid: number; step: number | null; nav: (h: string) => void;
  settings: ReturnType<typeof useSettings> }) {
  if (Number.isNaN(cid)) return null;
  return <CaseInner cid={cid} step={step} nav={nav} settings={settings} />;
}

const RETRY: Record<string, (cid: number) => [string, string, unknown?]> = {
  frame: (c) => ["POST", `/cases/${c}/read-ask`],
  plan: (c) => ["POST", `/cases/${c}/plan/retry`],
  route: (c) => ["POST", `/cases/${c}/needs/retry`],
  collect: (c) => ["POST", `/cases/${c}/collect/start`],
  clean: (c) => ["POST", `/cases/${c}/clean/run`],
  addup: (c) => ["POST", `/cases/${c}/addup/run`],
};

function CaseInner({ cid, step, nav, settings }: { cid: number; step: number | null; nav: (h: string) => void;
  settings: ReturnType<typeof useSettings> }) {
  const { b, error, refresh } = useCase(cid);
  const narrow = useNarrow();
  const [panel, setPanel] = useState<"" | "history" | "help" | "settings">("");
  const [evid, setEvid] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const [toast, setToast] = useState("");

  const current = b?.progress.current ?? 1;
  const view = step ?? current;
  const go = useCallback((n: number) => nav(`#/case/${cid}/step/${Math.max(1, Math.min(12, n))}`), [cid, nav]);
  const notify = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast(""), 2600); }, []);

  const act = useCallback(async <R,>(fn: () => Promise<R>) => {
    setBusy(true);
    setActErr("");
    try {
      const r = await fn();
      await refresh();
      return r;
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : T.errors.generic);
      await refresh();
      return undefined;
    } finally { setBusy(false); }
  }, [refresh]);

  // opening a case lands on its current step; after that the view only moves when the user (or a no-sign-off step) moves it
  useEffect(() => {
    if (b && step == null) window.location.replace(`#/case/${cid}/step/${b.progress.current}`);
  }, [b, step, cid]);

  // gathering has no sign-off: when it finishes while you watch it, the view moves on with a brief notice
  const watching = useRef(false);
  useEffect(() => {
    if (!b) return;
    if (view === 5 && !b.progress.done["5"]) watching.current = true;
    else if (view === 5 && watching.current) { watching.current = false; notify(T.app.movingOn(T.steps[6].title)); go(6); }
    else if (view !== 5) watching.current = false;
  }, [b, view, go, notify]);

  if (!b) {
    return (
      <>
        <header className="topbar"><div className="topbar-inner">
          <TopBar onHome={() => nav("#/")} onHelp={() => setPanel("help")} onSettings={() => setPanel("settings")} />
        </div></header>
        <main>{error ? <div className="card"><p>{error}</p>
          <button type="button" className="btn" onClick={refresh}>{T.buttons.tryAgain}</button></div> : <Skeleton rows={5} />}</main>
      </>
    );
  }

  const stepState = b.progress.steps[view - 1];
  const readOnly = [1, 2, 3, 4, 7].includes(view) && stepState?.state === "done";
  const ctx: CaseCtx = { b, cid, view, readOnly, narrow, go, refresh, act, busy, openEvidence: setEvid, notify };
  const View = STEP_VIEWS[view].View;
  const failedHere = Object.values(b.jobs).filter((j) => j.status === "failed");

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar"><div className="topbar-inner">
        <TopBar caseName={b.case.title} onHome={() => nav("#/")} onHistory={() => setPanel("history")}
          onHelp={() => setPanel("help")} onSettings={() => setPanel("settings")} />
        <Stepper b={b} view={view} go={go} />
      </div></header>
      <Banners mode={b.mode.case} notice={b.mode.notice} extra={<>
        {narrow ? <div className="banner info"><div className="banner-inner"><Icon name="info" />{T.app.narrowNotice}</div></div> : null}
        {failedHere.map((j) => (
          <div key={j.id} className="banner error" role="alert"><div className="banner-inner"><Icon name="warn" />
            <span className="grow">{T.banners.jobFailed} {j.error}</span>
            {RETRY[j.kind] ? <button type="button" className="btn small" onClick={() => act(() => {
              const [m, p, body] = RETRY[j.kind](cid);
              return api(m, p, body);
            })}>{T.buttons.tryAgain}</button> : null}
          </div></div>
        ))}
        {actErr ? <div className="banner error" role="alert"><div className="banner-inner"><Icon name="warn" />
          <span className="grow">{actErr}</span>
          <button type="button" className="iconbtn" aria-label={T.app.close} onClick={() => setActErr("")}><Icon name="close" /></button>
        </div></div> : null}
      </>} />
      <main>
        <ErrorBoundary resetKey={view}>
          <View />
        </ErrorBoundary>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {panel === "history" ? <HistoryDrawer cid={cid} onClose={() => setPanel("")} /> : null}
      {panel === "help" ? <HelpDrawer onClose={() => setPanel("")} /> : null}
      {panel === "settings" ? <SettingsDrawer settings={settings} b={b} act={act} onClose={() => setPanel("")}
        onDeleted={() => nav("#/")} onReset={() => go(1)} /> : null}
      {evid ? <EvidencePanel id={evid} onClose={() => setEvid("")} /> : null}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- stepper: 12 dots in three groups

function Stepper({ b, view, go }: { b: Bundle; view: number; go: (n: number) => void }) {
  const steps = b.progress.steps;
  const cur = b.progress.current;
  const nextTitle = cur < 12 ? T.steps[cur + 1].title : "";
  const groups = [[1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11, 12]];
  return (
    <div className="stepper">
      {groups.map((g, gi) => (
        <div key={gi} className="phase">
          <span className="phase-name">{T.app.phases[gi]}</span>
          {g.map((n) => {
            const s = steps[n - 1];
            const done = s.state === "done";
            const reachable = done || s.state === "open" || n === cur;
            const cls = `dot${done ? " done" : ""}${n === cur ? " current" : ""}${!done && n !== cur && s.state === "open" ? " open" : ""}${n === view ? " viewing" : ""}`;
            const title = reachable ? `${n}. ${T.steps[n].title}` : s.locked_reason || T.app.futureStep(T.steps[cur].title);
            return (
              <button key={n} type="button" className={cls} title={title} aria-label={title} aria-current={n === view ? "step" : undefined}
                disabled={!reachable} onClick={() => reachable && go(n)}>
                {done ? <Icon name="tick" /> : null}
              </button>
            );
          })}
        </div>
      ))}
      <span className="stepper-text">{T.app.stepOf(view)}: <b>{T.steps[view].title}</b></span>
      {nextTitle && view === cur ? <span className="stepper-next">{T.app.next(nextTitle)}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- drawers

function HistoryDrawer({ cid, onClose }: { cid: number; onClose: () => void }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await api<ActivityRow[]>("GET", `/cases/${cid}/activity`); if (alive) setRows(r.slice().reverse()); }
      catch { if (alive) setRows([]); }
    };
    load();
    const t = window.setInterval(load, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, [cid]);
  return (
    <Drawer title={T.history.title} onClose={onClose}>
      <div className="spread"><p className="muted small" style={{ margin: 0 }}>{T.history.intro}</p>
        <a className="btn small" href={`/api/cases/${cid}/activity?format=csv`}>{T.buttons.exportCsv}</a></div>
      {rows === null ? <Skeleton /> : rows.length === 0 ? <Empty text={T.history.empty} /> : (
        <ul className="hist">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="meta"><Origin who={r.actor} /><span>{fmtDate(r.ts)}</span>
                {r.step ? <span>· {T.steps[r.step]?.title}</span> : null}</div>
              {r.message}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function HelpDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title={T.help.title} onClose={onClose}>
      <p className="label">{T.help.stepsTitle}</p>
      <ol style={{ paddingLeft: 20, marginTop: 0 }}>{T.help.steps.map((s) => <li key={s} style={{ marginBottom: 6 }}>{s}</li>)}</ol>
      <p className="label" style={{ marginTop: 24 }}>{T.help.glossaryTitle}</p>
      {T.help.glossary.map((g) => <p key={g.term} style={{ margin: "0 0 10px" }}><b>{g.term}</b>{": "}{g.text}</p>)}
    </Drawer>
  );
}

function SettingsDrawer({ settings, b, act, onClose, onDeleted, onReset }: {
  settings: ReturnType<typeof useSettings>; b?: Bundle; act?: CaseCtx["act"]; onClose: () => void;
  onDeleted?: () => void; onReset?: () => void }) {
  const s = settings.s;
  const [ask, setAsk] = useState<"" | "reset" | "delete">("");
  const [to, setTo] = useState<number>(Math.min(12, (b?.progress.current ?? 1) + 1));
  const liveOk = !!(s?.keys?.ANTHROPIC_API_KEY && s?.keys?.TAVILY_API_KEY);
  const cid = b?.case.id;
  return (
    <Drawer title={T.settings.title} onClose={onClose}>
      <div className="stack">
        <div>
          <span className="field-label">{T.settings.mode}</span>
          <span className="hint">{T.settings.modeHint}</span>
          <Toggle label={T.settings.mode} value={s?.mode === "live"} on={T.settings.modeLive} off={T.settings.modeDemo}
            disabled={!liveOk} onChange={(v) => settings.save({ mode: v ? "" : "fixtures" })} />
          {!liveOk ? <p className="small muted">{T.settings.keysMissing}</p> : null}
        </div>
        <div>
          <span className="field-label">{T.settings.fastDemo}</span>
          <span className="hint">{T.settings.fastDemoHint}</span>
          <Toggle label={T.settings.fastDemo} value={!!s?.app.fast_demo} onChange={(v) => settings.save({ fast_demo: v })} />
        </div>
        <div>
          <span className="field-label">{T.settings.largerText}</span>
          <span className="hint">{T.settings.largerTextHint}</span>
          <Toggle label={T.settings.largerText} value={!!s?.app.larger_text} onChange={(v) => settings.save({ larger_text: v })} />
        </div>
        {b && act ? (
          <div>
            <p className="label" style={{ marginTop: 8 }}>{T.settings.caseSection}</p>
            {b.case.sample && b.progress.current < 12 ? (
              <div className="stack-sm">
                <span className="field-label">{T.settings.skip}</span>
                <span className="hint">{T.settings.skipHint}</span>
                <div className="row">
                  <select aria-label={T.settings.skip} value={to} onChange={(e) => setTo(Number(e.target.value))} style={{ maxWidth: 280 }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => n > b.progress.current).map((n) => (
                      <option key={n} value={n}>{n}. {T.steps[n].title}</option>
                    ))}
                  </select>
                  <button type="button" className="btn" disabled={b.progress.current >= 12 || b.running_jobs.length > 0}
                    onClick={async () => { await act(() => api("POST", `/cases/${cid}/sample/advance?to=${to}`)); onClose(); }}>
                    {T.buttons.skipToStep}
                  </button>
                </div>
                {b.running_jobs.indexOf("advance") >= 0 ? <p className="small muted">{T.settings.skipping}</p> : null}
              </div>
            ) : null}
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setAsk("reset")}>{T.buttons.resetCase}</button>
              <button type="button" className="btn danger" onClick={() => setAsk("delete")}>{T.buttons.deleteCase}</button>
            </div>
          </div>
        ) : null}
        <Details title={T.settings.rulesTitle}>
          <pre className="yaml">{s?.rules_yaml}</pre>
          <pre className="yaml">{s?.registry_yaml}</pre>
        </Details>
      </div>
      {ask && act ? (
        <Dialog text={ask === "reset" ? T.settings.confirmReset : T.settings.confirmDelete}
          confirmLabel={ask === "reset" ? T.buttons.resetCase : T.buttons.deleteCase} onCancel={() => setAsk("")}
          onConfirm={async () => {
            setAsk("");
            if (ask === "reset") { await act(() => api("POST", `/cases/${cid}/reset`)); onClose(); onReset?.(); }
            else { await act(() => api("DELETE", `/cases/${cid}`)); onClose(); onDeleted?.(); }
          }} />
      ) : null}
    </Drawer>
  );
}

