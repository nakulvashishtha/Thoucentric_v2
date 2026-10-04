import { useMemo, useState } from "react";
import type { ActivityRow } from "../api/types";
import { WHO_LABEL } from "../copy";

export function ActivityPanel({ rows, caseId, open, onClose }: { rows: ActivityRow[]; caseId: number; open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState("all");
  const shown = useMemo(() => [...rows].reverse().filter((r) => filter === "all" || r.actor === filter), [rows, filter]);
  return (
    <aside className={`activity ${open ? "open" : ""}`} aria-label="Activity record">
      <div className="act-head">
        <h2>Activity record</h2>
        <span className="countbadge">{rows.length}</span>
        <span className="spacer" />
        <button className="btn sm ghost act-toggle" onClick={onClose} aria-label="Close activity record">✕</button>
      </div>
      <div className="act-list" aria-live="polite">
        {shown.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nothing yet. Every action, and who did it, is logged here.</p>}
        {shown.map((r) => (
          <div className="act-item" key={r.id}>
            <div className="act-meta">
              <span className="act-time">{new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={`who a-${r.actor}`}>{WHO_LABEL[r.actor]}</span>
              {r.step > 0 && <span className="act-step">step {r.step}</span>}
            </div>
            <div>{r.message}</div>
          </div>
        ))}
      </div>
      <div className="act-foot">
        <select className="input sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by who acted" style={{ width: "auto" }}>
          <option value="all">Everyone</option>
          {["consultant", "llm", "rule_engine", "client", "expert", "system"].map((a) => <option key={a} value={a}>{WHO_LABEL[a]}</option>)}
        </select>
        <span className="spacer" />
        <a className="btn sm" href={`/api/cases/${caseId}/export?format=activity_csv`}>Export CSV</a>
      </div>
    </aside>
  );
}
