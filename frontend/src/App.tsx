import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ActivityRow, Bundle } from "./api/types";
import { ActivityPanel } from "./components/Activity";
import { HelpPanel, SettingsDrawer } from "./components/Panels";
import { ConfirmProvider, ErrorBoundary, ToastProvider, useToast } from "./components/ui";
import { Home } from "./pages/Home";
import { CaseView } from "./pages/CaseView";

function parseHash(): { page: "home" } | { page: "case"; id: number; step?: number } {
  const m = window.location.hash.match(/^#\/case\/(\d+)(?:\/(\d+))?/);
  return m ? { page: "case", id: Number(m[1]), step: m[2] ? Number(m[2]) : undefined } : { page: "home" };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
export const go = (hash: string) => { window.location.hash = hash; };

export function useCase(id: number) {
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fast = useRef(0);
  const load = useCallback(async () => {
    try {
      const nb = await api<Bundle>("GET", `/cases/${id}`);
      setB(nb);
      setErr(null);
      if (nb.running_jobs.length) fast.current = Date.now();
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    setB(null);
    load();
    let alive = true;
    let t: number;
    const loop = () => {
      const busy = Date.now() - fast.current < 4000;
      t = window.setTimeout(async () => { if (!alive) return; if (!document.hidden) await load(); loop(); }, busy ? 1000 : 3000);
    };
    loop();
    return () => { alive = false; clearTimeout(t); };
  }, [load]);
  const bump = () => { fast.current = Date.now(); };
  return { b, err, reload: load, bump };
}

function useActivity(id: number | null) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const last = useRef(0);
  useEffect(() => {
    setRows([]);
    last.current = 0;
    if (!id) return;
    let alive = true;
    const tick = async () => {
      try {
        const more = await api<ActivityRow[]>("GET", `/cases/${id}/activity?since_id=${last.current}`);
        if (alive && more.length) {
          last.current = more[more.length - 1].id;
          setRows((r) => [...r, ...more]);
        }
      } catch { /* shown elsewhere */ }
    };
    tick();
    const t = setInterval(() => { if (!document.hidden) tick(); }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);
  return rows;
}

function Shell() {
  const route = useRoute();
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const caseId = route.page === "case" ? route.id : null;
  const rows = useActivity(caseId);
  const [appMode, setAppMode] = useState<{ mode: string; notice: string } | null>(null);
  const [caseInfo, setCaseInfo] = useState<{ title: string; mode: string } | null>(null);
  const toast = useToast();
  useEffect(() => { api("GET", "/settings").then((s) => setAppMode(s)).catch(() => setAppMode(null)); }, []);
  useEffect(() => { if (!caseId) setCaseInfo(null); }, [caseId]);
  useEffect(() => {
    const on = () => toast("The app needs its passcode. Reload the page to enter it.");
    window.addEventListener("rw-auth", on);
    return () => window.removeEventListener("rw-auth", on);
  }, [toast]);
  const mode = caseInfo?.mode || appMode?.mode;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/"><span className="brand-mark"><i /></span>Research Workbench</a>
        {caseInfo && <span className="casename" title={caseInfo.title}>{caseInfo.title}</span>}
        <span className="spacer" />
        {mode && <span className={`modechip ${mode}`}>{mode === "live" ? "● Live" : "● Fixture mode"}</span>}
        {caseId && <button className="btn ghost act-toggle" onClick={() => setActOpen(true)}>Activity</button>}
        <button className="btn ghost" onClick={() => setSettings(true)}>Settings</button>
        <button className="btn ghost" onClick={() => setHelp(true)}>Help</button>
      </header>
      <div className="narrow-note">This screen is narrower than 900px, so the app is read-only here. Use a laptop or projector for the full workbench.</div>
      {route.page === "home" ? (
        <div className="banners">
          {appMode?.mode === "fixtures" && <div className="banner warn"><b>FIXTURE MODE: stored responses, not live.</b><span>{appMode.notice ? `${appMode.notice}. ` : ""}Sample cases run fully; a blank case needs live mode.</span></div>}
          <div style={{ overflow: "auto", flex: 1 }}><ErrorBoundary><Home onHelp={() => setHelp(true)} mode={appMode?.mode} /></ErrorBoundary></div>
        </div>
      ) : (
        <CaseView id={route.id} step={route.step} activity={rows} onCaseInfo={setCaseInfo}
          activityPanel={<ActivityPanel rows={rows} caseId={route.id} open={actOpen} onClose={() => setActOpen(false)} />} />
      )}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      {settings && <SettingsDrawer onClose={() => setSettings(false)} caseMode={caseInfo?.mode} />}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || "Something went wrong.";
}
