# UI AND LANGUAGE REVISION: make the Research Workbench a simple, real tool

The Research Workbench is already built and deployed from `docs/BUILD_PROMPT.md`. The user reviewed it and said:
- It feels like an **explanatory demo**, not a tool someone operates.
- The screens are **too heavy**. All 12 steps and every rule stay, but each task must be simple to do.
- The language sounds **AI-like and isn't self-explanatory**. A consultant will use the tool alone, so every screen and message must make sense with nobody there to explain it.
- It must not be so stripped down that it loses the checks, sources and decisions we agreed. The aim is a balance: a simple default view with full capability one click away.

## What to do (one pass, no approval stops; the user wants this finished in one go)
1. **Presentation and wording only.** Change the frontend (components, pages, styles, copy). Also change **wording** in the backend: the LLM prompt files in `backend/prompts/`, the fixed "why" sentence templates for results, and any user-facing error or progress text the backend returns. Do **not** change the rule engine, state machine, gates, API shapes, database, fixtures' data, or the engine tests. Do not redeploy; the user will. If they are missing, add these small supporting endpoints without touching engine logic: History as CSV (`GET .../activity?format=csv`), case import from the JSON export (`POST /api/cases/import`), and `POST .../sample/advance?to=N` for sample cases (see Section 11 and 12.10 of the build prompt).
2. Treat `design/reference_user_journey.html` as colours and fonts only (`design/tokens.css`). Remove copied elements: actor chips, gate boxes, the 12-node rail, per-step what/why text, the permanent Activity record panel.
3. Rebuild the screens to Section 12 below, which now supersedes the old one. Keep every capability from Section 9 reachable (checks and thresholds, formulas, source links, credibility, duplicates, spot check, return trips, sliders, privacy view of what would go out). Move machinery under "Details" rather than deleting it.
4. Create `frontend/src/copy.ts` holding every on-screen string, with a test that enforces the limits and banned words in 12.6. Apply the writing rules in 12.6 to **every** string, including buttons, field labels, hints, progress, errors and result explanations, and to the instructions inside the LLM prompts for text shown to users.
5. Rename on-screen terms with the map in 12.2. Backend field names do not change.
6. Check yourself: walk Sample 1 from step 1 to 12 reading only what is on screen (12.8), take 1440x900 screenshots, and fix anything that needs outside explanation. Keep existing tests passing.
7. Final report in at most 15 lines: what changed, tests, anything you could not simplify and why, and the files changed.

## Specification

### Section 12. Frontend and UI specification (a working tool, not a demo)

**Read this section as the product brief for the screen.** The user is a consultant using the tool alone, with nobody to explain it. Every screen must be understandable in about five seconds without help. The interface must feel like a calm, real work tool (think a clean inbox or a spreadsheet review tool), **not** a presentation of how the agent works. Sections 1 to 11 describe what the system does; this section decides how little of that the screen shows. When this section and the quoted button or label texts in Section 9 differ, this section wins.

### 12.0 Quality bar
- **Cold-start test:** a consultant who has never seen the tool can finish the Sample 1 case from step 1 to step 12 with no instructions, and at every step can say what to do next within five seconds.
- **Balance:** the default view is simple, but nothing we agreed is lost. Every check, source, formula and decision is one click away, and the consultant can always see why the tool reached a result.
- **Not a demo:** no narration of how the system works, no long explanation blocks, no actor chips, no permanent side panels, no banners except mode, limit and error banners.
- All 12 steps, every gate and every rule stay. Only the presentation gets simpler. Machinery (checklist tests, thresholds, formulas, raw reason codes, queries) is **kept and logged but hidden under a "Details" control**, never removed.

