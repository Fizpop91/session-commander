#!/usr/bin/env bash
set -euo pipefail

# Deploy helper for running on the Docker host.
# Usage:
#   bash scripts/deploy-server.sh
#   bash scripts/deploy-server.sh --no-cache
#   bash scripts/deploy-server.sh --service session-commander
#   bash scripts/deploy-server.sh --no-logs

SERVICE="session-commander"
NO_CACHE=0
SHOW_LOGS=1
DO_DOWN=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    --no-cache)
      NO_CACHE=1
      shift
      ;;
    --no-logs)
      SHOW_LOGS=0
      shift
      ;;
    --no-down)
      DO_DOWN=0
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose not available"
  exit 1
fi

if [[ "${DO_DOWN}" -eq 1 ]]; then
  echo "Bringing stack down"
  docker compose down --remove-orphans
fi

echo "Stopping service: ${SERVICE}"
docker compose stop "${SERVICE}" >/dev/null 2>&1 || true

echo "Building service: ${SERVICE}"
if [[ "${NO_CACHE}" -eq 1 ]]; then
  docker compose build --no-cache "${SERVICE}"
else
  docker compose build "${SERVICE}"
fi

echo "Starting service: ${SERVICE}"
docker compose up -d "${SERVICE}"

echo "Service status:"
docker compose ps "${SERVICE}"

if [[ "${SHOW_LOGS}" -eq 1 ]]; then
  echo
  echo "Recent logs:"
  docker compose logs --tail=120 "${SERVICE}"
fi
