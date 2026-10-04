import type { StepState } from "../api/types";
import { PHASES, STEPS } from "../copy";

export function Rail({ steps, view, onGo, counts }: { steps: StepState[]; view: number; onGo: (n: number) => void; counts?: any }) {
  const cur = steps.find((s) => s.current)?.n ?? 1;
  const curPhase = STEPS[cur - 1].phase;
  return (
    <nav className="rail" aria-label="The 12 steps">
      {PHASES.map((ph, p) => (
        <div key={ph}>
          <div className={`phase-title ${p === curPhase ? "on" : ""}`}>{ph}</div>
          {steps.filter((s) => s.phase === p).map((s) => {
            const locked = s.state === "locked";
            const cls = [s.state === "done" ? "done" : "", s.current ? "cur" : "", view === s.n ? "view" : "", locked ? "locked" : ""].join(" ");
            const hint = locked ? s.locked_reason : s.state === "done" ? "Done. Opens read-only." : s.current ? "Current step" : "Available";
            return (
              <button key={s.n} className={`node ${cls}`} disabled={locked} onClick={() => onGo(s.n)} title={hint}
                aria-current={view === s.n ? "step" : undefined} aria-label={`Step ${s.n}: ${STEPS[s.n - 1].short}. ${hint}${s.signoff ? ". Needs a person's sign-off" : ""}`}>
                <span className="dot">{s.state === "done" ? "✓" : s.n}</span>
                <span className="lbl">{STEPS[s.n - 1].short}</span>
                {s.signoff && <span className="gate" title="A person signs off here" aria-hidden>✎</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div className="rail-foot">
        <div><span className="gate" style={{ color: "var(--c-consultant)", fontWeight: 700 }}>✎</span> = consultant sign-off</div>
        {counts && counts.collected > 0 && <div style={{ marginTop: 6 }}><b>{counts.collected}</b> collected · <b>{counts.unique}</b> unique</div>}
      </div>
    </nav>
  );
}
