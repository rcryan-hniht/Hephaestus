FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/backend/.venv/bin:$PATH" \
    HEPHAESTUS_DATA_DIR=/app/data
WORKDIR /app/backend
RUN apt-get update \
    && apt-get install --yes --no-install-recommends blender \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN uv venv .venv \
    && uv pip install --python .venv/bin/python --require-hashes -r requirements.txt \
    && useradd --uid 10001 --create-home app \
    && mkdir /app/data \
    && chmod 700 /app/data \
    && chown app:app /app/data
COPY backend/app ./app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health',timeout=4)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
