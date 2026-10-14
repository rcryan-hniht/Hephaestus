#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

uv sync --directory backend --frozen --no-dev
cd frontend
bun install --frozen-lockfile
bun --bun run build
cd ..

pids=()
cleanup() {
    trap - EXIT INT TERM
    if [ "${#pids[@]}" -gt 0 ]; then
        kill "${pids[@]}" 2>/dev/null || true
        wait "${pids[@]}" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

uv run --directory backend --frozen --no-sync uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8000}" &
pids+=("$!")
(cd frontend && exec bun --bun run preview --host 0.0.0.0 --port "${PORT:-3000}" --strictPort) &
pids+=("$!")

wait -n "${pids[@]}"
