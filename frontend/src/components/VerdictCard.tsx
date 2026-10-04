import type { Hypothesis } from "../api/types";
import { EChip, Meter, ResultPill, Term, withUnit } from "./ui";

export function VerdictCard({ h, result, confidence, why, evidenceIds, line, changed, onOpen, checkedIds }: {
  h: Hypothesis; result: string; confidence: string; why: string; evidenceIds: string[]; line?: number | null;
  changed?: boolean; onOpen?: (id: string) => void; checkedIds?: Set<string>;
}) {
  const L = line ?? h.line;
  return (
    <div className={`vcard ${changed ? "changed" : ""}`}>
      <div className="vcard-top">
        <span className="vcode">{h.code}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{h.text}</div>
          <div className="vline">
            <Term t="pass line">Pass line</Term>: <b>{h.comparator === ">=" ? "at least" : "at most"} {withUnit(L, h.measure_unit)}</b>
            {" · "}{h.measure_name}{h.must_have && <> · <span className="pill lock">must-have</span></>}
          </div>
        </div>
      </div>
      <div className="row">
        <ResultPill result={result} />
        <Meter level={confidence} />
        {changed && <span className="pill orange">changed</span>}
      </div>
      <div className="row small">
        <span className="muted">Counted evidence:</span>
        {evidenceIds.length ? evidenceIds.map((id) => <EChip key={id} id={id} onOpen={onOpen} checked={checkedIds?.has(id)} />) : <span className="muted">none</span>}
      </div>
      <p className="small">{why}</p>
    </div>
  );
}
