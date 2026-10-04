# Research Workbench

A general-purpose research tool for consultants. You type a client's ask; the tool frames it, locks a target for each idea, gathers and rates evidence, tests each idea and produces a traceable one-page summary. Plain code makes every decision and does all the maths, the AI only reads, writes and sorts, and you sign off at every important step and write the conclusion.

**Run locally** (without keys it opens in demo data mode with two sample cases)
```
make install      # Python venv + frontend packages
make build        # build the frontend once
make run          # http://localhost:8000
make test         # all automated tests (no real AI or search calls)
```
For frontend work, run `make dev` (API on :8000, Vite on :5173). To go live, copy `.env.example` to `.env` and add the keys.

**Deploy:** follow `RUNBOOK.md` (Render, one Docker service). **Present:** follow `DEMO.md`.

**Stack:** FastAPI + SQLite (WAL) backend, React + TypeScript (Vite) frontend, one service. Thresholds live in `backend/config/rules.yaml`, source ratings in `backend/config/source_registry.yaml`, prices in `backend/config/prices.yaml`, AI instructions in `backend/prompts/`.

**What is stored:** cases, uploaded client files (as extracted text), evidence, decisions, the append-only History, cached AI and search replies, the spend ledger and the firm archive, in `DATA_DIR/workbench.db`. Cases can be reset or deleted from the app; Download JSON keeps a copy and Import a case restores it.
