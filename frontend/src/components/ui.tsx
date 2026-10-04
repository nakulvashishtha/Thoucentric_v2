import React, { useEffect, useRef, useState } from "react";
import * as T from "../copy";

// ---------------------------------------------------------------- icons (small inline SVGs, no library)

const PATHS: Record<string, React.ReactNode> = {
  tick: <path d="M4 10.5l4 4 8-9" />,
  cross: <path d="M5 5l10 10M15 5L5 15" />,
  warn: <><path d="M10 3l8 14H2L10 3z" /><path d="M10 8.5v4M10 14.8v.2" /></>,
  clock: <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5V10l3 2" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 016 0V9" /></>,
  chevron: <path d="M7.5 4.5l5.5 5.5-5.5 5.5" />,
  down: <path d="M5 7.5l5 5 5-5" />,
  ext: <><path d="M8 4H4v12h12v-4" /><path d="M11 3h6v6M17 3l-8 8" /></>,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  dot: <circle cx="10" cy="10" r="3" />,
  info: <><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6.2v.2" /></>,
  file: <><path d="M5 2.5h6.5L15 6v11.5H5z" /><path d="M11.5 2.5V6H15" /></>,
  ask: <><path d="M3 4.5h14v9H8l-4 3.5v-3.5H3z" /><path d="M8 8.2a2 2 0 113 1.7c-.6.4-1 .8-1 1.5M10 12.8v.2" /></>,
  gather: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.3 12.3L17 17" /><path d="M6.5 8.5l1.5 1.5 3-3" /></>,
  decide: <><path d="M4 16.5h12" /><path d="M6 13.5l7.5-7.5 2 2L8 15.5H6z" /><path d="M12 7.5l2 2" /></>,
  upload: <><path d="M10 13V3.5M6 7l4-4 4 4" /><path d="M3.5 13v3.5h13V13" /></>,
};

export function Icon({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------- pills and labels (status never by colour alone)

type Tone = "green" | "red" | "amber" | "grey" | "blue";
export function Pill({ tone, icon, children, big }: { tone: Tone; icon?: string; children: React.ReactNode; big?: boolean }) {
  return <span className={`pill ${tone}${big ? " big" : ""}`}>{icon ? <Icon name={icon} /> : null}{children}</span>;
}

const STATUS_TONE: Record<string, [Tone, string]> = {
  auto_approved: ["green", "tick"], approved: ["green", "tick"], needs_decision: ["amber", "warn"],
  client_reported: ["amber", "dot"], belief_under_test: ["blue", "info"], cross_check: ["grey", "dot"],
  pass_line_source: ["grey", "dot"], rejected: ["red", "cross"], pending: ["grey", "clock"],
  unreadable: ["red", "warn"], duplicate: ["grey", "dot"], pending_clean: ["grey", "clock"],
};

export function StatusPill({ status, duplicateOf }: { status: string; duplicateOf?: string | null }) {
  if (duplicateOf) return <Pill tone="grey" icon="dot">{T.evidence.duplicateOf(duplicateOf)}</Pill>;
  const [tone, icon] = STATUS_TONE[status] || ["grey", "dot"];
  return <Pill tone={tone} icon={icon}>{T.evidence.status[status] || status}</Pill>;
}

export function Quality({ tier }: { tier: number | null | undefined }) {
  if (tier == null) return <span className="quality">{T.evidence.yourCall}</span>;
  return <span className={`quality q${tier}`}>{tier === 4 ? <Icon name="warn" size={13} /> : null} {T.evidence.quality[tier]}</span>;
}

export function ResultPill({ result, big }: { result: string; big?: boolean }) {
  const map: Record<string, [Tone, string]> = {
    holds: ["green", "tick"], fails: ["red", "cross"], conflicting: ["amber", "warn"], not_enough: ["grey", "clock"],
  };
  const [tone, icon] = map[result] || ["grey", "dot"];
  return <Pill tone={tone} icon={icon} big={big}>{T.results.labels[result]}</Pill>;
}

export function Confidence({ level }: { level: string }) {
  if (!level || level === "none") return null;
  const n = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const word = T.results.confidence[level];
  return (
    <span className="conf" aria-label={T.results.confidenceWord(word)}>
      <i className={n >= 1 ? "on" : ""} /><i className={n >= 2 ? "on" : ""} /><i className={n >= 3 ? "on" : ""} />
      {T.results.confidenceWord(word)}
    </span>
  );
}

export function Origin({ who }: { who: string }) {
  return <span className="tag">{T.origin[who] || who}</span>;
}

export function Locked() {
  return <span className="lock"><Icon name="lock" size={14} />{T.app.locked}</span>;
}

export function IdChip({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  return <button type="button" className="idchip" onClick={(e) => { e.stopPropagation(); onOpen?.(id); }}>{id}</button>;
}

// ---------------------------------------------------------------- Details, tooltips, menus

export function Details({ title, children, inline, defaultOpen = false }:
  { title?: string; children: React.ReactNode; inline?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`details${open ? " open" : ""}${inline ? " inline" : ""}`}>
      <button type="button" className="details-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} />{title || T.app.details}
      </button>
      {open ? <div className="details-body">{children}</div> : null}
    </div>
  );
}

export function Tip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="tip" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" className="tip-btn" aria-label={text} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>?</button>
      {show ? <span className="tip-pop" role="tooltip">{text}</span> : null}
    </span>
  );
}

