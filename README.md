# Research Workbench

A general-purpose research agent for consultants. The consultant types a client's ask; the app frames it, locks pass lines, gathers and grades evidence, tests each idea and produces a traceable brief. A plain-code rule engine makes every decision, the language model only reads, writes and sorts, and the consultant signs off at every important step and writes the conclusion.

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

**Status:** Stage 1 (core on stored data) is complete. Sample 1 runs all 12 steps in fixtures mode. Screenshots are in `docs/screenshots/`. Live AI and search, Sample 2, the self-check and the deployment package come next (see `PROGRESS.md`).
