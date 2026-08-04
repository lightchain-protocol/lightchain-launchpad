#!/usr/bin/env bash
# Wait until Postgres accepts connections.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${1:-127.0.0.1}"
PORT="${2:-5432}"
TIMEOUT_SEC="${3:-60}"
deadline=$((SECONDS + TIMEOUT_SEC))
COMPOSE=(docker compose -f "$ROOT/docker-compose.dev.yml")

echo "Waiting for Postgres at ${HOST}:${PORT} (timeout ${TIMEOUT_SEC}s)..."
while (( SECONDS < deadline )); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U lcai -d lcai_launchpad >/dev/null 2>&1; then
    echo "Postgres ready."
    exit 0
  fi
  if (echo >/dev/tcp/"$HOST"/"$PORT") >/dev/null 2>&1; then
    # Port open but pg_isready may still be starting — keep trying briefly.
    sleep 1
    if "${COMPOSE[@]}" exec -T postgres pg_isready -U lcai -d lcai_launchpad >/dev/null 2>&1; then
      echo "Postgres ready."
      exit 0
    fi
  fi
  sleep 1
done

echo "Timed out waiting for Postgres at ${HOST}:${PORT}" >&2
exit 1
