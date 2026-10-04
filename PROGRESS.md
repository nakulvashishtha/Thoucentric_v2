# Progress

**Current:** Milestone A (Stage 1 = checkpoints 1, 2, 3a, 3b) built; waiting for the user's approval of the output.

| Checkpoint | Status |
|---|---|
| 1 Rule engine + unit tests | Done (commit "Checkpoint 1") |
| 2 DB, state machine (409 gates), API, fixtures, Sample 1, scripted run | Done (commit "Checkpoint 2") |
| 3a + 3b All 12 screens to Section 12, copy.ts + copy test, brief, exports, visual QA | Done (commit "Checkpoint 3") |
| 4 Live layer, caps, passcode, self-check, Sample 2 | Not started (Milestone B) |
| 5 Dockerfile, render.yaml, RUNBOOK, DEMO, pre-flight | Not started (Milestone B) |
| 6 Fixes from live testing, Stage 3 extras | Not started |

**Decisions (defaults chosen where the prompt was silent)**
- Approval is per milestone (user's instruction); 3a and 3b were built and committed together.
- Base code reused from the earlier build in the Thoucentric repo, then changed to the revised prompt.
- Open-web pages can pass the quality check only as Official or Trusted; a calculated figure never passes on its own.
- Sample 1: the pilot margin is in a file held at the start; the sign-up cost arrives with the return-trip reply.
- Step 5 moves on by itself when collecting finishes; step 6 waits on "Review evidence" so its counts can be read.
- Skip to step (sample cases) replays the recorded answers through the normal gates and never writes the conclusion.
- Copies get status "duplicate" (shown as "Duplicate of E#") and are left out of the decision group.

**Known issues:** none open.
Google Fonts are blocked in the build sandbox, so screenshots use the Arial fallback.

**Commands:** `make install && make build && make run` (app on :8000) · `make test` (88 tests) · screenshots in `docs/screenshots/`.
