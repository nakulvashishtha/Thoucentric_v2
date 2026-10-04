# Runbook: deploy and run Research Workbench

You deploy it yourself; nothing here needs a developer. It takes about 20 minutes the first time.
The app is one Docker service with one web address. The passcode protects everything except the health check.

## 1. Get the three keys (once)
1. **Claude API key.** Sign in at platform.claude.com, open **API Keys**, choose **Create Key**, and copy it.
   In **Billing**, add a little credit, set a **monthly spend limit** for the workspace, and leave auto-reload off.
   Use one key for rehearsals and a separate key for the pitch; delete both after the event.
2. **Search key.** Sign up at tavily.com and copy the API key from the dashboard. The free plan (1,000 credits a month) is enough.
3. **Passcode.** Choose any phrase. Everyone who opens the app types it once per browser.

Keep the keys in a password manager. Never paste them into a chat, a document or a commit.

## 2. Put the code on GitHub
The code is in the GitHub repository `Thoucentric_v2`. Render deploys from a branch:
- either use the branch `claude/house-centric-competition-product-prmecv` directly,
- or merge it into `main` on GitHub first (open a pull request and merge it) and deploy `main`.

## 3. Create the service on Render
1. Sign in at render.com with your GitHub account and allow Render to read the `Thoucentric_v2` repository.
2. Choose **New +** then **Blueprint**, pick the repository and the branch. Render reads `render.yaml` and shows one web service, `research-workbench`.
3. Render asks for the three secret values. Paste `ANTHROPIC_API_KEY`, `TAVILY_API_KEY` and `ADMIN_PASSCODE`.
   The other settings are already filled in: `MODEL_FAST=claude-haiku-4-5`, `MODEL_SMART=claude-sonnet-5-5`, `MODE=live`,
   `DAILY_SPEND_CAP=5`, `MAX_LLM_CALLS_PER_CASE=150`, `MAX_SEARCH_CREDITS_PER_CASE=40`, `DATA_DIR=/app/data`. Render sets `PORT` itself.
4. Choose **Apply**. The first build takes 5 to 10 minutes. When the service shows **Live**, copy its address (`https://research-workbench-xxxx.onrender.com`).

If you prefer to click through without the blueprint: **New +**, **Web Service**, pick the repository, Language **Docker**,
Instance type **Free**, add each variable above under **Environment Variables**, and set **Health Check Path** to `/healthz` under **Advanced**.

## 4. Check it works
1. Open `https://<your-address>/healthz`. It should show `{"ok":true}`.
2. Open `https://<your-address>/`, type the passcode, then open **Settings** and press **Run checks**.
   Every item should be green. A red item says exactly what to fix: change that variable under the service's
   **Environment** tab on Render, save (Render restarts the service), and press **Run checks** again. You never need to rebuild for a settings mistake.
3. Choose **Try a sample**, open one, and use **Settings > Skip to step** to jump to step 12. Both samples need no keys.
4. Choose **Start a case** and run one real case from step 1 to 12. Steps 5 and 6 should finish in about 90 seconds.

## 5. What it costs, and the hosting plan
- About 0.50 USD of AI per case and about 15 search credits. The daily cap stops spending at 5 USD; raise `DAILY_SPEND_CAP` on rehearsal days.
- **Settings > Spending** shows this case's and today's spend. If a limit is reached, a banner says so and no more calls are made.
- **Rehearsals:** Render's free instance. It **has no persistent disk** and **sleeps after about 15 minutes idle**.
  Cases are lost when it restarts, and the first visit after sleeping takes about a minute. Samples reload instantly.
- **Pitch week:** in the service's **Settings**, change the instance type to the cheapest paid one (about 7 USD a month) so it never sleeps.
  Do not buy a persistent disk; use **Download JSON** on step 12 to keep a case, and **Import a case** on the home page to bring it back.
- After the event, suspend or delete the service on Render and delete the keys.

## 6. On the day
- Open the address **5 minutes before** presenting so the server is awake (an optional free uptime pinger, set to visit `/healthz` every 10 minutes, keeps it awake).
- Press **Run checks** once. Everything should be green.
- **Reset a case:** Settings > Reset case (keeps the details and files). **Delete a case:** Settings > Delete case, or Delete on the home page.
- **Switch mode:** Settings > Data mode. Demo data uses the stored sample answers and costs nothing.
- **If live calls fail** (the AI or search service is slow or down), a banner appears after two failures. On a sample case press
  **Use demo data**; on your own case press Try again a minute later, or switch to a sample and say openly that it is demo data.
- **History:** every action is in **History** (top bar) with **Export CSV**. The same record is inside **Download JSON**.

## 7. Alternatives to Render
- **Railway:** New Project, Deploy from GitHub repo; it detects the Dockerfile. Add the same variables, and set the health check path to `/healthz`.
- **Fly.io:** install `flyctl`, run `fly launch` in the repository (it uses the Dockerfile), then `fly secrets set` for the three keys and `fly deploy`.

## 8. Run it on your own computer
`make install && make build && make run`, then open http://localhost:8000. Without keys it opens in demo data mode. `make test` runs the tests.
