import { ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { api, upload } from "../api/client";
import type { ActivityRow, Bundle, Evidence, Job } from "../api/types";
import { errMsg, go, useCase } from "../App";
import { EvidenceCard } from "../components/EvidenceCard";
import { Rail } from "../components/Rail";
import { ErrorBoundary, ErrorNote, Progress, Skeleton, TermScope, Who, useConfirm, useToast } from "../components/ui";
import { PHASES, STEPS } from "../copy";
import { Step1, Step2, Step3 } from "./steps/FrameSteps";
import { Step4, Step5, Step6, Step7 } from "./steps/GatherSteps";
import { Step8, Step9, Step10, Step11, Step12 } from "./steps/ResultSteps";

export interface Ctx {
  b: Bundle; cid: number; view: number; readOnly: boolean;
  act: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;
  call: (method: string, path: string, body?: unknown) => Promise<boolean>;
  send: (path: string, form: FormData) => Promise<boolean>;
  goStep: (n: number) => void; openEvidence: (id: string) => void;
  confirm: (t: string, body: string, ok: string, danger?: boolean) => Promise<boolean>;
  toast: (m: string) => void; error: string | null; clearError: () => void; reload: () => Promise<void>;
}
const CaseCtx = createContext<Ctx | null>(null);
export const useCtx = () => useContext(CaseCtx)!;

export function CaseView({ id, step, activityPanel, onCaseInfo }: {
  id: number; step?: number; activity: ActivityRow[]; activityPanel: ReactNode; onCaseInfo: (i: { title: string; mode: string } | null) => void;
}) {
  const { b, err, reload, bump } = useCase(id);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const prevCurrent = useRef<number | null>(null);
  const current = b?.progress.current ?? 1;
  const view = step ?? current;

  useEffect(() => { if (b) onCaseInfo({ title: b.case.title || "Untitled case", mode: b.case.mode }); }, [b?.case.title, b?.case.mode]);
  useEffect(() => () => onCaseInfo(null), []);
  useEffect(() => { setError(null); }, [view]);
  // Steps with no sign-off advance by themselves when their job finishes, with a visible notice.
  useEffect(() => {
    if (!b) return;
    const prev = prevCurrent.current;
    prevCurrent.current = current;
    // step 10 stays put so its result can be read; otherwise move on one step at a time
    if (prev !== null && current > prev && view === prev && !STEPS[prev - 1].signoff && prev !== 10) {
      const target = Math.min(current, prev + 1);
      toast(`Step ${prev} (${STEPS[prev - 1].short}) finished. Moved on to step ${target}.`);
      go(`#/case/${id}/${target}`);
    }
  }, [current, !!b]);

  if (err && !b) return <div className="home"><ErrorNote message={err} onRetry={reload} /></div>;
  if (!b) return <div className="home"><Skeleton rows={6} /></div>;

  const st = b.progress.steps[view - 1];
  const lockedView = !!st && st.state === "locked";
  const readOnly = !!st && st.state === "done" && !st.current && ![8, 9, 10, 11].includes(view);
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setError(null);
    try { await fn(); bump(); await reload(); if (okMsg) toast(okMsg); return true; }
    catch (e) { setError(errMsg(e)); await reload(); return false; }
  };
  const ctx: Ctx = {
    b, cid: id, view, readOnly, act,
    call: (m, p, body) => act(() => api(m, `/cases/${id}${p}`, body)),
    send: (p, form) => act(() => upload(`/cases/${id}${p}`, form)),
    goStep: (n) => go(`#/case/${id}/${n}`), openEvidence: setDrawer, confirm, toast, error,
    clearError: () => setError(null), reload,
  };
  const copy = STEPS[view - 1];
  const failed = Object.values(b.jobs).filter((j) => j.status === "failed" && j.finished_at && !isSuperseded(j, b));
  const Body = [Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9, Step10, Step11, Step12][view - 1];
  const ev = drawer ? b.evidence.find((e) => e.id === drawer) : null;

  return (
    <CaseCtx.Provider value={ctx}>
      <div className="banners">
        {b.case.mode === "fixtures" && (
          <div className="banner warn"><b>FIXTURE MODE: stored responses, not live.</b>
            <span>{b.mode.notice ? `${b.mode.notice}. ` : ""}{b.case.sample ? "Seeded items are tagged Sample data (simulated)." : "This blank case needs live mode."}</span></div>
        )}
        {failed.slice(-1).map((j) => (
          <div className="banner error" key={j.id} role="alert"><b>Something did not finish.</b><span style={{ flex: 1 }}>{j.error}</span></div>
        ))}
      </div>
      <div className="shell">
        <Rail steps={b.progress.steps} view={view} onGo={ctx.goStep} counts={b.counts} />
        <main className="workspace" id="main">
          <div className="workspace-inner">
            <TermScope k={view}>
              <header className="stephead">
                <div className="kicker"><span className="phasechip">{PHASES[copy.phase]}</span><span>Step {view} of 12</span>
                  {readOnly && <span className="readonly-note">🔒 Done. Shown read-only.</span>}</div>
                <h1>{copy.title}</h1>
                <p className="what">{copy.what}</p>
                <div className="whorow">{copy.who.map((w) => <Who key={w} k={w} />)}</div>
              </header>
              {error && <div style={{ marginBottom: 12 }}><ErrorNote message={error} /></div>}
              <ErrorBoundary key={view} onRetry={reload}>
                {lockedView ? (
                  <div className="empty">This step is not open yet: {st.locked_reason.toLowerCase()}.{" "}
                    <button className="linkbtn" onClick={() => go(`#/case/${id}/${current}`)}>Go to step {current}</button></div>
                ) : <Body />}
              </ErrorBoundary>
              <div className="whynote"><b>Why this matters.</b> {copy.why}</div>
            </TermScope>
          </div>
        </main>
        {activityPanel}
      </div>
      {ev && (
        <>
          <div className="overlay" onClick={() => setDrawer(null)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Evidence ${ev.id}`}>
            <div className="drawer-head"><h2>Evidence {ev.id}</h2><span className="spacer" /><button className="btn sm ghost" onClick={() => setDrawer(null)} aria-label="Close">✕</button></div>
            <div className="drawer-body"><EvidenceCard e={ev as Evidence} hyps={b.hypotheses} mode="view" readOnly defaultOpen /></div>
          </aside>
        </>
      )}
    </CaseCtx.Provider>
  );
}

function isSuperseded(j: Job, b: Bundle): boolean {
  const later = Object.values(b.jobs).find((x) => x.kind === j.kind && x.id > j.id);
  return !!later;
}

/* ---------- shared job view: progress with elapsed time, or a plain error with Retry ---------- */
export function JobView({ job, label, onRetry }: { job?: Job | null; label: string; onRetry?: () => void }) {
  if (!job) return null;
  if (job.status === "failed") return <ErrorNote message={job.error || "This did not finish."} onRetry={onRetry} />;
  if (job.status === "done") return null;
  const p = job.progress || {};
  return <div className="card"><Progress label={p.label || label} done={p.done} total={p.total} since={job.started_at} until={job.finished_at} /></div>;
}
