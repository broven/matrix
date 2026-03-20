#!/usr/bin/env bash
set -euo pipefail

# Prerequisites:
# - Run the macOS app in dev mode so the bridge server is running.
# - jq and curl must be available.
# - MATRIX_PORT and MATRIX_TOKEN must be set (or sourced from .env.local).

require_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "error: missing required dependency: $name" >&2
    exit 1
  fi
}

require_bin jq
require_bin curl

# Source .env.local if vars not already set
if [[ -z "${MATRIX_PORT:-}" || -z "${MATRIX_TOKEN:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
    set -a
    source "$SCRIPT_DIR/.env.local"
    set +a
  fi
fi

if [[ -z "${MATRIX_PORT:-}" ]]; then
  echo "error: MATRIX_PORT is not set" >&2
  exit 1
fi

if [[ -z "${MATRIX_TOKEN:-}" ]]; then
  echo "error: MATRIX_TOKEN is not set" >&2
  exit 1
fi

BASE_URL="http://127.0.0.1:${MATRIX_PORT}"
AUTH_HEADER="Authorization: Bearer ${MATRIX_TOKEN}"
HEALTH_URL="${BASE_URL}/bridge/health"
CLIENTS_URL="${BASE_URL}/bridge/clients"
CURL_LOOPBACK_ARGS=(--noproxy "*")
WAIT_SECONDS="${MATRIX_BRIDGE_WAIT_SECONDS:-30}"

echo "smoke: waiting for bridge at ${HEALTH_URL}"
waited=0
while true; do
  HEALTH_BODY="$(curl "${CURL_LOOPBACK_ARGS[@]}" --silent --show-error -H "$AUTH_HEADER" "$HEALTH_URL" 2>/dev/null || echo '{}')"
  if echo "$HEALTH_BODY" | jq -e '.ok == true and .clientCount > 0' >/dev/null 2>&1; then
    break
  fi
  if (( waited >= WAIT_SECONDS )); then
    echo "error: bridge health check failed after ${WAIT_SECONDS}s" >&2
    echo "hint: start mac dev app first, e.g. pnpm dev:mac" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done

echo "smoke: checking ${CLIENTS_URL}"
CLIENTS_BODY="$(curl "${CURL_LOOPBACK_ARGS[@]}" --silent --show-error --fail -H "$AUTH_HEADER" "$CLIENTS_URL")"
echo "$CLIENTS_BODY" | jq -e 'length > 0' >/dev/null

echo "smoke: bridge is reachable with $(echo "$CLIENTS_BODY" | jq 'length') client(s)"