### 12.1 Ten design rules
1. **One screen, one job.** The title says the task ("Review the evidence"), not the activity.
2. **One primary button per screen**, a verb of at most four words ("Confirm question", "Lock targets", "Run tests"). Secondary actions are plain text links or small outlined buttons.
3. **Say what to do, in a few natural sentences.** Under the title, a short instruction of one to three sentences: what to do now, why it matters if that is not obvious, and what happens next. Nothing else on screen explains the workflow. Longer detail goes in a "?" tooltip or under Details. Follow the writing rules in 12.6.
4. **Show things, not sentences:** numbers, chips, short tables and icons before prose.
5. **Hide machinery.** Anything about how the answer was produced sits under a collapsed "Details" row. The consultant opens it only to check.
6. **Plain consulting language** (map in 12.2). Never show terms such as rule engine, LLM, language model, job names, schema, fixture, tier numbers, spans, derivation or sanitise.
7. **Tiny origin tags, not actor chips.** Where it matters, show a small grey tag: **AI draft** (the model wrote or sorted it), **Calculated** (the code worked it out), **You** (the consultant decided). Nothing else about who does what.
8. **A slim stepper, not a rail.** A thin row of 12 dots grouped into the three phases (Frame, Gather, Conclude) with the current step named and "Next: <step title>". No sidebar.
9. **Tables stay compact.** One line per row, details expand on click. Show at most 6 columns; everything else goes in the expanded row.
10. **Calm and real.** White cards on the light page, one accent colour for the primary button, status colours only for status. No decorative banners, no gradients, no animation beyond progress.

### 12.2 Vocabulary map (use the right-hand word on screen)

| Internal term | On screen |
|---|---|
| pass line | **Target** |
| must-have | **Critical** |
| tolerance | **Close-call margin** (under Details) |
| tier 1/2/3/4 | **Source quality: Official / Trusted / Press / Unverified** |
| client-reported | **From the client** |
| claim being tested | **Client's claim** |
| cross-check | **Sense check only** |
| spot check | **Quick double-check** |
| independent source | **Separate source** |
| auto-approved | **Passed the quality check** |
| decision group | **Needs your call** |
| holds / fails / conflicting / not enough evidence | **Supported / Not supported / Sources disagree / Not enough evidence** |
| confidence High / Medium / Low | **Confidence: Strong / Fair / Weak** |
| adding-up rule | **How the answer is decided** |
| fixture mode | **Demo data mode** |
| rule engine, language model, job names | never shown |
| actors in History (`rule_engine`, `llm`, `consultant`) | **Calculated**, **AI draft**, **You** |
| checklist test names | plain words, for example "Source quality is Official or Trusted", "Source is recent enough", "Quote found in the source", "Not a duplicate", "No private terms", "Not needed for a critical idea" |

### 12.3 Layout
```
┌────────────────────────────────────────────────────────────────────────────┐
│ Research Workbench · Case name            History    Help    Settings       │
│ ●●● ●●●● ●●●●●    Step 4 of 12: Plan the research   Next: Gathering evidence │
├────────────────────────────────────────────────────────────────────────────┤
│                     Plan the research                                       │
│          Where each answer will come from. Nothing is sent.                 │
│                                                                              │
│                     (one focused workspace, centred, max 960px)              │
│                                                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ ← Back      Review 2 items to continue                [ Mark as sent ]       │
└────────────────────────────────────────────────────────────────────────────┘
```
- The three groups are **Frame** (steps 1 to 3), **Gather** (steps 4 to 7) and **Conclude** (steps 8 to 12). The screen titles in 12.4 are the on-screen step names; they replace the step names used as headings in Section 9.
- One centred column, maximum 960px. No left rail, no right panel.
- **History** (the activity record, called History on screen) opens a drawer on demand: plain-language entries, newest first, each tagged You, Calculated or AI draft, with **Export CSV**. It is never open by default.
- **Sticky footer:** Back at the left, a status text in the middle that says in a few words what is blocking the primary button ("Decide 3 more items"), the primary button at the right. A disabled button always has that text beside it.
- A thin banner row appears only for Demo data mode, spending limits and errors.
- Locked fields show a small lock and "Locked".

### 12.4 Per-step screens (the default view; everything else is behind Details)

