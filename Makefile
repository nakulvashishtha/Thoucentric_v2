.PHONY: install build run dev test
install:
	python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
	cd frontend && npm ci
build:
	cd frontend && npm run build
run:
	.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port $${PORT:-8000}
dev:
	(.venv/bin/uvicorn backend.app.main:app --reload --port 8000 &) && cd frontend && npm run dev
test:
	.venv/bin/python -m pytest
