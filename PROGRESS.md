# Progress

**Current:** Milestone B (Stage 2 = checkpoints 4 and 5) built; waiting for the user's approval of the output.

| Checkpoint | Status |
|---|---|
| 1 Rule engine + unit tests | Done (tag milestone-A-approved) |
| 2 DB, state machine (409 gates), API, fixtures, Sample 1, scripted run | Done (tag milestone-A-approved) |
| 3a + 3b All 12 screens, copy.ts + copy test, brief, exports, visual QA | Done (tag milestone-A-approved) |
| 4 Live layer, caps, passcode, self-check, Sample 2 | Done (commit "Checkpoint 4") |
| 5 Dockerfile, render.yaml, .env.example, RUNBOOK, DEMO, pre-flight | Done (commit "Checkpoint 5") |
| 6 Fixes from live testing, Stage 3 extras | Not started (needs the user's live test) |

**Decisions (defaults chosen where the prompt was silent)**
- Approval is per milestone (user's instruction). Models default to claude-haiku-4-5 (fast) and claude-sonnet-5-5 (smart), set in env.
- Structured JSON output (output_config json_schema) for every AI job; smart jobs at effort medium; replies cached by hash.
- Page fetch fallback uses the standard library HTML parser instead of trafilatura (smaller image, under 512 MB).
- Firm archive is firm-wide (Settings > Firm archive), searched with SQLite FTS5. No paid database is connected in live mode.
- Sample 2: hospital group opening a 150-bed hospital in Nakuru; ends Achievable (Sample 1 ends Not achievable).
- Step 5 moves on by itself when collecting finishes; step 6 waits on "Review evidence" so its counts can be read.
- Skip to step replays recorded answers through the normal gates and never writes the conclusion.

**Known issues:** LINK_EVIDENCE runs once per item (not batched by 8); within the 150-call cap. Docker daemon was unavailable
in the build sandbox, so the pre-flight ran the production server directly (clean install from pins, PORT, passcode, healthz).

**Commands:** `make install && make build && make run` (app on :8000) · `make test` (105 tests) · deploy: RUNBOOK.md · demo: DEMO.md.