The instruction column is the on-screen text under the title. It is the model for the tone of all other text. Put these strings in `copy.ts`; small wording changes are fine if the rules in 12.6 still hold.

| # | Screen title | Instruction shown under the title | Visible by default | Behind "Details" | Primary button |
|---|---|---|---|---|---|
| 1 | Describe the ask | Paste the client's request exactly as they wrote it. If they've already sent files, add them too, so we use what you have before asking for more. | Client, country, industry, function, the ask (one large box), file drop zone with one line saying files are read by an AI service, and a "Never send these" box for private numbers and client names | Client aliases, and the "AI reads client files" switch | Check the ask |
| 2 | Confirm the question | Check that this matches what the client wants answered. You can edit any box. Once you confirm, we'll draft the ideas to test. | Three short editable cards: What they believe, The decision they face, How we'll compare numbers | What we read from their files | Confirm question |
| 3 | Set the targets | Each idea has a target: the number that decides whether it holds up. Change anything that looks wrong. After you lock the targets, they can't be edited. | Table with Idea, Type (market or client data), Measure, Target (comparator and unit), Critical toggle, and where the target came from. Click a row to open it: it shows the benchmark source with its quality and date, and **Remove idea** (asks for a reason) | Formulas and assumptions, close-call margin, how the answer is decided, the benchmark searches that were run | Lock targets |
| 4 | Plan the research | Check where each answer will come from and what would be sent out. No message goes to the client or experts from this tool. You send the requests yourself, then mark them as sent. | Three tabs: Answers (what we already have and what is missing), Sources (tick the ones to use, or add one with its quality and a reason), Requests (the wording that would go out, with **Copy** and **Download**, and a box "I've checked what goes out") | Original and cleaned wording side by side with removed terms highlighted; a blocked search shows the private term and lets you edit the query | Mark as sent |
| 5 | Gathering evidence | We're collecting evidence from the sources you chose. This usually takes a minute or two. You can stop at any time and keep what we've found. | One progress line per source group with counts and elapsed time, and a list of what's still waiting | Log for each source | Stop collecting (becomes Continue when done) |
| 6 | Checking the evidence | We're merging duplicates and rating each source. You don't need to do anything here. | Three numbers (collected, separate sources, rated) and a short list of merged duplicates | Calculations, ratings, unit conversions, and how many quotes could not be found in their source | Review evidence |
| 7 | Review the evidence | Check what we found before you run the tests. Start with the items that need your call. Then open each source that passed our quality check, mark it as seen, and do the quick double-check. | Progress chips (Needs your call 3 of 5, Seen 4 of 9, Quick double-check). **Needs your call** opens first. **Passed the quality check** is a table (claim, source link, source quality, date, Seen box, Open source). Below it, the quick double-check with Matches and Doesn't match for each picked item, then a box "I've checked these sources". A closed section lists pass-line sources, rejected items and items still waiting | The checks and thresholds for each item, change of idea or role, and formula confirmation | Run tests |
| 8 | Results | Here's how each idea compares with its target. Open a card to see the evidence behind it. | One card per idea: Target, result, confidence (Strong, Fair or Weak), the target-versus-evidence bar, one plain reason, evidence chips | The full reasoning, and every piece of evidence with its role | Fill the gaps (or Add it up if none) |
| 9 | Fill the gaps | These ideas don't have enough evidence yet. Check the question we drafted, send it, mark it as sent, then add the reply here. | One card per idea: the drafted question with **Copy** and **Download**, "Request 1 of 2" (the third request needs a reason and a tick), **Mark as sent**, a reply box. After a reply: the new evidence with the same decisions as step 7, a sample-mix check if the reply rests on a sample, and **Test again**. A link "Add another idea" lets you include a weak or conflicting one | Full evidence list for the reply | Add reply (Skip for now is a link) |
| 10 | The answer | This is what the evidence adds up to. Each statement links to its evidence. Check the sources before you rely on it. | One large result label, then three to five short sentences with evidence chips | Rejected evidence and the reasons | Stress-test |
| 11 | What if... | Move a slider to see whether the answer would change. Your locked plan stays as it is. | Sliders for each target and assumption, result cards that update as you move them, "Locked plan unchanged", Reset, and the **Still unknown** list | What the answer rests on | Write conclusion |
| 12 | Your conclusion | Here's a one-page summary. Write your own conclusion in the box. We don't write it for you, and nothing is sent anywhere. | The one-page summary and an empty "Your conclusion" box | Counts and audit detail | Save conclusion (links: Print or save PDF, Download Markdown, Download JSON) |

