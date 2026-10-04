import type { Hypothesis } from "../api/types";
import * as T from "../copy";
import { useCtx } from "../state";
import { Confidence, Details, IdChip, ResultPill, fmtNum, withUnit } from "./ui";

export interface BarFigure { evidence_id: string; low: number; high: number; side: string; boundary: boolean }

// The target as a vertical tick and each piece of evidence as a dot or a range, on one scale.
export function TargetBar({ line, unit, figures, comparator }: { line: number; unit: string; figures: BarFigure[]; comparator: string }) {
  const vals = [line, ...figures.flatMap((f) => [f.low, f.high])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(line) || 1;
  lo -= span * 0.25; hi += span * 0.25;
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0;
  if (hi - lo >= 2) { lo = Math.floor(lo); hi = Math.ceil(hi); }
  const W = 420, pad = 12;
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const passLeft = comparator === "<=";
  const colour = (side: string) => (side === "pass" ? "var(--pass)" : "var(--fail)");
  const tx = x(line);
  return (
    <div className="bar">
      <svg viewBox={`0 0 ${W} 58`} role="img"
        aria-label={`${T.results.barTarget} ${withUnit(line, unit)}`}>
        <rect x={pad} y={26} width={W - 2 * pad} height={6} rx={3} fill="var(--soft)" />
        <rect x={passLeft ? pad : tx} y={26} width={passLeft ? tx - pad : W - pad - tx} height={6} rx={3} fill="var(--pass-bg)" />
        {figures.map((f, i) => (
          f.low === f.high ? (
            <circle key={i} cx={x(f.low)} cy={29} r={6.5} fill={colour(f.side)} stroke="#fff" strokeWidth={2} />
          ) : (
            <rect key={i} x={x(f.low)} y={23} width={Math.max(4, x(f.high) - x(f.low))} height={12} rx={6}
              fill={colour(f.side)} opacity={0.85} stroke="#fff" strokeWidth={1.5} />
          )
        ))}
        <line x1={tx} x2={tx} y1={14} y2={44} stroke="var(--navy)" strokeWidth={2.5} />
        <text x={Math.min(Math.max(tx, 70), W - 70)} y={10} textAnchor="middle" fontSize="12" fill="var(--navy)" fontWeight={600}>
          {T.results.barTarget} {withUnit(line, unit)}
        </text>
        <text x={pad} y={56} fontSize="11" fill="var(--muted)">{fmtNum(lo)}</text>
        <text x={W - pad} y={56} fontSize="11" fill="var(--muted)" textAnchor="end">{withUnit(hi, unit)}</text>
      </svg>
    </div>
  );
}

export interface CardData { code: string; text: string; must_have: boolean; unit: string; comparator: string; line: number;
  result: string; confidence: string; why: string; evidence_ids: string[]; figures: BarFigure[]; changed?: boolean }

export function cardFromHypothesis(h: Hypothesis): CardData | null {
  const v = h.verdict;
  if (!v) return null;
  const d = v.detail_json || {};
  return {
    code: h.code, text: h.text, must_have: h.must_have, unit: h.measure_unit, comparator: h.comparator,
    line: d.line ?? h.line ?? 0, result: v.result, confidence: v.confidence, why: v.why, evidence_ids: v.evidence_ids || [],
    figures: (d.figures || []).filter((f: any) => f.low != null).map((f: any) => ({
      evidence_id: f.evidence_id, low: f.low, high: f.high, side: f.side, boundary: f.boundary })),
  };
}

export function ResultCard({ c, children }: { c: CardData; children?: React.ReactNode }) {
  const { openEvidence } = useCtx();
  const dir = c.comparator === ">=" ? T.step3.atLeast : T.step3.atMost;
  return (
    <div className={`result${c.changed ? " changed" : ""}`}>
      <div className="result-head">
        <div>
          <div className="result-idea"><span className="code">{c.code}</span>{c.text}</div>
          <div className="result-target">{T.results.target}: {dir} {withUnit(c.line, c.unit)}{c.must_have ? ` · ${T.results.critical}` : ""}</div>
        </div>
      </div>
      <div className="result-line"><ResultPill result={c.result} /><Confidence level={c.confidence} /></div>
      {c.figures.length ? <TargetBar line={c.line} unit={c.unit} figures={c.figures} comparator={c.comparator} /> : null}
      <p className="result-why">{c.why}</p>
      <div className="row wrap">
        <span className="small muted">{T.results.evidence}:</span>
        {c.evidence_ids.length ? c.evidence_ids.map((id) => <IdChip key={id} id={id} onOpen={openEvidence} />) :
          <span className="small muted">{T.results.noEvidence}</span>}
      </div>
      {children}
    </div>
  );
}

// Behind Details on a result card: every piece of evidence linked to the idea, and how it's used.
export function Reasoning({ h }: { h: Hypothesis }) {
  const { b, openEvidence } = useCtx();
  const links = b.evidence.flatMap((e) => e.links.filter((l) => l.hypothesis_code === h.code).map((l) => ({ e, l })));
  const counted = new Set(h.verdict?.evidence_ids || []);
  return (
    <Details inline title={T.results.fullReasoning}>
      <p className="small">{(h.verdict?.reason_codes || []).length ? h.verdict?.why : ""}</p>
      <p className="label">{T.results.everyPiece}</p>
      <table className="t">
        <tbody>
          {links.map(({ e, l }) => (
            <tr key={`${e.id}-${l.role}-${l.figure_index}`}>
              <td><IdChip id={e.id} onOpen={openEvidence} /></td>
              <td className="ellipsis">{e.claim || e.title}</td>
              <td className="nowrap">{T.step7.roles[l.role]}</td>
              <td className="nowrap small">{counted.has(e.id) ? T.results.counted :
                T.results.notCounted(e.duplicate_of ? T.evidence.duplicateOf(e.duplicate_of) : (T.evidence.status[e.status] || e.status))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Details>
  );
}
