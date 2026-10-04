# Research Workbench

A general-purpose research tool for consultants. You type a client's ask; the tool frames it, locks a target for each idea, gathers and rates evidence, tests each idea and produces a traceable one-page summary. Plain code makes every decision and does all the maths, the AI only reads, writes and sorts, and you sign off at every important step and write the conclusion.

**Run locally (fixtures mode, no keys needed)**
```
make install      # Python venv + frontend packages
make build        # build the frontend once
make run          # http://localhost:8000
make test         # all automated tests
```
For frontend work, run `make dev` (API on :8000, Vite on :5173).

**Stack:** FastAPI + SQLite (WAL) backend, React + TypeScript (Vite) frontend, one service. Thresholds live in `backend/config/rules.yaml`, source tiers in `backend/config/source_registry.yaml`.

**What is stored:** cases, uploaded client files (as extracted text), evidence, decisions and the append-only activity record, in `DATA_DIR/workbench.db`. Cases can be reset or deleted from the app; the JSON export keeps a copy.

**Status:** Stage 1 (core on stored data) is complete. Sample 1 runs all 12 steps in demo data mode. Screenshots of every screen are in `docs/screenshots/`. Live AI and search, Sample 2, the self-check and the deployment package come next (see `PROGRESS.md`).