Step 7 sketch (default view):
```
Review the evidence
Check what we found before you run the tests. Start with the items that need your call...
[ Needs your call  3 of 5 ]  [ Seen  4 of 9 ]  [ Quick double-check  not done ]

Needs your call (5)
 E7  "Churn is 12% a year"   From the client                  [ Accept ▾ ] [ Reject ]
 E9  ...
Passed the quality check (9)
 E4  claim...  publisher ↗   Official   2025   ▢ Seen
 Quick double-check: open E6   ▢ Matches  ▢ Doesn't match
 ▢ I've checked these sources
 ▸ Pass-line sources · Rejected · Waiting
                                  Footer: Finish 2 items first        [ Run tests ]
```
"Accept ▾" offers: Accept, Accept as client's data, Use as client's claim, Use as sense check. Reject asks for a short reason. If an item needs a calculation (for example a ratio of two figures), opening it shows the formula and inputs and a **Confirm formula** button. With no auto-passed items, the quick double-check is skipped automatically.

### 12.5 Components
- **Evidence row:** id chip, the claim in one line, source name as a link, small quality label, status pill. Expand for the quote, checks table and decision buttons.
- **Status pills (words):** Passed the quality check (green ✓); Accepted by you (green ✓); Needs your call (amber !); From the client (amber); Client's claim (blue); Sense check only (grey); Rejected (red ✕); Waiting (grey clock icon); Could not read (red); Duplicate of E# (grey).
- **Source quality labels:** Official, Trusted, Press, Unverified (amber). A source a person decided shows "Your call".
- **Result card:** idea, Target with unit, the target-versus-evidence bar (12.10), pill (Supported green ✓, Not supported red ✕, Sources disagree amber !, Not enough evidence grey), confidence as three dots plus the word, evidence chips, one short reason line.
- **Icons** are small inline SVGs (tick, cross, warning, clock); no emoji anywhere.
- **Origin tag:** small grey text tag **AI draft**, **Calculated** or **You**; used only on drafts, numbers and decisions, never as decoration.
- **Progress:** a bar with a label and elapsed time; never a bare spinner. **Tables:** sticky header, 14px, right-aligned numbers.
- **Sliders:** label, value and unit, delta from the locked value, Reset.

### 12.6 Words on screen (central copy, with simple tests)

**All on-screen text lives in one file, `frontend/src/copy.ts`,** keyed by screen. Components never hold literal user-facing strings. The text covers page instructions, field labels, button names, help text, progress updates, error messages and explanations of results.

