# How to start the build in Claude Code (no coding knowledge needed)

You will unzip this folder, open it in Claude Code, paste one message, and then approve each step before the next one begins.

## What you need
- A Claude subscription (Pro, Max, Team or Enterprise) or a Claude Console account, to run Claude Code itself.
- Python 3.11 or newer and Node.js 20 or newer on your computer, so you can run the app and look at it. If something is missing, Claude Code will tell you and can guide the install.
- Later (Checkpoint 4 onwards): an Anthropic API key (Claude Console), a Tavily key (tavily.com), a GitHub account and a Render account. **Steps 1 to 3 need none of these.**

## 1. Install Claude Code (one time)
Open a terminal and run the line for your system, then open a new terminal and check it worked.
- Mac, Linux or WSL: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Check: `claude --version` should print a version number.
Claude Code is also available as a desktop app and in VS Code; this guide uses the terminal because it is the simplest to describe.

## 2. Set up the folder
1. Unzip `research-workbench-starter.zip`. You get a folder called `research-workbench` containing `CLAUDE.md`, `docs/` (the build prompt, cost plan and UI revision prompt), `design/` (colours, fonts and three reference files), `.env.example` and `.gitignore`.
2. Open a terminal in that folder (`cd` into it).
3. Start Claude Code by typing `claude`. The first time, it opens your browser so you can log in.

## 3. Paste this first message
```
Read CLAUDE.md, then docs/BUILD_PROMPT.md completely, then docs/COST_PLAN.md. Follow the approval protocol in CLAUDE.md. Start with Checkpoint 1 only (the rule engine and its tests). Do not start Checkpoint 2 until I type "approve".
```

## 4. How each approval works
1. Claude Code builds the step, then stops and tells you what it built, the test results and how to look at it.
2. You check it. From Checkpoint 3 on, you can open the app in your own browser at the address it prints (usually `http://localhost:5173` or `http://localhost:8000`).
3. Type **approve** to continue, or describe what is wrong and it will fix it and report again.
4. After you approve, type `/clear` to start the next step with a fresh, cheaper context. The files `CLAUDE.md` and `PROGRESS.md` let it pick up exactly where it left off.
5. If you hit your usage limit, just wait. Later, run `claude -c` (continue) or start a new session in the same folder. It resumes from `PROGRESS.md`.

## 5. The checkpoints
| Checkpoint | You will see | Needs keys? |
|---|---|---|
| 1 | The rule engine with passing tests and the sample verdict table | No |
| 2 | The backend running all 12 steps on the sample case | No |
| 3a | Look and feel on three key screens (check it feels like a real tool) | No |
| 3b | All 12 screens, working on the sample case (**Stage 1 complete**) | No |
| 4 | The live AI and search layer, tested with stand-ins, plus a second sample | No (built with stand-ins) |
| 5 | The deployment package and runbook (**Stage 2 complete**) | You add keys when you deploy |
| 6 | Fixes from your live testing, then optional extras | Yes, live |

## 6. Keys (Checkpoint 5 onwards, never before)
- Copy `.env.example` to a new file called `.env` and fill it in yourself in a text editor. **Never paste a key into the chat.** `.env` is already ignored by git, so it is never uploaded.
- Where to get them: the Claude Console (platform.claude.com) for the Anthropic key and the model names, tavily.com for the search key.
- On Render you enter the same values in the service's Environment settings; the runbook shows exactly where.

## 7. Deploying (Checkpoint 5 gives you the runbook)
Push the folder to a new GitHub repository, create a Render web service from it using the Dockerfile, add the environment variables, open the app and press **Run checks** in its settings. Every problem shows as a red item with the fix. Then try one live case.

## 8. Tips
- Claude Code may ask permission to run commands. In recent versions it may start in a mode that approves most actions on its own; press `Shift+Tab` to change the mode. The approval protocol in `CLAUDE.md` makes it stop after each step either way.
- If a step goes wrong, you can go back: each approved step is saved as a git tag called `checkpoint-N-approved`.
- Ask Claude Code anything in plain words, for example "how do I open the app?" or "what does this test result mean?".

## Already built and deployed? Fix the screens and wording

Open the existing project in Claude Code and paste: "Read docs/UI_REVISION_PROMPT.md and follow it in one pass. Do not change the engine, API or database. Do not deploy." Then redeploy yourself when it reports done.
