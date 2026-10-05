/* Offline preview layer for user-journey-demo.html.
   It answers the real app's /api requests from states recorded on the real backend (Sample 1, demo data mode),
   fakes the background jobs with timers, and adds the review side panel. It does not change the app itself. */
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("rw-preview-data").textContent);
  const S = DATA.states, M = DATA.meta;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();

  // ------------------------------------------------------------------ preview state
  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
                  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked: sign in again */ } },
                  clear() { try { sessionStorage.clear(); } catch (e) { /* nothing to clear */ } } };
  let signedIn = store.get("rw-preview-signed-in") === "1";   // stands in for the real app's sign-in cookie
  let appSettings = clone(M.settings);
  let archive = [];
  const cases = {};            // id -> {b: bundle, acts: activity}
  let nextId = 1, actId = 100000;
  const timers = [];

  function load(id, stateName, keepActs) {
    const st = S[stateName];
    const c = cases[id];
    const b = clone(st.bundle);
    b.case.id = id;
    c.b = b;
    if (st.activity && st.activity.length) c.acts = clone(st.activity);
    else if (!keepActs) c.acts = c.acts || [];
  }
  function log(c, actor, step, message) {
    c.acts.push({ id: ++actId, ts: nowIso(), actor, event_type: "preview", step, message, case_id: c.b.case.id });
  }
  function job(kind, status, extra) {
    return Object.assign({ id: Math.floor(Math.random() * 1e6), kind, status, error: "", progress: {},
      started_at: nowIso(), finished_at: status === "running" ? null : nowIso() }, extra || {});
  }
  // fake a background job: show a "running" version, then switch to the recorded result
  function runJob(id, kind, target, ms, interim) {
    const c = cases[id];
    const b = clone(S[target].bundle);
    b.case.id = id;
    if (interim) interim(b);
    b.jobs[kind] = job(kind, "running", { progress: { label: "" } });
    b.running_jobs = [kind];
    c.b = b;
    timers.push(setTimeout(() => { if (cases[id]) load(id, target); }, ms));
  }
  function runSequence(id, names, ms) {
    const t0 = nowIso();
    names.forEach((n, i) => timers.push(setTimeout(() => {
      if (!cases[id]) return;
      load(id, n, true);
      const b = cases[id].b;
      for (const k of b.running_jobs) b.jobs[k].started_at = t0;
    }, i * ms)));
  }

  // ------------------------------------------------------------------ review counts (same rules as the server)
  function review(b) {
    const items = b.evidence.filter((e) => !e.trip_id);
    const auto = items.filter((e) => e.bucket === "auto"), dec = items.filter((e) => e.bucket === "decision");
    const picks = items.filter((e) => e.spot_check_selected);
    const r = { auto_total: auto.length, auto_seen: auto.filter((e) => e.seen_by_consultant).length,
      decision_total: dec.length, decided: dec.filter((e) => e.status !== "needs_decision").length,
      spot_total: picks.length, spot_done: picks.filter((e) => e.spot_check_result).length,
      sources_box: !!(b.case.settings_json || {}).sources_reviewed_at, double_check: appSettings.app.double_check !== false };
    const m = [];
    if (r.decided < r.decision_total) { const n = r.decision_total - r.decided; m.push(`Decide ${n} more item${n !== 1 ? "s" : ""}`); }
    if (r.auto_seen < r.auto_total) { const n = r.auto_total - r.auto_seen; m.push(`Look at ${n} more source${n !== 1 ? "s" : ""}`); }
    if (!r.sources_box) m.push("Tick \"I've checked these sources\"");
    r.missing = m; r.ready = !m.length;
    b.review = r;
    return r;
  }
  const LABELS = { auto_approved: "Passed the quality check", approved: "Accepted by you", needs_decision: "Needs your call",
    client_reported: "From the client", belief_under_test: "Client's claim", cross_check: "Sense check only", rejected: "Rejected" };
  const DECISIONS = { approve: "approved", keep_client_reported: "client_reported", keep_belief: "belief_under_test",
    keep_cross_check: "cross_check", reject: "rejected" };

  // ------------------------------------------------------------------ what if: the engine's verdict rules, ported
  function fmt(x) {             // same rules as the engine's number formatting
    if (x == null) return "?";
    if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString("en-US");
    if (Math.abs(x) >= 100) return x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (Math.abs(x) < 1) return String(Number(x.toPrecision(4)));
    if (Math.abs(x) < 10) return String(Number(x.toPrecision(3)));
    return x.toFixed(1);
  }
  function withUnit(v, u) { u = (u || "").trim(); return u.startsWith("%") || !u ? fmt(v) + u : `${fmt(v)} ${u}`; }
  function figText(f, u) { return f.low === f.high ? (u ? withUnit(f.low, u) : fmt(f.low)) : `${fmt(f.low)} to ${u ? withUnit(f.high, u) : fmt(f.high)}`; }
  function join(p) { return p.length === 1 ? p[0] : p.length ? p.slice(0, -1).join(", ") + " and " + p[p.length - 1] : ""; }
  function classify(low, high, L, cmp, tol) {
    const T = Math.abs(L) * tol / 100, d = cmp === ">=" ? 1 : -1;
    if (low !== high && low <= L && L <= high) return [((low + high) / 2 - L) * d >= 0 ? "pass" : "fail", true];
    const nearest = Math.abs(low - L) <= Math.abs(high - L) ? low : high, margin = (nearest - L) * d;
    return [margin >= 0 ? "pass" : "fail", Math.abs(margin) <= T];
  }
  function verdictOf(figs, L, cmp, tol, ft, unit, minSrc) {
    const n = new Set(figs.map((f) => f.origin)).size, need = minSrc[ft] || (ft === "market" ? 2 : 1);
    const target = `the target of ${cmp === ">=" ? "at least" : "at most"} ${withUnit(L, unit)}`;
    const figures = join([...new Set(figs.map((f) => figText(f, unit)))].sort());
    if (n < need) {
      const why = n === 0 ? `No usable evidence yet. This idea needs ${need} separate source${need > 1 ? "s" : ""} to compare with ${target}.`
        : `Only ${n} separate source so far (${figures}). This ${ft === "market" ? "market figure" : "idea"} needs ${need}.`;
      return ["not_enough", "none", why];
    }
    const cls = figs.map((f) => { const [side, b] = classify(f.low, f.high, L, cmp, tol);
      return { side, b, straddles: f.low !== f.high && f.low <= L && L <= f.high, text: figText(f, unit) }; });
    const sides = new Set(cls.map((c) => c.side)), boundary = cls.some((c) => c.b);
    let res, conf, why;
    if (sides.size === 2) {
      res = "conflicting"; conf = "low";
      const p = cls.filter((c) => c.side === "pass").map((c) => c.text), f = cls.filter((c) => c.side === "fail").map((c) => c.text);
      why = `The sources disagree. ${join(p)} meet${p.length === 1 ? "s" : ""} ${target}, but ${join(f)} do${f.length === 1 ? "es" : ""} not.`;
      return [res, conf, why];
    }
    res = sides.has("pass") ? "holds" : "fails";
    const singleCalc = ft === "market" && n === 1 && figs.every((f) => f.calculated);
    if (boundary || singleCalc) conf = "low";
    else if (figs.every((f) => f.client_reported) || n < 2) conf = "medium";
    else conf = "high";
    let verb = res === "holds" ? "meet" : "miss";
    if (figs.length === 1) verb += verb === "miss" ? "es" : "s";
    why = `${figures} ${verb} ${target}`;
    const st = cls.filter((c) => c.b && c.straddles).map((c) => c.text), nr = cls.filter((c) => c.b && !c.straddles).map((c) => c.text);
    if (st.length || nr.length) {
      const parts = [];
      if (st.length) parts.push(`the range ${join(st)} include${st.length === 1 ? "s" : ""} the target`);
      if (nr.length) parts.push(`${join(nr)} ${nr.length === 1 ? "is" : "are"} within the ${fmt(tol)}% close-call margin`);
      why += ". It's a close call: " + parts.join(" and ");
    } else why += " by more than the close-call margin";
    if (singleCalc) why += ". It rests on one calculated figure";
    if (conf === "medium") why += figs.every((f) => f.client_reported) ? ". Confidence stays at Fair because the evidence comes from the client" : ". There's only one separate source";
    else if (conf === "high") why += `, and ${n} separate sources agree`;
    why += ".";
    return [res, conf, why.charAt(0).toUpperCase() + why.slice(1)];
  }
  function evalFormula(expr, vals) {
    const toks = expr.match(/\d+(\.\d+)?|[a-z_][a-z0-9_]*|[()+\-*/,]/gi) || [];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    function prim() {
      const t = next();
      if (t === "(") { const v = add(); next(); return v; }
      if (t === "-") return -prim();
      if (/^\d/.test(t)) return parseFloat(t);
      if (t === "min" || t === "max") { next(); const a = add(); next(); const c = add(); next(); return t === "min" ? Math.min(a, c) : Math.max(a, c); }
      if (t in vals) return vals[t];
      throw new Error("unknown " + t);
    }
    function mul() { let v = prim(); while (peek() === "*" || peek() === "/") v = next() === "*" ? v * prim() : v / prim(); return v; }
    function add() { let v = mul(); while (peek() === "+" || peek() === "-") v = next() === "+" ? v + mul() : v - mul(); return v; }
    return add();
  }
  function whatIf(b, body) {
    const assumptions = body.assumptions || {}, lines = body.pass_lines || {};
    const minSrc = b.rules.thresholds.minimum_sources;
    const ev = Object.fromEntries(b.evidence.map((e) => [e.id, e]));
    const rows = b.hypotheses.filter((h) => !h.removed_reason).map((h) => {
      const vals = Object.fromEntries((h.assumptions_json || []).map((a) => [a.name, a.name in assumptions ? +assumptions[a.name] : +a.value]));
      let line = h.pass_line_formula ? evalFormula(h.pass_line_formula, vals) : h.pass_line_value;
      const locked = h.line;
      if (h.code in lines && lines[h.code] != null) line = +lines[h.code];
      const d = (h.verdict || {}).detail_json || {};
      const figs = (d.figures || []).map((f) => ({ low: f.low, high: f.high, client_reported: f.client_reported, calculated: f.calculated,
        evidence_id: f.evidence_id, origin: (ev[f.evidence_id] || {}).original_group_id || f.evidence_id }));
      const [result, confidence, why] = verdictOf(figs, line, h.comparator, h.tolerance_pct, h.fact_type, h.measure_unit, minSrc);
      const cur = h.verdict || {};
      return { code: h.code, text: h.text, must_have: h.must_have, unit: h.measure_unit, comparator: h.comparator, line, locked_line: locked,
        result, confidence, why, evidence_ids: figs.map((f) => f.evidence_id), changed: cur.result !== result || cur.confidence !== confidence };
    });
    const must = rows.filter((r) => r.must_have), failed = must.filter((r) => r.result === "fails").map((r) => r.code);
    const unsettled = must.filter((r) => r.result === "conflicting" || r.result === "not_enough").map((r) => r.code);
    let overall, text;
    if (failed.length) { overall = "not_achievable"; text = `Critical idea ${join(failed)} is not supported, so the plan is not achievable at the agreed targets.`; }
    else if (unsettled.length) { overall = "consultant_decides"; text = `Critical idea ${join(unsettled)} isn't settled yet, so the answer needs your decision.`; }
    else { overall = "achievable"; text = "Every critical idea is supported, so the plan is achievable at the agreed targets."; }
    const L = { not_achievable: "Not achievable", consultant_decides: "Needs your decision", achievable: "Achievable" };
    return { ideas: rows, overall, overall_label: L[overall], rule_applied: text, overall_changed: !!(b.overall && b.overall.result !== overall),
      locked_plan_unchanged: true };
  }

  // ------------------------------------------------------------------ stress test: make a slider value the real target
  // Same steps as the server: reopen the plan, change the target, lock it again, re-test every idea in code (the
  // ported verdict rules above), then add it up again. Evidence and decisions are kept.
  const RESULT = { holds: "Supported", fails: "Not supported", conflicting: "Sources disagree", not_enough: "Not enough evidence" };
  const CONF = { high: "Strong", medium: "Fair", low: "Weak" };
  function sliderRange(v, h) {
    if (h.slider_min != null && h.slider_max != null) return [h.slider_min, h.slider_max];
    let lo = v === 0 ? -10 : Math.min(v * 0.5, v * 1.5), hi = v === 0 ? 10 : Math.max(v * 0.5, v * 1.5);
    lo = Math.max(0, lo);
    return [Math.round(lo * 1e4) / 1e4, Math.round(hi * 1e4) / 1e4];
  }
  function retarget(c, body) {
    const b = c.b;
    if (!b.progress.done["8"]) return err(409, "Run the tests first.", ["Run tests"]);
    const row = b.sliders.find((s) => s.kind === body.kind && s.key === body.key);
    const value = +body.value;
    if (!row) return err(400, "That slider isn't available. Refresh the page and try again.");
    if (!(value >= row.min - 1e-9 && value <= row.max + 1e-9)) return err(400, "Keep the value inside the slider's range.");
    if (Math.abs(value - row.value) < 1e-9) return err(400, "Move the slider first. This value is already your target.");
    const w = whatIf(b, body.kind === "assumption" ? { assumptions: { [body.key]: value } } : { pass_lines: { [body.key]: value } });
    const extra = body.kind === "assumption" ? ` (${row.label}: ${fmt(row.value)} to ${fmt(value)} ${row.unit})` : "";
    log(c, "consultant", 3, "Reopened the targets at step 3 to use a stress-test value");
    for (const h of b.hypotheses.filter((x) => !x.removed_reason)) {
      const r = w.ideas.find((x) => x.code === h.code);
      if (body.kind === "pass_line" && h.code === body.key) { h.pass_line_formula = null; h.pass_line_value = value; }
      if (body.kind === "assumption") h.assumptions_json = (h.assumptions_json || []).map((a) => (a.name === body.key ? Object.assign({}, a, { value }) : a));
      if (Math.abs(r.line - h.line) > 1e-9) {
        log(c, "consultant", 3, `Changed ${h.code} target from ${fmt(h.line)} to ${fmt(r.line)} ${h.measure_unit} after the stress test${extra}`);
        h.pass_line_source_note = (h.pass_line_source_note ? h.pass_line_source_note + " " : "") + `Changed from ${fmt(h.line)} to ${fmt(r.line)} after the stress test.`;
        h.line = r.line; h.line_text = withUnit(r.line, h.measure_unit);
      }
      const v = h.verdict;
      h.verdict = Object.assign({}, v, { result: r.result, confidence: r.confidence, why: r.why, version: (v.version || 1) + 1,
        detail_json: Object.assign({}, v.detail_json, { line: r.line, figures: (v.detail_json.figures || []).map((f) => {
          const [side, boundary] = classify(f.low, f.high, r.line, h.comparator, h.tolerance_pct);
          return Object.assign({}, f, { side, boundary, straddles: f.low !== f.high && f.low <= r.line && r.line <= f.high }); }) }),
        computed_at: nowIso() });
    }
    log(c, "consultant", 3, "Locked the targets again. Evidence you reviewed is kept.");
    log(c, "rule_engine", 8, "Cleared the results from step 8 onwards to run them again");
    for (const r of w.ideas) log(c, "rule_engine", 8, `${r.code}: ${RESULT[r.result]}${r.confidence !== "none" ? ", confidence " + CONF[r.confidence] : ""}. ${r.why}`);
    for (const s of b.sliders) {
      const h = b.hypotheses.find((x) => x.code === s.idea);
      if (s.kind === "pass_line") { s.value = h.line; [s.min, s.max] = sliderRange(h.line, h); }
      else if (s.key === body.key) s.value = value;
    }
    // the adding-up runs again; the stored summary no longer matches every result, so a plain one is built from them
    const changed = w.ideas.some((r) => r.changed);
    const unknowns = (b.summary || {}).unknowns || [];
    b.overall = null; b.summary = null;
    if (b.conclusion) b.conclusion.saved_at = null;
    b.progress.done["10"] = b.progress.done["11"] = b.progress.done["12"] = false;
    for (const st of b.progress.steps) { st.current = st.n === 8; if (st.n >= 10) st.state = "open"; }
    b.progress.current = 8;
    b.jobs.addup = job("addup", "running", { progress: { label: "Writing the summary" } });
    b.running_jobs = ["addup"];
    log(c, "consultant", 10, "Asked for the answer to be added up");
    timers.push(setTimeout(() => {
      b.overall = { case_id: b.case.id, result: w.overall, label: w.overall_label, rule_applied: w.rule_applied, stale: false, computed_at: nowIso() };
      const sentences = changed ? b.hypotheses.filter((h) => !h.removed_reason).map((h) => ({
        text: `${h.code} (${h.measure_name}): ${RESULT[h.verdict.result]}${h.verdict.confidence !== "none" ? ", confidence " + CONF[h.verdict.confidence] : ""}. ${h.verdict.why}`,
        evidence_ids: h.verdict.evidence_ids || [] })).filter((x) => x.evidence_ids.length) : S.s10_added.bundle.summary.sentences;
      b.summary = { case_id: b.case.id, sentences, version: 2, source: changed ? "template" : "llm", unknowns };
      b.jobs.addup = job("addup", "done"); b.running_jobs = [];
      for (const st of b.progress.steps) { if (st.n === 10 || st.n === 11) st.state = "done"; st.current = st.n === 12; }
      b.progress.done["10"] = b.progress.done["11"] = true; b.progress.current = 12;
      log(c, "rule_engine", 10, `Added up the results using the locked rule: ${w.overall_label}. ${w.rule_applied}`);
      log(c, "rule_engine", 10, changed ? "Built a plain summary from the results" : "Drafted the summary. Every sentence cites its evidence and passed the checks.");
    }, 2400));
    return ok({ job: b.jobs.addup });
  }

  // ------------------------------------------------------------------ the fake /api
  const ok = (body) => ({ status: 200, body: body === undefined ? { ok: true } : body });
  const err = (status, reason, required) => ({ status, body: { reason, required: required || [] } });

  function caseList() {
    return Object.values(cases).map((c) => ({ id: c.b.case.id, title: c.b.case.title, client_name: c.b.case.client_name,
      sample: c.b.case.sample, mode: "fixtures", current_step: c.b.progress.current, updated_at: nowIso(), status: "open" }));
  }

  function handle(method, url, body) {
    const u = new URL(url, "http://preview.local");
    const p = u.pathname.replace(/^\/api/, "");
    if (p === "/session") return ok({ required: true, signed_in: signedIn });
    if (p === "/login") return body && body.passcode ? (signedIn = true, store.set("rw-preview-signed-in", "1"), ok()) : err(401, "That passcode isn't right. Check it and try again.");
    if (!signedIn) return err(401, "Enter the passcode to continue.");
    if (p === "/settings") {
      if (method === "PUT") {
        const before = appSettings.app.double_check !== false;
        Object.assign(appSettings.app, body || {});
        const after = appSettings.app.double_check !== false;
        if (before !== after) for (const c of Object.values(cases)) if (c.b.review && !c.b.progress.done["7"])
          log(c, "consultant", 7, after ? "Switched the quick double-check on in Settings" : "Switched the quick double-check off in Settings");
      }
      return ok(appSettings);
    }
    if (p === "/samples") return ok(M.samples);
    if (p === "/selfcheck") return ok(M.selfcheck);
    if (p === "/archive" && method === "GET") return ok(archive);
    if (p === "/archive" && method === "POST") { archive.unshift({ id: archive.length + 1, title: body.title || body.filename, filename: body.filename, published_date: body.date || "" }); return ok({ id: archive.length }); }
    if (/^\/archive\/\d+$/.test(p)) { archive = archive.filter((a) => a.id !== +p.split("/")[2]); return ok(); }
    if (p === "/cases" && method === "GET") return ok(caseList());
    if (p === "/cases/import") return err(400, "Import a case isn't included in this preview. Open the sample case instead.");
    if (p === "/samples/sample_01_card_launch/load") {
      const id = nextId++; cases[id] = { acts: [] }; load(id, "s1_loaded"); return ok({ id });
    }
    if (/^\/samples\/[^/]+\/load$/.test(p)) return err(400, "This preview only includes the credit card sample. Choose that one instead.");
    if (/^\/samples\/[^/]+\/replies\//.test(p)) return { status: 200, binary: M.sample_reply.b64 };
    if (p === "/cases" && method === "POST") {
      const id = nextId++, b = clone(M.blank_new); b.case.id = id; b.case.title = "New case";
      cases[id] = { b, acts: [{ id: ++actId, ts: nowIso(), actor: "consultant", event_type: "case_created", step: 1, message: "Started a case" }], blank: true };
      return ok({ id });
    }
    const m = p.match(/^\/cases\/(\d+)(\/.*)?$/);
    if (!m) return err(404, "Not found");
    const id = +m[1], rest = m[2] || "", c = cases[id];
    if (!c) return err(404, `Case ${id} not found`);
    const b = c.b;
    if (rest === "" && method === "GET") { if (b.review) review(b); return ok(b); }
    if (rest === "" && method === "PUT") {
      for (const k of ["client_name", "country", "industry", "function", "raw_ask", "title", "client_aliases", "private_numbers"]) if (k in body) b.case[k] = body[k];
      if ("ai_reads_client_files" in body) b.case.settings_json.ai_reads_client_files = body.ai_reads_client_files;
      return ok();
    }
    if (rest === "" && method === "DELETE") { delete cases[id]; return ok(); }
    if (rest === "/reset") { if (c.blank) { const nb = clone(M.blank_new); nb.case.id = id; c.b = nb; } else load(id, "s1_loaded"); log(c, "consultant", 1, "Reset the case to step 1"); return ok(); }
    if (rest === "/activity") {
      if (u.searchParams.get("format") === "csv") return { status: 200, text: "id,time,actor,step,event,message\n" + c.acts.map((a) => [a.id, a.ts, a.actor, a.step, a.event_type, JSON.stringify(a.message)].join(",")).join("\n") };
      return ok(c.acts);
    }
    if (rest === "/files") { b.files.push({ id: 900 + b.files.length, filename: body.filename || "pasted-note.txt", kind: "initial", figures: [], trip_id: null, preview: "" }); log(c, "client", 1, `Added the file ${body.filename || "pasted note"}`); return ok({ file_id: 900 }); }
    if (rest === "/read-ask") {
      if (c.blank) {
        b.jobs.frame = job("frame", "running"); b.running_jobs = ["frame"];
        timers.push(setTimeout(() => { b.jobs.frame = Object.assign({}, M.blank_failed_job, { started_at: nowIso(), finished_at: nowIso() }); b.running_jobs = []; }, 1500));
        return ok({ job: b.jobs.frame });
      }
      runJob(id, "frame", "s1_framed", 2200, (nb) => { nb.frame = null; nb.progress = clone(b.progress); });
      return ok();
    }
    if (rest === "/frame" && method === "PUT") { Object.assign(b.frame, body); log(c, "consultant", 2, "Edited the question"); return ok(); }
    if (rest === "/frame/confirm") { runJob(id, "plan", "s2_planned", 2600, (nb) => { nb.hypotheses = []; }); return ok(); }
    if (rest === "/hypotheses" && method === "PUT") {
      for (const row of body) { const h = b.hypotheses.find((x) => x.code === row.code); if (h) Object.assign(h, row); }
      log(c, "consultant", 3, "Edited the ideas: " + body.map((r) => r.code).join(", "));
      return ok();
    }
    if (rest === "/plan/lock") {
      if (!body.ticked) return err(409, "Tick the box to confirm the targets first.");
      runJob(id, "route", "s3_locked", 2400, (nb) => { nb.needs = []; });
      return ok();
    }
    if (rest === "/source-plan" && method === "PUT") {
      for (const r of body) {
        const pi = b.plan.find((x) => x.id === r.id);
        if (pi) { pi.included = !!r.included; pi.removed_reason = r.included ? null : r.removed_reason; }
        else b.plan.push({ id: 800 + b.plan.length, source_name: r.source_name, domain: r.domain, origin_type: "open_web", tier: r.stated_tier, stated_by_consultant: true, included: true });
      }
      log(c, "consultant", 4, "Edited the sources"); return ok();
    }
    if (/^\/needs\/[^/]+\/query$/.test(rest)) { return ok(); }
    if (rest === "/requests/mark-sent") {
      if (!body.reviewed) return err(409, "Tick \"I've checked what goes out\" first.");
      runSequence(id, ["s5_collect_0", "s5_collect_1", "s5_collect_2", "s5_collect_3", "s6_clean_0", "s6_clean_1", "s6_clean_2", "s6_clean_3", "s7_review"], 1100);
      return ok();
    }
    if (rest === "/collect/stop") { timers.forEach(clearTimeout); runSequence(id, ["s6_clean_0", "s6_clean_2", "s7_review"], 1000); return ok(); }
    let mm;
    if ((mm = rest.match(/^\/evidence\/(E\d+)\/decision$/))) {
      const e = b.evidence.find((x) => x.id === mm[1]);
      const calc = (e.figures_json || []).filter((f) => f.kind === "calculated" && !f.derivation.formula_confirmed);
      if (body.action === "reject" && !(body.reason || "").trim()) return err(409, "Add a short reason for rejecting it.");
      let note = "";
      if ((body.action === "approve" || body.action === "keep_client_reported") && calc.length) {
        if (e.formula_needs_you && !body.confirm_formula)
          return err(409, `Use "Accept and confirm formula" for ${e.id}: its calculation combines figures from different sources or uses an assumption.`);
        note = body.confirm_formula ? " (formula confirmed by you)" : " (formula checked)";
        calc.forEach((f) => { f.derivation.formula_confirmed = true; });
        e.formula_needs_you = false;
      }
      e.status = DECISIONS[body.action]; e.status_label = LABELS[e.status]; e.decided_by = "consultant";
      e.decision_reason = (body.reason || "").trim(); e.seen_by_consultant = true;
      if (body.action === "keep_cross_check") e.links.forEach((l) => { if (l.role === "supports_test") l.role = "cross_check"; });
      const word = { approve: "Accepted", keep_client_reported: "Accepted as the client's data:", keep_belief: "Kept as the client's claim:", keep_cross_check: "Kept as a sense check only:", reject: "Rejected" }[body.action];
      log(c, "consultant", e.trip_id ? 9 : 7, `${word} ${e.id}${note}${e.decision_reason ? ": " + e.decision_reason : ""}`);
      review(b); return ok();
    }
    if ((mm = rest.match(/^\/evidence\/(E\d+)\/links$/))) { const e = b.evidence.find((x) => x.id === mm[1]); e.links = body.map((r) => Object.assign({ evidence_id: e.id, proposed_by: "consultant", confirmed: true }, r)); return ok(); }
    if ((mm = rest.match(/^\/review\/seen\/(E\d+)$/))) {
      const e = b.evidence.find((x) => x.id === mm[1]);
      if (body && body.send_to_review) { e.status = "needs_decision"; e.status_label = LABELS.needs_decision; e.bucket = "decision"; e.spot_check_selected = false; log(c, "consultant", 7, `Moved ${e.id} to Needs your call`); }
      else { e.seen_by_consultant = true; log(c, "consultant", 7, `Looked at the source of ${e.id}`); }
      review(b); return ok();
    }
    if ((mm = rest.match(/^\/review\/spot-check\/(E\d+)$/))) {
      const e = b.evidence.find((x) => x.id === mm[1]);
      if (body.skip) { e.spot_check_result = "skipped"; log(c, "consultant", 7, `Quick double-check skipped by you (${e.id})`); review(b); return ok(); }
      e.spot_check_result = body.matches ? "matches" : "does_not_match"; e.seen_by_consultant = true;
      if (!body.matches) { e.status = "needs_decision"; e.status_label = LABELS.needs_decision; e.bucket = "decision";
        e.checklist_json = e.checklist_json.concat([{ test: "Quick double-check", pass: false, threshold: "matches its source", actual: "spot check did not match" }]); }
      log(c, "consultant", 7, `Double-checked ${e.id}: ` + (body.matches ? "it matches its source" : "it doesn't match, so it moved to Needs your call"));
      review(b); return ok();
    }
    if (rest === "/review/confirm-sources") { b.case.settings_json.sources_reviewed_at = body.ticked ? nowIso() : null; review(b); return ok(); }
    if (rest === "/test/run") {
      const r = review(b);
      if (!r.ready) return err(409, "Finish the review first: " + r.missing.map((x) => x[0].toLowerCase() + x.slice(1)).join("; ") + ".", r.missing);
      load(id, "s8_tested"); return ok();
    }
    if (rest === "/trips" && method === "POST") { runJob(id, "trip_1", "s9_drafted", 2200, (nb) => { nb.trips[0].question = ""; }); return ok({ trip_id: 1 }); }
    if ((mm = rest.match(/^\/trips\/(\d+)$/)) && method === "PUT") { b.trips[0].question = body.question; return ok(); }
    if (/^\/trips\/\d+\/(sent|mark-sent)$/.test(rest)) { b.trips[0].marked_sent_at = nowIso(); log(c, "consultant", 9, "Marked request 1 for H2 as sent. The tool sent nothing itself."); return ok(); }
    if (/^\/trips\/\d+\/reply$/.test(rest)) { runJob(id, "trip_reply_1", "s9_replied", 2400, (nb) => { nb.evidence = nb.evidence.filter((e) => !e.trip_id); }); return ok(); }
    if (/^\/trips\/\d+\/sample-mix$/.test(rest)) { b.trips[0].sample_mix_json = body.not_applicable ? { not_applicable: true } : b.trips[0].sample_mix_json; return ok(b.trips[0].sample_mix_json); }
    if (rest === "/retest") {
      const open = b.evidence.filter((e) => e.trip_id && e.status === "needs_decision").map((e) => e.id);
      if (open.length) return err(409, "Make a call on the new evidence first: " + open.join(", ") + ".", open);
      load(id, "s9_retested"); return ok();
    }
    if (rest === "/addup/run") { runJob(id, "addup", "s10_added", 2800, (nb) => { nb.overall = null; nb.summary = null; }); return ok(); }
    if (rest === "/whatif") return ok(whatIf(b, body || {}));
    if (rest === "/plan/retarget") return retarget(c, body || {});
    if (rest === "/unknowns") return ok((b.summary || {}).unknowns || []);
    if (rest === "/conclusion") {
      if (!(body.text || "").trim()) return err(400, "Write your conclusion in the box first.");
      b.conclusion = { case_id: id, text: body.text, saved_at: nowIso() };
      b.progress.steps[11].state = "done"; b.progress.done["12"] = true;
      log(c, "consultant", 12, "Saved your conclusion"); return ok();
    }
    if (rest === "/sample/advance") {
      const to = +u.searchParams.get("to");
      const target = to <= 2 ? "s1_framed" : to === 3 ? "s2_planned" : to === 4 ? "s3_locked" : to <= 7 ? "s7_review" : to <= 9 ? "s8_tested" : to === 10 ? "s9_retested" : "s10_added";
      runJob(id, "advance", target, 2000, (nb) => { nb.progress = clone(b.progress); });
      log(c, "system", b.progress.current, `Skipped ahead to step ${to} using the sample's recorded answers (sample data)`);
      return ok();
    }
    if (rest === "/export") {
      const f = u.searchParams.get("format");
      if (f === "md") return { status: 200, text: M.exports.md, file: "Credit_card_launch_India_(sample).md" };
      if (f === "json") return { status: 200, text: M.exports.json, file: "Credit_card_launch_India_(sample).json" };
      return err(400, "Choose Markdown, JSON or the printable page.");
    }
    if (rest === "/use-demo-data" || rest === "/fresh-answers") return ok();
    return err(404, "This action isn't included in the preview.");
  }

  async function bodyOf(init) {
    if (!init || init.body == null) return undefined;
    if (typeof init.body === "string") return JSON.parse(init.body);
    if (init.body instanceof FormData) {
      const o = {};
      for (const [k, v] of init.body.entries()) o[k] = v instanceof File ? (o.filename = v.name, "(file)") : v;
      return o;
    }
    return undefined;
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api")) return realFetch(input, init);
    const method = ((init && init.method) || "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, 120));               // a little latency, like a real server
    const res = handle(method, url, await bodyOf(init));
    if (res.binary) {
      const bin = Uint8Array.from(atob(res.binary), (ch) => ch.charCodeAt(0));
      return new Response(bin, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (res.text !== undefined) return new Response(res.text, { status: res.status, headers: { "content-type": "text/plain" } });
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { "content-type": "application/json" } });
  };

  // downloads and exports are links to /api in the real app: serve them from the recordings instead
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[href^='/api']");
    if (!a) return;
    ev.preventDefault();
    const res = handle("GET", a.getAttribute("href"));
    const text = res.text !== undefined ? res.text : JSON.stringify(res.body, null, 2);
    const name = res.file || (a.getAttribute("href").includes("csv") ? "history.csv" : "export.txt");
    const blob = new Blob([text], { type: "text/plain" });
    const l = document.createElement("a");
    l.href = URL.createObjectURL(blob); l.download = name; document.body.appendChild(l); l.click(); l.remove();
  }, true);

  // ------------------------------------------------------------------ review side panel
  const LIVE = "live", NONE = "none";
  const SCREENS = [
    { key: "passcode", name: "Passcode", api: NONE,
      user: "Types the passcode once per browser.",
      app: "Compares it with ADMIN_PASSCODE on the server and sets a secure sign-in cookie. Every data request needs it. In this preview any passcode works." },
    { key: "home", name: "Home", api: NONE,
      user: "Chooses Start a case for a real client, or Try a sample to see a finished example. Opens or deletes recent cases.",
      app: "Lists the cases saved in the app's database. Loading a sample copies its stored case, files and answers." },
    { key: "step1", n: 1, name: "Describe the ask", api: LIVE, apis: "Claude API (fast model reads each client file; smart model splits the ask)",
      user: "Fills in client, country, industry, function and the ask; adds files; lists private numbers in Never send these. Clicks Check the ask.",
      app: "Saves the case, reads each client file and pulls out figures with quotes, checks every quote word for word in code, then drafts the question. The client's name is replaced with \"the client\" before anything goes to the AI." },
    { key: "step2", n: 2, name: "Confirm the question", api: LIVE, apis: "Claude API (smart model drafts ideas); Tavily web search for benchmark targets",
      user: "Checks and edits what the client believes, the decision, and how numbers are compared. Clicks Confirm question.",
      app: "Drafts 2 to 6 ideas, each with a target. For targets based on a benchmark it writes a search (checked for private terms), searches the web, reads the result, and rates its source quality and date in code." },
    { key: "step3", n: 3, name: "Set the targets", api: LIVE, apis: "Claude API (fast model routes each need and writes searches)",
      user: "Reviews each idea's type, measure and target, marks Critical ideas, removes ideas with a reason, ticks the box and clicks Lock targets.",
      app: "Locks targets, margins and the quality check so they can't change (the server refuses edits). Then it decides where each answer will come from, checks which client files already answer it, and writes one search per need with private terms removed." },
    { key: "step4", n: 4, name: "Plan the research", api: NONE, apis: "Nothing yet. Clicking Mark as sent starts Tavily web searches",
      user: "Reads the Answers, Sources and Requests tabs, unticks sources, copies the client request and expert questions, ticks I've checked what goes out, clicks Mark as sent.",
      app: "Shows what would go out next to the original wording. Sends nothing: Mark as sent only records the click, then starts gathering." },
    { key: "step5", n: 5, name: "Gathering evidence", api: LIVE, apis: "Tavily web search (one search per need, at most 4 sources each, cached)",
      user: "Watches progress. Can click Stop collecting to keep what has arrived.",
      app: "Runs the searches on the ticked sources only, searches the firm archive by keyword (local, no API), adds the client's files, and lists what is still waiting." },
    { key: "step6", n: 6, name: "Checking the evidence", api: LIVE, apis: "Claude API (fast model reads each source and links it to ideas)",
      user: "Nothing to do. Reads the counts and merged duplicates, then clicks Review evidence.",
      app: "Drops exact copies before reading (free), reads each source, checks every quote word for word, converts units, merges copies of the same original, rates source quality, links evidence to ideas, works out any calculations in code, and runs the 9-test quality check." },
    { key: "step7", n: 7, name: "Review the evidence", api: NONE,
      user: "Makes a call on each item (Accept, or Reject with a one-click reason), marks each passed source as Seen, ticks the box, clicks Run tests. The quick double-check of one source is optional (Matches, Doesn't match or Skip).",
      app: "Records each decision in History. Accepting an item with a calculation also checks its formula; only a formula that mixes sources or uses an assumption asks for \"Accept and confirm formula\". Run tests stays disabled until every item is decided. Then plain code (no AI) gives each idea its result and confidence." },
    { key: "step8", n: 8, name: "Results", api: NONE,
      user: "Reads each idea against its target, opens Full reasoning, then clicks Fill the gaps (or Add it up).",
      app: "Shows the results computed in code at Run tests. Same evidence in, same result out." },
    { key: "step9", n: 9, name: "Fill the gaps", api: LIVE, apis: "Claude API (smart model drafts the question; fast model reads the reply)",
      user: "Clicks Draft question, edits it, sends it outside the tool, clicks Mark as sent, adds the reply, accepts the new evidence, clicks Test again, then Add it up.",
      app: "Drafts a narrower question (checked for private numbers), reads the reply and checks its quotes, runs the sample-mix check in code, reopens only that idea, then re-tests it in code." },
    { key: "step10", n: 10, name: "The answer", api: LIVE, apis: "Claude API (smart model writes the summary; fast model lists what is still unknown)",
      user: "Reads the overall answer and the sentences, opens evidence chips. Clicks Stress-test.",
      app: "Applies the rule locked at step 3 in code. Then writes 3 to 5 sentences; code rejects any sentence that cites a missing id or a number not in the data, and falls back to a plain summary if needed." },
    { key: "step11", n: 11, name: "What if...", api: NONE,
      user: "Moves sliders for each target and assumption and watches the cards and the answer change. To make a value real, clicks Use this as the new target and confirms. Then Write conclusion.",
      app: "Sliders recompute targets and results in code without saving anything. Use this as the new target reopens the plan, changes the target, locks it again, re-runs the tests and the adding-up, and records the change in History. Reviewed evidence is kept." },
    { key: "step12", n: 12, name: "Your conclusion", api: NONE,
      user: "Writes the conclusion, clicks Save conclusion, then Print or save PDF, Download Markdown or Download JSON.",
      app: "Saves the consultant's text. The tool never writes the conclusion. Exports are built in code from the stored case." },
    { key: "history", name: "History (drawer)", api: NONE,
      user: "Opens History from the top bar; can Export CSV.",
      app: "Shows the append-only record of every action, tagged You, Calculated or AI draft." },
    { key: "help", name: "Help (drawer)", api: NONE,
      user: "Opens Help from the top bar.", app: "Shows the 12 steps in one line each and six definitions." },
    { key: "settings", name: "Settings (drawer)", api: LIVE, apis: "Run checks only: one tiny Claude call per model and one Tavily search",
      user: "Changes data mode, fast mode, larger text and the quick double-check; skips a sample to a step; resets or deletes the case; adds firm archive documents; runs the set-up checks.",
      app: "Shows today's and this case's spend against the caps. Run checks tests the database, passcode, both model names, the Claude key and the Tavily key, with a fix for each red item. Skip to step replays the sample's stored answers through the normal checks." },
  ];
  const byKey = Object.fromEntries(SCREENS.map((s) => [s.key, s]));

  function currentKey() {
    const drawer = document.querySelector(".drawer h2");
    if (drawer) {
      const t = drawer.textContent.trim();
      if (t === "History") return "history"; if (t === "Help") return "help"; if (t === "Settings") return "settings";
    }
    if (document.querySelector("input[type=password]")) return "passcode";
    const mm = location.hash.match(/step\/(\d+)/);
    if (mm) return "step" + mm[1];
    if (/case\/\d+/.test(location.hash)) return "step1";
    return "home";
  }

  const css = `
  :root { --pv-w: 360px; }
  body.pv-open { margin-right: var(--pv-w); }
  body.pv-open .footer, body.pv-open .drawer { right: var(--pv-w) !important; }
  body.pv-open .scrim { right: var(--pv-w) !important; }
  #pv-panel { position: fixed; top: 0; right: 0; bottom: 0; width: var(--pv-w); background: #0f2747; color: #e8eef8; z-index: 1000;
    font-family: "Segoe UI", Arial, sans-serif; font-size: 14px; line-height: 1.5; display: flex; flex-direction: column; box-shadow: -6px 0 24px rgba(0,0,0,.18); }
  body:not(.pv-open) #pv-panel { width: 44px; }
  body:not(.pv-open) #pv-panel .pv-body { display: none; }
  #pv-panel .pv-head { display: flex; align-items: center; gap: 8px; padding: 14px 14px 10px; border-bottom: 1px solid rgba(255,255,255,.12); }
  #pv-panel .pv-head b { flex: 1; font-size: 15px; }
  #pv-panel button { font: inherit; cursor: pointer; }
  #pv-toggle { background: none; border: 1px solid rgba(255,255,255,.3); color: #fff; border-radius: 6px; padding: 2px 8px; }
  #pv-panel .pv-body { overflow-y: auto; padding: 14px 16px 24px; flex: 1; }
  .pv-tag { display: inline-block; background: #e9771a; color: #fff; font-weight: 700; border-radius: 99px; padding: 2px 10px; font-size: 12px; letter-spacing: .02em; }
  .pv-label { position: fixed; bottom: 86px; left: 16px; z-index: 999; pointer-events: none;
    background: #e9771a; color: #fff; font: 700 12px "Segoe UI", Arial, sans-serif; padding: 3px 12px; border-radius: 99px; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .pv-k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9fb3d1; margin: 14px 0 4px; font-weight: 700; }
  .pv-name { font-size: 20px; font-weight: 700; color: #fff; margin: 2px 0 0; }
  .pv-api { border-radius: 8px; padding: 8px 10px; margin-top: 6px; font-size: 13px; }
  .pv-api.live { background: #4a2a10; border: 1px solid #e9771a; }
  .pv-api.none { background: #123629; border: 1px solid #5cc79e; }
  .pv-api b { display: block; }
  .pv-list { list-style: none; padding: 0; margin: 4px 0 0; counter-reset: s; }
  .pv-list li { counter-increment: s; padding: 3px 0 3px 30px; position: relative; color: #c8d4e6; font-size: 13px; }
  .pv-list li::before { content: counter(s); position: absolute; left: 0; width: 22px; text-align: right; color: #7f93b3; }
  .pv-list li.on { color: #fff; font-weight: 700; }
  .pv-list li .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .pv-list li .dot.live { background: #e9771a; } .pv-list li .dot.none { background: #5cc79e; }
  .pv-note { font-size: 12px; color: #9fb3d1; margin-top: 12px; }
  #pv-restart { margin-top: 12px; background: #fff; color: #0f2747; border: 0; border-radius: 6px; padding: 6px 12px; font-weight: 700; }`;

  function build() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    document.body.classList.add("pv-open");
    const label = document.createElement("div"); label.className = "pv-label"; label.textContent = "Preview - sample data";
    document.body.appendChild(label);
    const panel = document.createElement("aside"); panel.id = "pv-panel";
    panel.innerHTML = `<div class="pv-head"><b>Journey guide</b><button id="pv-toggle" title="Hide or show this panel">Hide</button></div><div class="pv-body"></div>`;
    document.body.appendChild(panel);
    panel.querySelector("#pv-toggle").addEventListener("click", () => {
      document.body.classList.toggle("pv-open");
      panel.querySelector("#pv-toggle").textContent = document.body.classList.contains("pv-open") ? "Hide" : "Show";
    });
    let last = "";
    const render = () => {
      const k = currentKey();
      if (k === last) return;
      last = k;
      const s = byKey[k] || byKey.home;
      const idx = SCREENS.indexOf(s) + 1;
      panel.querySelector(".pv-body").innerHTML = `
        <span class="pv-tag">Preview - sample data</span>
        <div class="pv-k">Screen ${idx} of ${SCREENS.length}${s.n ? ` · app step ${s.n} of 12` : ""}</div>
        <div class="pv-name">${s.name}</div>
        <div class="pv-k">What the user does</div><div>${s.user}</div>
        <div class="pv-k">What the app does behind the scenes</div><div>${s.app}</div>
        <div class="pv-k">Live services</div>
        <div class="pv-api ${s.api}"><b>${s.api === LIVE ? "Needs live APIs in live mode" : "Works without any API"}</b>${s.apis || (s.api === LIVE ? "" : "No AI or search call on this screen.")}</div>
        <div class="pv-note">Everything in this preview runs offline on stored answers recorded from the real app (Sample 1). In the real app, sample cases also work without keys in demo data mode.</div>
        <div class="pv-k">All screens</div>
        <ol class="pv-list">${SCREENS.map((x) => `<li class="${x === s ? "on" : ""}"><span class="dot ${x.api}"></span>${x.n ? x.n + ". " : ""}${x.name}</li>`).join("")}</ol>
        <div class="pv-note"><span class="dot"></span>Orange dot: needs live APIs in live mode. Green dot: works without them.</div>
        <button id="pv-restart">Restart preview</button>`;
      panel.querySelector("#pv-restart").addEventListener("click", () => { store.clear(); location.hash = "#/"; location.reload(); });
    };
    render();
    new MutationObserver(render).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", () => { last = ""; render(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.__rwPreview = { whatIf, cases, checks: M.whatif_checks };
})();