**Writing rules (apply to every string, including text the AI writes for the user):**
1. **Write like a helpful colleague.** Simple, natural English. Assume the user is intelligent but new to the tool. They should understand each instruction on the first reading, without knowing how the system works.
2. **Help the user take the next step.** Say what to do, why it matters if that is not obvious, and what happens next. Include only what they need at that moment. Good: "Upload the files you want to use. Then enter your question. The tool will look through the files and prepare an answer for you to review." Bad: "Begin your research journey by uploading relevant source materials to enable AI-powered analysis."
3. **Everyday words, direct sentences.** "Use", not "utilise". "Check", not "validate". "Choose", not "select your preferred configuration". "Start", not "initiate". Keep a technical term only when it is needed, and explain it where the user meets it. Short sentences, but let the writing flow; do not turn explanations into abrupt fragments.
4. **Friendly without trying too hard.** Use "you". Contractions such as "you'll", "we couldn't" and "it's" are fine. No excitement, jokes, emojis or slogans. Routine actions need no celebration: "Your file is ready to download" is enough.
5. **Keep instructions close to the action.** Main instruction first, then a short reason only if it helps a decision or avoids a mistake. Do not explain the whole workflow beside every field; introduce detail when it becomes relevant. Example field text: "What do you want to find out?" with the hint "Be specific about the question you want answered."
6. **Buttons name the action** ("Check the ask", "Lock targets", "Run tests", "View source", "Edit answer", "Save changes", "Download report", "Try again"). Never "Proceed", "Submit" or "Execute" when a specific verb exists. Use the same name for the same action everywhere.
7. **Say plainly what the AI did, and never imply that a result is correct, complete or verified unless the code has established that.** Good: "The draft is ready. Review the answer and check the sources before using it." If information is missing, say what and how to fix it: "The files don't include costs for 2025, so we couldn't compare spending across both years. Add a file with those costs to complete the comparison." If something needs a closer look, say why: "These two sources give different figures for market size. Check which definition fits your question before choosing a figure." Never use vague notices such as "Human oversight is recommended."
8. **Progress messages describe the current activity** ("Reading your files.", "Comparing the figures across the reports.", "Preparing your draft."). Show a count, percentage or time only when the code really knows it.
9. **Errors say what happened and how to recover** ("We couldn't read this file. Try again, or upload a PDF or Word document instead."). Do not blame the user. Do not show internal details by default (a "Details" link may). Say work is saved only if it is.
10. **Final check for every string:** can the user immediately understand what this means and what to do next? Remove anything that makes the task sound harder than it is, but keep the conditions and limits that matter.

**Reference tone (use it as the model):** "Start by adding the documents you want to work with. You can upload one file or several, depending on your question. Next, tell the tool what you want to find out. A specific question helps it focus on the right information. Once the draft is ready, read through it and check the sources. If something is missing, you can add another file or ask a follow-up question. When you're happy with the answer, download it."

**Tests over `copy.ts` (keep them simple, they catch drift, not tone):** an instruction under a title has at most 45 words; a button has at most 4 words and starts with a verb (the top-bar items History, Help and Settings, and Back and Details, are exempt); one button does one thing; a tooltip has at most 30 words; an error message names a next step. The strings fail the test if they contain: rule engine, LLM, language model, schema, fixture, span, derivation, sanitise, sanitize, orchestrat, pipeline, leverage, utilise, utilize, initiate, proceed, execute, seamless, robust, delve, unlock, powerful, insights, journey, or an exclamation mark.

**Text the AI writes for the user** (summaries, reasons, drafted questions) follows the same rules, with sentences under about 25 words, one idea each, numbers with units, and no claim of certainty that the verdict and strength do not support (Section 10 prompts say so).

### 12.7 States, responsive, print, accessibility
- **Empty:** one line plus the next action. **Loading:** skeleton rows plus progress and elapsed time. **Error:** plain words plus Retry; an error boundary around every step so a failure never produces a blank page. **Limit reached:** a thin banner with the next best action.
- Designed for 1280px and wider; between 900 and 1280px the layout stays single-column; below 900px show a read-only notice.
- Print stylesheet for step 12: single column, black on white, case name and date, no navigation.
- Keyboard accessible with visible focus; every control labelled; status never by colour alone; contrast at least WCAG AA; base text 16px, never below 14px; respect reduced motion.
- Tokens: use `design/tokens.css` (colours and fonts only). Spacing scale 4, 8, 12, 16, 24, 32; cards 12px radius, 1px `--line` border; no gradients.

### 12.8 Visual QA and cold-start check (one pass)
After Stage 1 and again after Stage 2, take one screenshot of every step at 1440×900. Check each against this section, not against the reference file: any screen with more than one primary button, a block of text longer than the instruction line, an actor chip, a permanent side panel or a banned word fails and is fixed. Also read every string against the writing rules in 12.6. Then walk Sample 1 from step 1 to 12 reading **only** what is on screen, and fix anything that needs outside explanation. Do not chase pixel differences.