export function Menu({ label, items, disabled }: { label: string; items: { label: string; onClick: () => void }[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn small" disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {label}<Icon name="down" size={14} />
      </button>
      {open ? (
        <div className="menu-list" role="menu">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}>
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Toggle({ value, onChange, disabled, on = T.settings.on, off = T.settings.off, label }:
  { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; on?: string; off?: string; label: string }) {
  return (
    <span className="toggle" role="group" aria-label={label}>
      <button type="button" className={value ? "on" : ""} aria-pressed={value} disabled={disabled} onClick={() => onChange(true)}>{on}</button>
      <button type="button" className={!value ? "on" : ""} aria-pressed={!value} disabled={disabled} onClick={() => onChange(false)}>{off}</button>
    </span>
  );
}

// ---------------------------------------------------------------- progress, empty, skeleton

export function Progress({ done, total, label, elapsed }: { done?: number; total?: number; label: string; elapsed?: number }) {
  const pct = total ? Math.min(100, Math.round(((done || 0) / total) * 100)) : null;
  return (
    <div className="progress" role="status">
      <div className="spread small"><span>{label}</span>
        <span className="muted mono">{total ? T.step5.items(done || 0, total) : ""}{elapsed != null ? ` · ${T.step5.elapsed(elapsed)}` : ""}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct ?? 35}%` }} /></div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty"><Icon name="info" />{text}</div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

export function useElapsed(since?: string | null, running = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!since) return 0;
  return Math.max(0, Math.round((now - Date.parse(since.endsWith("Z") || since.includes("+") ? since : since + "Z")) / 1000));
}

// ---------------------------------------------------------------- dialogs and drawers

export function Dialog({ text, onConfirm, onCancel, confirmLabel = T.buttons.confirm, children }:
  { text: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; children?: React.ReactNode }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); }, []);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="dialog" role="dialog" aria-modal="true">
        <p>{text}</p>
        {children}
        <div className="row">
          <button type="button" className="btn" onClick={onCancel}>{T.buttons.cancel}</button>
          <button type="button" className="btn primary" ref={ok} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}

export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="drawer-head"><h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label={T.app.close} onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- error boundary: a failure never gives a blank page

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="card">
          <p>{T.errors.step}</p>
          <button type="button" className="btn" onClick={() => this.setState({ failed: false })}>{T.buttons.tryAgain}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------- helpers

export function fmtNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? r.toLocaleString("en-GB") : r.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

export function withUnit(v: number | null | undefined, unit: string): string {
  const u = (unit || "").trim();
  if (v == null) return "";
  return u.startsWith("%") ? `${fmtNum(v)}${u}` : `${fmtNum(v)} ${u}`.trim();
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
