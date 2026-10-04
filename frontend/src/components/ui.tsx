import { Component, ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GLOSSARY, RESULT_LABEL, WHO_LABEL } from "../copy";
import type { Evidence } from "../api/types";

export function Who({ k }: { k: string }) {
  return <span className={`who a-${k}`}>{WHO_LABEL[k] || k}</span>;
}

/* ---------- glossary term: the first time a term appears on a screen it gets a small "?" ---------- */
const SeenTerms = createContext<Set<string> | null>(null);
export function TermScope({ children, k }: { children: ReactNode; k: string | number }) {
  const seen = useMemo(() => new Set<string>(), [k]);
  return <SeenTerms.Provider value={seen}>{children}</SeenTerms.Provider>;
}
export function Term({ t, children }: { t: string; children?: ReactNode }) {
  const seen = useContext(SeenTerms);
  const [first] = useState(() => {
    if (!seen) return true;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  const def = GLOSSARY[t];
  if (!def || !first) return <>{children ?? t}</>;
  return (
    <span className="term">
      {children ?? t}
      <button type="button" className="term-q" aria-label={`What is ${t}?`}>?</button>
      <span className="term-pop" role="tooltip">{def}</span>
    </span>
  );
}

/* ---------- status, tier and evidence chips (never colour alone: always text or an icon) ---------- */
const STATUS_STYLE: Record<string, [string, string]> = {
  auto_approved: ["pass", "✓"], approved: ["pass", "✓"], needs_decision: ["warn", "!"],
  client_reported: ["warn", ""], belief_under_test: ["orange", ""], cross_check: ["grey", ""],
  pass_line_source: ["grey", ""], rejected: ["fail", "✕"], pending: ["dashed", "⏳"], unreadable: ["faillight", "✕"],
  duplicate: ["grey", "⧉"], pending_clean: ["dashed", "⏳"],
};
export function StatusPill({ e }: { e: Pick<Evidence, "status" | "status_label" | "duplicate_of"> }) {
  const [cls, icon] = STATUS_STYLE[e.status] || ["grey", ""];
  return <span className={`pill ${cls}`}>{icon && <span aria-hidden>{icon}</span>}{e.status_label}</span>;
}
export function TierBadge({ tier, label }: { tier: number | null; label?: string }) {
  if (tier === null || tier === undefined) return <span className="tier tp">Person-decided</span>;
  const names: Record<number, string> = { 1: "Official", 2: "Database or archive", 3: "Press", 4: "Unverified" };
  return <span className={`tier t${tier}`} title={label}>{`Tier ${tier} · ${names[tier]}`}</span>;
}
export function EChip({ id, onOpen, checked }: { id: string; onOpen?: (id: string) => void; checked?: boolean }) {
  return (
    <button type="button" className={`echip ${checked ? "checked" : ""}`} onClick={() => onOpen?.(id)}
      title={checked ? "Checked by the consultant" : "Open this evidence"}>
      {id}{checked ? " ✓" : ""}
    </button>
  );
}
export function ResultPill({ result, xl }: { result: string; xl?: boolean }) {
  const m: Record<string, [string, string]> = { holds: ["pass", "✓"], fails: ["fail", "✕"], conflicting: ["warn", "!"], not_enough: ["grey", "…"] };
  const [c, i] = m[result] || ["grey", ""];
  return <span className={`pill ${c} ${xl ? "xl" : ""}`}><span aria-hidden>{i}</span>{RESULT_LABEL[result] || result}</span>;
}
export function Meter({ level }: { level: string }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  const word = n ? level[0].toUpperCase() + level.slice(1) : "No confidence";
  return (
    <span className="meter" aria-label={`Confidence: ${word}`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}
      <span>{word}</span>
    </span>
  );
}
export function Lock({ text = "Locked at step 3" }: { text?: string }) {
  return <span className="lockline"><span aria-hidden>🔒</span>{text}</span>;
}
export function Sim() {
  return <span className="sim">Sample data (simulated)</span>;
}

/* ---------- progress with elapsed time (never a bare spinner) ---------- */
export function Elapsed({ since, until }: { since: string; until?: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const start = new Date(since).getTime();
  const end = until ? new Date(until).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  return <span className="mono">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}
export function Progress({ label, done, total, since, until }: { label: string; done?: number; total?: number; since?: string; until?: string | null }) {
  const det = typeof done === "number" && typeof total === "number" && total > 0;
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress-top">
        <span>{label}{det ? ` ${done} of ${total}` : ""}</span>
        {since && <span className="muted">Elapsed <Elapsed since={since} until={until} /></span>}
      </div>
      <div className={`bar ${det ? "" : "indet"}`}><i style={det ? { width: `${Math.round((100 * done!) / total!)}%` } : undefined} /></div>
    </div>
  );
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden>{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

/* ---------- gate box: "Consultant sign-off" or "No sign-off here" ---------- */
export function GateBox(props: {
  signoff: boolean; title?: string; button?: string; onClick?: () => void; disabledReason?: string; busy?: boolean;
  done?: boolean; doneText?: string; next?: { n: number; go: () => void } | null; children?: ReactNode; readOnly?: boolean;
}) {
  const { signoff, title, button, onClick, disabledReason, busy, done, doneText, next, children, readOnly } = props;
  if (done) {
    return (
      <div className="gatebox done no-print">
        <h4>Done ✓</h4>
        <div className="row"><span>{doneText || "Signed off."}</span><span className="spacer" />
          {next && <button className="btn navy" onClick={next.go}>Continue to step {next.n} →</button>}</div>
      </div>
    );
  }
  if (!signoff) {
    return (
      <div className="gatebox no no-print">
        <h4>No sign-off here</h4>
        <div className="row"><span>{title || "The agent moves on by itself."}</span><span className="spacer" />
          {next && <button className="btn navy" onClick={next.go}>Continue to step {next.n} →</button>}</div>
        {children}
      </div>
    );
  }
  return (
    <div className="gatebox yes no-print">
      <h4>Consultant sign-off</h4>
      {title && <div>{title}</div>}
      {children}
      {!readOnly && (
        <div className="row">
          <button className="btn primary lg" onClick={onClick} disabled={!!disabledReason || busy}>{busy ? "Working…" : button}</button>
          {disabledReason && <span className="gate-reason">{disabledReason}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- collapsible group ---------- */
export function Collapse({ title, count, open: initial = true, children, extra }: { title: ReactNode; count?: number; open?: boolean; children: ReactNode; extra?: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: open ? 12 : 0 }}>
        <button className="collapse-head" onClick={() => setOpen(!open)} aria-expanded={open} style={{ flex: 1 }}>
          <span className="caret" aria-hidden>{open ? "▾" : "▸"}</span>
          <h2>{title}</h2>
          {typeof count === "number" && <span className="countbadge">{count}</span>}
        </button>
        {extra}
      </div>
      {open && children}
    </div>
  );
}

/* ---------- confirm dialog, in plain words about the consequence ---------- */
type ConfirmReq = { title: string; body: string; ok: string; danger?: boolean; resolve: (v: boolean) => void };
const ConfirmCtx = createContext<(t: string, b: string, ok: string, danger?: boolean) => Promise<boolean>>(async () => true);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const ask = (title: string, body: string, ok: string, danger?: boolean) =>
    new Promise<boolean>((resolve) => setReq({ title, body, ok, danger, resolve }));
  const close = (v: boolean) => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <>
          <div className="overlay" onClick={() => close(false)} />
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
            <h2 id="dlg-t">{req.title}</h2>
            <p>{req.body}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => close(false)} autoFocus>Cancel</button>
              <button className={`btn ${req.danger ? "danger" : "primary"}`} onClick={() => close(true)}>{req.ok}</button>
            </div>
          </div>
        </>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- toast ---------- */
const ToastCtx = createContext<(m: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = (m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3500);
  };
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/* ---------- error boundary: a failure never produces a blank page ---------- */
export class ErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="card" role="alert">
          <h2>This screen could not be shown</h2>
          <p className="muted" style={{ margin: "8px 0 12px" }}>Something went wrong while drawing this step. Your case is safe: nothing was lost.</p>
          <button className="btn" onClick={() => { this.setState({ err: null }); this.props.onRetry?.(); }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner error" role="alert" style={{ borderRadius: 10, border: "1px solid var(--fail)" }}>
      <span aria-hidden>✕</span><span style={{ flex: 1 }}>{message}</span>
      {onRetry && <button className="btn sm danger" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v).toLocaleString("en-US");
  if (Math.abs(v) >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return String(Number(v.toPrecision(3)));
}
export function figText(f: { value?: number | null; low?: number | null; high?: number | null; unit?: string }): string {
  const n = f.value !== null && f.value !== undefined ? fmt(f.value) : `${fmt(f.low)} to ${fmt(f.high)}`;
  const u = (f.unit || "").trim();
  return u.startsWith("%") ? `${n}${u}` : `${n} ${u}`.trim();
}
export function withUnit(v: number | null | undefined, unit: string): string {
  const u = (unit || "").trim();
  return u.startsWith("%") ? `${fmt(v)}${u}` : `${fmt(v)} ${u}`.trim();
}
