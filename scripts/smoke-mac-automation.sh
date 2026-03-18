#!/usr/bin/env bash
set -euo pipefail

# Prerequisites:
# - Run the macOS app in dev mode so it writes automation.json.
# - jq and curl must be available.

require_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "error: missing required dependency: $name" >&2
    exit 1
  fi
}

resolve_discovery_dir() {
  if [[ -n "${MATRIX_AUTOMATION_DISCOVERY_DIR:-}" ]]; then
    printf '%s\n' "$MATRIX_AUTOMATION_DISCOVERY_DIR"
    return 0
  fi

  if [[ -n "${HOME:-}" ]]; then
    printf '%s\n' "$HOME/Library/Application Support/Matrix/dev"
    return 0
  fi

  echo "error: HOME is not set and MATRIX_AUTOMATION_DISCOVERY_DIR is empty" >&2
  exit 1
}

wait_for_file() {
  local path="$1"
  local timeout_seconds="$2"
  local waited=0
  while [[ ! -f "$path" ]]; do
    if (( waited >= timeout_seconds )); then
      echo "error: automation discovery not found after ${timeout_seconds}s: $path" >&2
      echo "hint: start mac dev app first, e.g. pnpm --filter @matrix/client tauri:dev" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

require_bin jq
require_bin curl

DISCOVERY_DIR="$(resolve_discovery_dir)"
DISCOVERY_FILE="${DISCOVERY_DIR}/automation.json"
WAIT_SECONDS="${MATRIX_AUTOMATION_WAIT_SECONDS:-30}"

wait_for_file "$DISCOVERY_FILE" "$WAIT_SECONDS"

BASE_URL="$(jq -r '.baseUrl // empty' "$DISCOVERY_FILE")"
TOKEN="$(jq -r '.token // empty' "$DISCOVERY_FILE")"

if [[ -z "$BASE_URL" || -z "$TOKEN" ]]; then
  echo "error: invalid discovery metadata in $DISCOVERY_FILE (missing baseUrl/token)" >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
HEALTH_URL="${BASE_URL}/health"
STATE_URL="${BASE_URL}/state"

echo "smoke: checking ${HEALTH_URL}"
HEALTH_BODY="$(curl --silent --show-error --fail -H "$AUTH_HEADER" "$HEALTH_URL")"
echo "$HEALTH_BODY" | jq -e '.ok == true' >/dev/null

echo "smoke: checking ${STATE_URL}"
STATE_BODY="$(curl --silent --show-error --fail -H "$AUTH_HEADER" "$STATE_URL")"
echo "$STATE_BODY" | jq -e 'has("window") and has("webview") and has("sidecar")' >/dev/null

echo "smoke: mac automation bridge is reachable"
