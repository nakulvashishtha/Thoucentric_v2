# One image: build the frontend, then serve it from FastAPI. One service, one URL.
FROM node:22.22.0-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11.15-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 DATA_DIR=/app/data MODE=live
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
RUN useradd --create-home app && mkdir -p /app/data && chown -R app /app
USER app
EXPOSE 8000
# One worker (jobs run in-process); trust the host's proxy so the passcode cookie is Secure over https.
CMD uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips="*"
