// On-screen wording. The what and why lines come from design/reference_user_journey.html.
export const PRINCIPLE =
  "The agent does the searching, sorting and maths and shows its working. People set the rules, check what matters and make the call.";

export const PHASES = ["Frame the question", "Gather and check", "Work out what it means"];

type Who = "consultant" | "model" | "rule" | "client" | "expert";
export interface StepCopy { n: number; short: string; title: string; phase: number; who: Who[]; what: string; why: string; signoff: string | null }

export const STEPS: StepCopy[] = [
  { n: 1, short: "Type the ask", title: "Type the ask", phase: 0, who: ["consultant"], signoff: null,
    what: "The consultant types what the client wants, in the client's own words, plus the country, industry and function. Nothing is tidied up at this stage.",
    why: "Starting takes a couple of minutes, and the client's own assumption is captured as they said it." },
  { n: 2, short: "Check the frame", title: "Check the frame", phase: 0, who: ["model", "consultant"], signoff: "Consultant confirms the frame",
    what: "The agent pulls the ask apart into three things that usually get mixed up. The consultant corrects anything that looks wrong.",
    why: "The client's assumption becomes a claim to test, not a fact to build on, and numbers from different sources can be compared fairly." },
  { n: 3, short: "Agree the plan", title: "Agree the plan and lock it", phase: 0, who: ["model", "rule", "consultant"], signoff: "Consultant ticks the box and locks the plan",
    what: "The agent drafts the ideas to test. Each has a pass line, the point where the decision changes, worked out from the client's goals or a named benchmark.",
    why: "Pass lines, the adding-up rule and the evidence checklist are fixed before anyone sees evidence. Nobody can move the goalposts later." },
  { n: 4, short: "Plan the evidence", title: "Decide where each answer lives", phase: 1, who: ["model", "rule", "consultant"], signoff: "Consultant marks the requests as sent",
    what: "Not everything is online. Each piece of evidence is sent to where it actually is: desk research, the client, or experts.",
    why: "The rule engine strips the client's name and private numbers first, and the consultant can see exactly what goes out." },
  { n: 5, short: "Collect", title: "Collect the evidence", phase: 1, who: ["rule", "model", "client", "expert"], signoff: null,
    what: "The pass-line benchmarks are already locked from step 3. Now every source is searched at once.",
    why: "This is where most of the hours come back. One person no longer hunts through each source in turn." },
  { n: 6, short: "Clean", title: "Clean the evidence", phase: 1, who: ["rule"], signoff: null,
    what: "Numbers are pulled out and converted to the one measure. Copies are traced back to their original, and every calculation is done in code.",
    why: "Five copies can't pass as five confirmations, and no number is a model's guess." },
  { n: 7, short: "Review", title: "Review the evidence", phase: 1, who: ["rule", "consultant"], signoff: "Consultant decides every flagged item",
    what: "A checklist approves the clear-cut items. A person always checks the client's own claims, anything weak, and anything the answer leans on.",
    why: "People judge what can change the answer. Every auto-approved source is shown to a person, and the spot check keeps the checklist honest." },
  { n: 8, short: "Test", title: "Test each idea against its pass line", phase: 2, who: ["rule"], signoff: null,
    what: "A fixed rule gives each idea a result and a confidence level. The language model doesn't vote.",
    why: "Same evidence in, same verdict out, every time." },
  { n: 9, short: "Fill the gaps", title: "Go back for the missing piece", phase: 2, who: ["model", "consultant", "client", "rule"], signoff: "Consultant marks the question as sent",
    what: "Only ideas without enough evidence go back. The agent drafts a narrower question instead of writing them up on too little evidence.",
    why: "Gaps get filled instead of guessed, and research time stays bounded." },
  { n: 10, short: "Add it up", title: "Add it up", phase: 2, who: ["rule", "model"], signoff: null,
    what: "The rule locked in step 3 is applied. Then the language model writes a short summary where every sentence points to its source.",
    why: "Every line can be traced, and nothing inconvenient is hidden." },
  { n: 11, short: "Stress-test", title: "Stress-test the answer", phase: 2, who: ["consultant"], signoff: null,
    what: "The screen shows what the answer rests on, and lets you move the inputs to see what would change it. The locked plan doesn't change.",
    why: "These are options for the consultant. The agent doesn't choose between them." },
  { n: 12, short: "Decide", title: "The consultant decides", phase: 2, who: ["consultant"], signoff: "Consultant writes the conclusion",
    what: "The consultant reads a one-page readiness brief and writes the conclusion themselves. It stays with the consultant. Nothing is sent on automatically.",
    why: "The conclusion is the consultant's own. The agent never writes this part." },
];

export const WHO_LABEL: Record<string, string> = {
  consultant: "Consultant", model: "Language model", llm: "Language model", rule: "Rule engine",
  rule_engine: "Rule engine", client: "Client", expert: "Experts", system: "System",
};

export const GLOSSARY: Record<string, string> = {
  "pass line": "The value an idea must reach (or stay under) for the decision to change. Fixed before any evidence is read.",
  "must-have": "An idea the answer cannot do without. If a must-have fails, the overall answer fails.",
  tolerance: "A small band around the pass line. A figure inside it is too close to call, so confidence drops to Low.",
  tier: "How credible a source type is, from Tier 1 (official) to Tier 4 (unverified). Graded by the rule engine, never the model.",
  "client-reported": "Data the client gave us. It can count, but confidence is capped at Medium.",
  "claim being tested": "The client's own belief. It is what we test, so it never counts as evidence for itself.",
  "cross-check": "Evidence shown next to the result but not counted. Only the consultant can assign this role.",
  "spot check": "A random sample of auto-approved items that a person opens and checks against the source.",
  "independent source": "A separate original source. Copies of the same figure count once.",
  "fixture mode": "The app uses stored sample responses instead of live AI and search. Everything is labelled as simulated.",
};

export const ORIGIN_LABEL: Record<string, string> = {
  open_web: "Open web", firm_archive: "Firm archive", paid_db: "Paid or simulated database",
  client_file: "Client file", expert_note: "Expert note", benchmark: "Benchmark",
};
export const ROLE_LABEL: Record<string, string> = {
  supports_test: "supports the test", cross_check: "cross-check", sets_pass_line: "sets the pass line", context: "context",
};
export const RESULT_LABEL: Record<string, string> = {
  holds: "Holds", fails: "Fails", conflicting: "Conflicting", not_enough: "Not enough evidence",
};
