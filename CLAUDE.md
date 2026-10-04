# Research Workbench: project instructions for Claude Code

## What this project is
A live, domain-agnostic research assistant for consultants. The full specification is **`docs/BUILD_PROMPT.md`**. Read it completely at the start of every session and follow it. The reference HTML files in `design/` are a scripted demo: take **colours and fonts only** (`design/tokens.css`). Layout and every word on screen follow section 12 of the build prompt: simple default screens with full capability under "Details", one primary button per screen, plain natural wording written like a helpful colleague (rules in 12.6), all text in `frontend/src/copy.ts` with a test. To fix the wording and screens of an already-built app, follow `docs/UI_REVISION_PROMPT.md` in one pass. The cost plan is `docs/COST_PLAN.md`.
If this file and the build prompt differ, the build prompt wins, except for the approval protocol, resume protocol and secrets rules below, which add to it.

## Approval protocol (changed by the user: approve outputs, not steps)
- Build in the checkpoints of section 0 of the build prompt and commit after each one with `Checkpoint N: <summary>`, but **do not stop after each checkpoint**.
- The user approves **tangible outputs**:
  - **Milestone A (Stage 1):** checkpoints 1, 2, 3a and 3b built; the app running end to end on Sample 1, shown to the user with screenshots of every screen.
  - **Milestone B (Stage 2):** checkpoints 4 and 5 built; deployment package ready, shown to the user.
  - **Checkpoint 6:** fixes from the user's live testing and optional extras.
- At each milestone report briefly (what was built, test results, how to view it, anything simulated, defaults chosen), then wait for the user's approval of the output. After approval, tag `milestone-X-approved` and update `PROGRESS.md`.

## Resume protocol (saves credits)
- Keep **`PROGRESS.md`** (at most 30 lines): current step, status of each step, decisions made, known issues, commands to run the app and tests. Update it at every checkpoint.
- At the start of a new session, read this file, `PROGRESS.md` and `docs/BUILD_PROMPT.md`, then continue from the last approved step. Do not re-read the whole repository.
- After the user approves a step, tell them they can run `/clear` to start the next step with a fresh, cheaper context.

## Secrets and money
- Never print, log, commit or ask for API keys. Keys live in a git-ignored `.env`. You may check which variable names are present, never their values.
- Checkpoints 1 to 3 need no keys. Never make real LLM or search calls during the build or in tests; use fixtures and mocked clients.
- Do not deploy anything. Checkpoint 5 only prepares the deployment package; the user deploys.
- Follow the cost controls in section 14.1 of the build prompt.

## Working rules
- Write engine code and its unit tests before any UI. Run tests after each module.
- Use the smallest tool that works. Do not add libraries, features or documentation that the build prompt does not ask for.
- Fix root causes. If the same error persists after 3 attempts, stop, record it in `PROGRESS.md` and tell the user.
- Keep the app generic: no client, sector, country or number hard-coded outside `backend/samples/`, `fixtures/` and `design/`. The word "partner" must not appear in the app's own text. See sections 1 and 2 of the build prompt.
- Initialise git on the first step. Keep `.env` in `.gitignore`.
