import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { Bundle, Evidence } from "./api/types";
import * as T from "./copy";
import { Dialog, Icon } from "./components/ui";

// One case at a time. The server is the source of truth; the page polls while background work runs.
export function useCase(cid: number) {
  const [b, setB] = useState<Bundle | null>(null);
  const [error, setError] = useState<string>("");
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Bundle>("GET", `/cases/${cid}`);
      setB(data);
      setError("");
      return data;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T.errors.load);
      return null;
    }
  }, [cid]);

  useEffect(() => { setB(null); refresh(); }, [refresh]);

  // poll every second while any job is running
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (b && b.running_jobs.length) timer.current = window.setTimeout(refresh, 1000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [b, refresh]);

  return { b, error, refresh };
}

export interface CaseCtx {
  b: Bundle;
  cid: number;
  view: number;
  readOnly: boolean;          // the user is looking at a finished step
  narrow: boolean;
  go: (n: number) => void;
  refresh: () => Promise<Bundle | null>;
  act: <R = any>(fn: () => Promise<R>) => Promise<R | undefined>;
  busy: boolean;
  openEvidence: (id: string) => void;
  notify: (text: string) => void;
}

export const Ctx = createContext<CaseCtx | null>(null);
export function useCtx(): CaseCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("case context missing");
  return c;
}

export function evidenceById(b: Bundle, id: string): Evidence | undefined {
  return b.evidence.find((e) => e.id === id);
}

// ---------------------------------------------------------------- the sticky footer (Back, status, one primary button)

export interface FooterProps {
  status?: React.ReactNode;
  statusOk?: boolean;
  primary?: string;
  onPrimary?: () => void | Promise<void>;
  disabled?: boolean;
  confirm?: string;            // irreversible actions ask in one plain sentence first
  done?: boolean;              // after a sign-off: "Done" and the button becomes Continue
  onContinue?: () => void;
  extra?: React.ReactNode;     // small secondary links
  hideBack?: boolean;
}

export function Footer(p: FooterProps) {
  const { view, go, busy, readOnly, narrow } = useCtx();
  const [asking, setAsking] = useState(false);
  const run = () => { if (p.confirm) setAsking(true); else void p.onPrimary?.(); };
  const showDone = p.done || readOnly;
  return (
    <div className="footer">
      <div className="footer-inner">
        {!p.hideBack && view > 1 ? (
          <button type="button" className="btn" onClick={() => go(view - 1)}>
            <span aria-hidden>←</span> {T.app.back}
          </button>
        ) : <span />}
        <div className={`footer-status${showDone || p.statusOk ? " ok" : ""}`} aria-live="polite">
          {showDone ? <><Icon name="tick" />{T.app.done}</> : p.status}
        </div>
        {p.extra}
        {showDone ? (
          <button type="button" className="btn primary" onClick={() => (p.onContinue ? p.onContinue() : go(view + 1))}
            disabled={view >= 12 && !p.onContinue}>
            {T.buttons.continue}
          </button>
        ) : p.primary ? (
          <button type="button" className="btn primary" disabled={p.disabled || busy || narrow} onClick={run}>
            {p.primary}
          </button>
        ) : null}
      </div>
      {asking ? (
        <Dialog text={p.confirm || ""} confirmLabel={p.primary} onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); void p.onPrimary?.(); }} />
      ) : null}
    </div>
  );
}

export function PageHead({ n }: { n: number }) {
  return (
    <>
      <h1 className="page-title">{T.steps[n].title}</h1>
      <p className="instruction">{T.steps[n].instruction}</p>
    </>
  );
}
