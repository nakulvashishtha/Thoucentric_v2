# Progress

**Current:** Milestone A (Stage 1 = steps 1 to 3) built; waiting for the user's approval of the output.

| Step | Status |
|---|---|
| 1 Rule engine + unit tests | Done (commit "Step 1") |
| 2 DB, state machine (409 gates), API, fixtures, Sample 1, scripted run | Done (commit "Step 2") |
| 3 All 12 screens, brief, exports, visual QA | Done (commit "Step 3") |
| 4 Live layer, caps, passcode, self-check, Sample 2 | Not started (Milestone B) |
| 5 Dockerfile, render.yaml, RUNBOOK, pre-flight | Not started (Milestone B) |
| 6 Fixes from live testing, Stage 3 extras | Not started |

**Decisions (defaults chosen where the prompt was silent)**
- Approval is per milestone, not per step (user's instruction).
- Open-web items are never auto-approved (checklist test 1), per acceptance item 7.
- Copies get status "duplicate" (shown as "Copy of E#") and are left out of the decision group.
- `max_sources_per_need` applies per need and per source group.
- Sample sources use `.sample` domains with consultant-stated tiers, so no real outlet is quoted.
- Step 10 stays on screen after adding up; other no-sign-off steps move on one step at a time.

**Known issues:** none open. Google Fonts are blocked in the build sandbox; the app falls back to Segoe UI or Arial.

**Commands:** `make install && make build && make run` (app on :8000) · `make test` · screenshots: Playwright script (not in repo).
