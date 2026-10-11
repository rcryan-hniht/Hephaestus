FROM oven/bun:1 AS bun

FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN uv sync --directory backend --frozen --no-dev --no-install-project
COPY frontend/package.json frontend/bun.lock ./frontend/
RUN cd frontend && bun install --frozen-lockfile

COPY backend/main.py ./backend/
COPY frontend/vite.config.js ./frontend/
COPY frontend/src ./frontend/src/
COPY start.sh ./
RUN chmod +x start.sh && useradd --uid 10001 --create-home app \
    && chown -R app:app /app

USER app
EXPOSE 3000 8000
CMD ["./start.sh"]