### 12.9 Navigation, onboarding and guidance
- **Home:** a one-line product description, two buttons (**Start a case**, **Try a sample**), a list of recent cases (name, step, last updated; open or delete) and three small icons with captions: *Ask*, *Gather and check*, *Decide*. Nothing else.
- **Help** (top bar): a short panel with the 12 steps in one line each and a mini glossary (Target, Critical, Source quality, From the client, Sense check only, Quick double-check). A sentence or two each, in plain words.
- A small "?" beside an unfamiliar word reveals a tooltip of at most 30 words.
- **Back-navigation:** the stepper lets the user open any finished step read-only. Future steps are not clickable and their hover text names the step to finish first.
- After a sign-off succeeds, the footer shows "Done ✓" and the button becomes "Continue". Steps with no sign-off move on by themselves with a brief notice. Never jump without a visible cue.
- Confirm irreversible actions in one plain sentence ("After you lock the targets, you can't edit them."): Lock targets, Mark as sent, Run tests, Reset case, Delete case.
- Step 7 shows its live progress chips (needs your call, looked at, quick double-check) at the top. Run tests stays disabled, with the reason beside it (for example "Decide 3 more items first"), until all three are done.

### 12.10 Visual design (the finish that makes it look professional)
- **Type:** IBM Plex Sans for text, IBM Plex Mono for numbers and ids (fallbacks in `tokens.css`). Product name 20px/600; screen title 28px/700 navy; small section labels 13px/600 uppercase, muted, letter-spacing 0.04em; body 16px; secondary 14px. Never below 14px. Numbers in tables right-aligned in mono.
- **Surface:** page `--bg`; content in white cards with 12px radius, 1px `--line` border and 24px padding; 16px between cards; a very soft shadow only on drawers and menus. One centred column of at most 960px with generous white space.
- **Colour:** navy for headings and the top bar text; **primary button filled with `--c-consultant` (#c4570f) and white text** (the lighter accent fails contrast on white); secondary buttons outlined navy; status colours (green, red, amber, grey) only on result and status pills, always with an icon and a word. No other colour.
- **Stepper:** 12 small dots in three labelled groups (Frame, Gather, Conclude). Done = filled navy with a tick, current = orange ring with the step name beside it, later = grey. Done steps are clickable (read-only), later steps are not.
- **Home screen:** centred, calm: product name, the one-line principle ("The tool does the searching, sorting and maths and shows its working. You check what matters and make the call."), **Start a case** and **Try a sample**, recent cases as simple rows, three small line icons (Ask, Gather and check, Decide). Draw icons as small inline SVGs; no icon library, no stock images.
- **Result cards (step 8 and step 11) carry one picture:** a thin horizontal bar showing the **target as a vertical tick** and the **evidence as a dot or a range** on the same scale, tinted green when supported and red when not, with the unit labelled. A judge understands the result at a glance without reading. Build it as plain SVG from the same numbers the verdict used.
- **Step 10:** one large result label (Achievable, Not achievable, or Needs your decision) with the three or four supporting sentences beneath. **Step 12:** a one-page document layout (title block, result, idea table, open gaps, the empty conclusion box), nicely typeset, also used for print.
- **Details rows** open with a smooth 150ms expand. Tables are compact with a subtle hover tint. Empty states show a small line icon and one useful sentence. Loading shows skeleton rows. Nothing jumps or flashes.
- **Presenting:** a "Larger text" switch in Settings raises the base size to 18px for projectors. The app must look right at 1440x900 and 1920x1080 without horizontal scrolling.
- **Sample cases for presenting:** a case opened with **Try a sample** has a **Skip to step** control in Settings. It replays the sample's recorded answers through the normal steps up to the chosen step, labelled "Sample data", so a presenter can show steps 1 to 3, jump to the review at step 7, and so on. It never bypasses a gate.
- **Consistency:** the same component for the same thing everywhere (one evidence row, one result card, one pill set, one button style). No screen invents its own style.
